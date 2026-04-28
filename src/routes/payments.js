/**
 * routes/payments.js
 *
 * orders.paid:
 *   0 = unbezahlt
 *   1 = vollstaendig bezahlt
 *   2 = teilweise bezahlt
 *
 * Split-Payment:
 *   Wenn orders.split_payment = 1, bekommt jedes Ticket eine eigene Referenz (CODE-1, CODE-2, …).
 *   Die Zuordnung erfolgt über order_tickets.split_ref.
 *   Beim CSV-Upload wird geprüft ob die Referenz CODE-N matcht und das entsprechende Ticket
 *   als bezahlt markiert. Die Gesamt-Order gilt als paid=1 wenn ALLE Tickets bezahlt sind.
 */
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');

const { getDb, getSettings }        = require('../database');
const { parseBankCsv, parseSplitRef } = require('../utils/bankParser');
const { generateQrBuffer }          = require('../utils/qrGenerator');
const { sendTicketEmail }           = require('../utils/emailSender');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.csv', '.txt'].includes(ext));
  },
});

async function sendTicketsForOrder(db, person, order) {
  const orderTickets = db.prepare('SELECT * FROM order_tickets WHERE order_id = ?').all(order.id);
  const sentTo = [];
  for (const ticket of orderTickets) {
    const toEmail = (ticket.ticket_email || '').trim();
    if (!toEmail) continue;
    const qrBuffer = await generateQrBuffer(JSON.stringify({
      ticketId: ticket.id, orderId: order.id,
      personCode: person.code, name: ticket.ticket_name,
    }));
    await sendTicketEmail({ to: toEmail, personName: ticket.ticket_name || person.name, qrBuffers: [qrBuffer] });
    sentTo.push(toEmail);
  }
  return sentTo;
}

async function sendSingleTicket(db, person, order, ticket) {
  const toEmail = (ticket.ticket_email || '').trim();
  if (!toEmail) return null;
  const qrBuffer = await generateQrBuffer(JSON.stringify({
    ticketId: ticket.id, orderId: order.id,
    personCode: person.code, name: ticket.ticket_name,
  }));
  await sendTicketEmail({ to: toEmail, personName: ticket.ticket_name || person.name, qrBuffers: [qrBuffer] });
  return toEmail;
}

/**
 * Berechnet den Zahlungsstatus einer Bestellung neu.
 *
 * Für Split-Orders: paid=1 nur wenn ALLE Tickets einzeln bezahlt sind.
 * Für Normal-Orders: paid basiert auf Summe aller Payments.
 */
function recalcPaymentStatus(db, personId) {
  const order = db.prepare(
    'SELECT * FROM orders WHERE person_id = ? AND submitted = 1 ORDER BY id DESC LIMIT 1'
  ).get(personId);
  if (!order) return { nowFullyPaid: false, order: null };

  const wasPaid = order.paid === 1;

  // Split-Payment: alle Ticket-Slots müssen paid_at haben
  if (order.split_payment) {
    const tickets    = db.prepare('SELECT * FROM order_tickets WHERE order_id = ?').all(order.id);
    const allPaid    = tickets.length > 0 && tickets.every(t => t.split_paid_at);
    const anyPaid    = tickets.some(t => t.split_paid_at);
    const paidAmount = tickets
      .filter(t => t.split_paid_at)
      .reduce((s, t) => s + (t.split_amount || 0), 0);

    if (allPaid) {
      db.prepare(
        "UPDATE orders SET paid = 1, paid_amount = total_eur, paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ?"
      ).run(order.id);
      return { nowFullyPaid: !wasPaid, order: { ...order, paid: 1 } };
    } else if (anyPaid) {
      db.prepare('UPDATE orders SET paid = 2, paid_amount = ? WHERE id = ?').run(paidAmount, order.id);
      return { nowFullyPaid: false, order: { ...order, paid: 2 } };
    } else {
      db.prepare('UPDATE orders SET paid = 0, paid_amount = 0 WHERE id = ?').run(order.id);
      return { nowFullyPaid: false, order: { ...order, paid: 0 } };
    }
  }

  // Normal-Payment: Summe aller Zahlungen
  const { total_paid } = db.prepare(
    'SELECT COALESCE(SUM(amount_eur), 0) AS total_paid FROM payments WHERE person_id = ? AND amount_eur > 0'
  ).get(personId);

  if (total_paid >= order.total_eur - 0.01) {
    db.prepare(
      "UPDATE orders SET paid = 1, paid_amount = ?, paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ?"
    ).run(total_paid, order.id);
    return { nowFullyPaid: !wasPaid, order: { ...order, paid: 1, paid_amount: total_paid } };
  } else if (total_paid > 0) {
    db.prepare('UPDATE orders SET paid = 2, paid_amount = ? WHERE id = ?').run(total_paid, order.id);
    return { nowFullyPaid: false, order: { ...order, paid: 2, paid_amount: total_paid } };
  } else {
    db.prepare('UPDATE orders SET paid = 0, paid_amount = 0 WHERE id = ?').run(order.id);
    return { nowFullyPaid: false, order: { ...order, paid: 0, paid_amount: 0 } };
  }
}

// POST /api/payments/upload
router.post('/upload', upload.single('statement'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine CSV-Datei hochgeladen' });

  const entries    = parseBankCsv(req.file.buffer.toString('utf8'));
  const db         = getDb();
  const allPersons = db.prepare('SELECT * FROM persons').all();
  const results    = [];
  const affectedPersonIds = new Set();
  const splitTicketsNowPaid = [];  // { person, order, ticket } die jetzt bezahlt sind

  const insertPayment = db.prepare(
    'INSERT OR IGNORE INTO payments (person_id, amount_eur, reference, sender_name, booking_date, matched) VALUES (@personId, @amount, @reference, @senderName, @date, @matched)'
  );

  db.transaction(() => {
    for (const entry of entries) {
      const refUpper = entry.reference.toUpperCase();

      // 1. Versuche Split-Match (CODE-N)
      let matchedPerson = null;
      let splitTicketId = null;
      let splitTicketNum = null;

      for (const person of allPersons) {
        const { isSplit, ticketNum } = parseSplitRef(entry.reference, person.code);
        if (isSplit) {
          // Prüfe ob auch der Code enthalten ist (damit kein False-Positive)
          if (refUpper.includes(person.code.toUpperCase())) {
            matchedPerson  = person;
            splitTicketNum = ticketNum;
            break;
          }
        }
      }

      // Falls Split-Match: Ticket-ID aus split_ref ermitteln
      if (matchedPerson && splitTicketNum !== null) {
        const order = db.prepare(
          'SELECT * FROM orders WHERE person_id = ? AND submitted = 1 ORDER BY id DESC LIMIT 1'
        ).get(matchedPerson.id);
        if (order && order.split_payment) {
          const ticket = db.prepare(
            'SELECT * FROM order_tickets WHERE order_id = ? AND split_ticket_num = ?'
          ).get(order.id, splitTicketNum);
          if (ticket && !ticket.split_paid_at) {
            splitTicketId = ticket.id;
            // Ticket als bezahlt markieren
            db.prepare(
              "UPDATE order_tickets SET split_paid_at = datetime('now'), split_amount = ? WHERE id = ?"
            ).run(entry.amount, ticket.id);
            splitTicketsNowPaid.push({ person: matchedPerson, order, ticket });
          }
        }
      }

      // 2. Falls kein Split-Match, versuche normalen Code-Match
      if (!matchedPerson) {
        matchedPerson = allPersons.find(p => refUpper.includes(p.code.toUpperCase())) || null;
      }

      const info = insertPayment.run({
        personId:   matchedPerson ? matchedPerson.id : null,
        amount:     entry.amount,
        reference:  entry.reference,
        senderName: entry.senderName,
        date:       entry.date,
        matched:    matchedPerson ? 1 : 0,
      });

      if (matchedPerson && info.changes > 0) affectedPersonIds.add(matchedPerson.id);
      results.push({
        reference:  entry.reference,
        senderName: entry.senderName,
        amount:     entry.amount,
        personName: matchedPerson?.name || null,
        splitTicket: splitTicketNum || null,
      });
    }
  })();

  // Zahlungsstatus neu berechnen
  const newlyFullyPaid = [];
  for (const personId of affectedPersonIds) {
    const { nowFullyPaid, order } = recalcPaymentStatus(db, personId);
    if (nowFullyPaid && order) {
      newlyFullyPaid.push({ person: db.prepare('SELECT * FROM persons WHERE id = ?').get(personId), order });
    }
  }

  // E-Mails für komplett bezahlte Bestellungen
  const emailResults = [];
  for (const { person, order } of newlyFullyPaid) {
    try {
      emailResults.push({ person: person.name, sentTo: await sendTicketsForOrder(db, person, order), ok: true });
    } catch (err) {
      emailResults.push({ person: person.name, error: err.message, ok: false });
    }
  }

  // E-Mails für einzelne Split-Tickets die jetzt bezahlt sind (aber Gesamtbestellung noch offen)
  for (const { person, order, ticket } of splitTicketsNowPaid) {
    // Nur senden wenn Bestellung noch nicht komplett bezahlt (dann hat sendTicketsForOrder schon alle gesendet)
    const wasFullyHandled = newlyFullyPaid.some(e => e.order.id === order.id);
    if (!wasFullyHandled) {
      try {
        const sent = await sendSingleTicket(db, person, order, ticket);
        if (sent) emailResults.push({ person: person.name, splitTicket: ticket.split_ticket_num, sentTo: [sent], ok: true });
      } catch (err) {
        emailResults.push({ person: person.name, splitTicket: ticket.split_ticket_num, error: err.message, ok: false });
      }
    }
  }

  res.json({
    processed:   results.length,
    newlyPaid:   newlyFullyPaid.length,
    splitPaid:   splitTicketsNowPaid.length,
    emailsSent:  emailResults,
    results,
  });
});

// GET /api/payments
router.get('/', (req, res) => {
  const db = getDb();
  res.json({ payments: db.prepare(`
    SELECT p.*, pe.name AS person_name, pe.email AS person_email
    FROM payments p LEFT JOIN persons pe ON pe.id = p.person_id
    ORDER BY p.id DESC
  `).all() });
});

// POST /api/payments/:id/send
router.post('/:id/send', async (req, res) => {
  const db      = getDb();
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!payment)           return res.status(404).json({ error: 'Zahlung nicht gefunden' });
  if (!payment.person_id) return res.status(400).json({ error: 'Keine Zuordnung zu einer Person' });
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(payment.person_id);
  if (!person) return res.status(400).json({ error: 'Person nicht gefunden' });
  const order  = db.prepare('SELECT * FROM orders WHERE person_id = ? ORDER BY id DESC LIMIT 1').get(payment.person_id);
  if (!order)  return res.status(400).json({ error: 'Keine Bestellung gefunden' });
  const orderTickets = db.prepare('SELECT * FROM order_tickets WHERE order_id = ?').all(order.id);
  if (!orderTickets.length) return res.status(400).json({ error: 'Keine Tickets in der Bestellung' });
  if (!orderTickets.some(t => (t.ticket_email || '').trim()))
    return res.status(400).json({ error: 'Keine E-Mail-Adressen für die Tickets hinterlegt.' });
  try {
    const sentTo = await sendTicketsForOrder(db, person, order);
    db.prepare('UPDATE payments SET qr_sent = 1 WHERE id = ?').run(payment.id);
    db.prepare("UPDATE orders SET paid = 1, paid_amount = total_eur, paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ?").run(order.id);
    res.json({ ok: true, sentTo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, recalcPaymentStatus };
