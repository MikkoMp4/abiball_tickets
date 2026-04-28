/**
 * routes/payments.js
 *
 * orders.paid:
 *   0 = unbezahlt
 *   1 = vollstaendig bezahlt
 *   2 = teilweise bezahlt
 */
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');

const { getDb, getSettings }   = require('../database');
const { parseBankCsv }         = require('../utils/bankParser');
const { generateQrBuffer }     = require('../utils/qrGenerator');
const { sendTicketEmail }      = require('../utils/emailSender');

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

/**
 * Summiert alle Zahlungen einer Person und setzt orders.paid:
 *   >= total_eur  -> paid=1 (vollstaendig)
 *   >  0          -> paid=2 (teilweise)
 *   == 0          -> paid=0
 * Gibt { nowFullyPaid, order } zurueck.
 * nowFullyPaid=true nur wenn vorher NICHT paid=1 war.
 */
function recalcPaymentStatus(db, personId) {
  const order = db.prepare(
    'SELECT * FROM orders WHERE person_id = ? AND submitted = 1 ORDER BY id DESC LIMIT 1'
  ).get(personId);
  if (!order) return { nowFullyPaid: false, order: null };

  const { total_paid } = db.prepare(
    'SELECT COALESCE(SUM(amount_eur), 0) AS total_paid FROM payments WHERE person_id = ? AND amount_eur > 0'
  ).get(personId);

  const wasPaid = order.paid === 1;

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

  const entries = parseBankCsv(req.file.buffer.toString('utf8'));
  const db      = getDb();
  const allPersons = db.prepare('SELECT * FROM persons').all();
  const results    = [];
  const affectedPersonIds = new Set();

  const insertPayment = db.prepare(
    'INSERT OR IGNORE INTO payments (person_id, amount_eur, reference, sender_name, booking_date, matched) VALUES (@personId, @amount, @reference, @senderName, @date, @matched)'
  );

  db.transaction(() => {
    for (const entry of entries) {
      const refUpper      = entry.reference.toUpperCase();
      const matchedPerson = allPersons.find(p => refUpper.includes(p.code)) || null;
      const info = insertPayment.run({
        personId:   matchedPerson ? matchedPerson.id : null,
        amount:     entry.amount,
        reference:  entry.reference,
        senderName: entry.senderName,
        date:       entry.date,
        matched:    matchedPerson ? 1 : 0,
      });
      if (matchedPerson && info.changes > 0) affectedPersonIds.add(matchedPerson.id);
      results.push({ reference: entry.reference, senderName: entry.senderName, amount: entry.amount, personName: matchedPerson?.name || null });
    }
  })();

  const newlyFullyPaid = [];
  for (const personId of affectedPersonIds) {
    const { nowFullyPaid, order } = recalcPaymentStatus(db, personId);
    if (nowFullyPaid && order) {
      newlyFullyPaid.push({ person: db.prepare('SELECT * FROM persons WHERE id = ?').get(personId), order });
    }
  }

  const emailResults = [];
  for (const { person, order } of newlyFullyPaid) {
    try { emailResults.push({ person: person.name, sentTo: await sendTicketsForOrder(db, person, order), ok: true }); }
    catch (err) { emailResults.push({ person: person.name, error: err.message, ok: false }); }
  }

  res.json({ processed: results.length, newlyPaid: newlyFullyPaid.length, emailsSent: emailResults, results });
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
  const order = db.prepare('SELECT * FROM orders WHERE person_id = ? ORDER BY id DESC LIMIT 1').get(payment.person_id);
  if (!order) return res.status(400).json({ error: 'Keine Bestellung gefunden' });
  const orderTickets = db.prepare('SELECT * FROM order_tickets WHERE order_id = ?').all(order.id);
  if (!orderTickets.length) return res.status(400).json({ error: 'Keine Tickets in der Bestellung' });
  if (!orderTickets.some(t => (t.ticket_email || '').trim()))
    return res.status(400).json({ error: 'Keine E-Mail-Adressen fuer die Tickets hinterlegt.' });
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
