/**
 * routes/payments.js – Zahlungsabgleich und Ticket-Versand
 *
 * POST /api/payments/upload   – Kontoauszug (CSV) hochladen, abgleichen, E-Mails automatisch senden
 * GET  /api/payments          – Alle Zahlungen auflisten
 * POST /api/payments/:id/send – QR-Tickets manuell (erneut) senden
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
    const allowed = ['.csv', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

/**
 * Shared helper: send one QR-email per ticket for a given order.
 * Reads email from ticket_email column.
 * Returns array of addresses emails were sent to.
 */
async function sendTicketsForOrder(db, person, order) {
  const orderTickets = db.prepare('SELECT * FROM order_tickets WHERE order_id = ?').all(order.id);
  const sentTo = [];

  for (const ticket of orderTickets) {
    const toEmail = (ticket.ticket_email || '').trim();
    if (!toEmail) continue;

    const qrBuffer = await generateQrBuffer(JSON.stringify({
      ticketId:   ticket.id,
      orderId:    order.id,
      personCode: person.code,
      name:       ticket.ticket_name,
    }));

    await sendTicketEmail({
      to:         toEmail,
      personName: ticket.ticket_name || person.name,
      qrBuffers:  [qrBuffer],
    });

    sentTo.push(toEmail);
  }

  return sentTo;
}

// ── POST /api/payments/upload ────────────────────────────────────────────────
// Parses CSV bank statement, matches payments, marks orders paid,
// and automatically sends QR ticket emails to every matched person.
router.post('/upload', upload.single('statement'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine CSV-Datei hochgeladen' });

  const csvText = req.file.buffer.toString('utf8');
  const entries = parseBankCsv(csvText);
  const db      = getDb();
  const s       = getSettings();
  const TICKET_PRICE = parseFloat(s.ticket_price || '45');

  const allPersons = db.prepare('SELECT * FROM persons').all();
  const results    = [];

  const insertPayment = db.prepare(`
    INSERT OR IGNORE INTO payments (person_id, amount_eur, reference, sender_name, booking_date, matched)
    VALUES (@personId, @amount, @reference, @senderName, @date, @matched)
  `);

  // Process all entries inside a transaction, collect matched persons for email sending
  const matchedForEmail = [];

  const processEntries = db.transaction(() => {
    for (const entry of entries) {
      const refUpper = entry.reference.toUpperCase();
      const matchedPerson = allPersons.find(p => refUpper.includes(p.code)) || null;

      const order = matchedPerson
        ? db.prepare('SELECT * FROM orders WHERE person_id = ? AND submitted = 1 ORDER BY id DESC LIMIT 1')
            .get(matchedPerson.id)
        : null;

      const matched = !!(matchedPerson && order &&
        Math.abs(entry.amount - order.total_eur) < 0.01);

      const info = insertPayment.run({
        personId:   matchedPerson ? matchedPerson.id : null,
        amount:     entry.amount,
        reference:  entry.reference,
        senderName: entry.senderName,
        date:       entry.date,
        matched:    matched ? 1 : 0,
      });

      // Mark order as paid if freshly matched (not already paid)
      if (matched && order && !order.paid) {
        db.prepare("UPDATE orders SET paid = 1, paid_at = datetime('now') WHERE id = ?").run(order.id);
        db.prepare('UPDATE payments SET qr_sent = 1 WHERE id = ?').run(info.lastInsertRowid);
        matchedForEmail.push({ person: matchedPerson, order });
      }

      results.push({
        reference:   entry.reference,
        senderName:  entry.senderName,
        amount:      entry.amount,
        matched,
        personName:  matchedPerson ? matchedPerson.name : null,
        paymentId:   info.lastInsertRowid || null,
      });
    }
  });

  processEntries();

  // Send emails outside the transaction (async I/O)
  const emailResults = [];
  for (const { person, order } of matchedForEmail) {
    try {
      const sentTo = await sendTicketsForOrder(db, person, order);
      emailResults.push({ person: person.name, sentTo, ok: true });
    } catch (err) {
      emailResults.push({ person: person.name, error: err.message, ok: false });
    }
  }

  res.json({
    processed: results.length,
    newlyPaid: matchedForEmail.length,
    emailsSent: emailResults,
    results,
  });
});

// ── GET /api/payments ─────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const payments = db.prepare(`
    SELECT p.*, pe.name AS person_name, pe.email AS person_email
    FROM payments p
    LEFT JOIN persons pe ON pe.id = p.person_id
    ORDER BY p.id DESC
  `).all();
  res.json({ payments });
});

// ── POST /api/payments/:id/send ────────────────────────────────────────────────
// Manual re-send: useful if auto-send failed or admin wants to resend.
router.post('/:id/send', async (req, res) => {
  const db = getDb();
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!payment)           return res.status(404).json({ error: 'Zahlung nicht gefunden' });
  if (!payment.person_id) return res.status(400).json({ error: 'Keine Zuordnung zu einer Person' });

  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(payment.person_id);
  if (!person)            return res.status(400).json({ error: 'Person nicht gefunden' });

  const order = db.prepare(
    'SELECT * FROM orders WHERE person_id = ? ORDER BY id DESC LIMIT 1'
  ).get(payment.person_id);
  if (!order) return res.status(400).json({ error: 'Keine Bestellung gefunden' });

  const orderTickets = db.prepare('SELECT * FROM order_tickets WHERE order_id = ?').all(order.id);
  if (!orderTickets.length) return res.status(400).json({ error: 'Keine Tickets in der Bestellung' });

  const hasAnyEmail = orderTickets.some(t => (t.ticket_email || '').trim());
  if (!hasAnyEmail) {
    return res.status(400).json({ error: 'Keine E-Mail-Adressen f\u00fcr die Tickets hinterlegt.' });
  }

  try {
    const sentTo = await sendTicketsForOrder(db, person, order);
    db.prepare('UPDATE payments SET qr_sent = 1 WHERE id = ?').run(payment.id);
    db.prepare("UPDATE orders SET paid = 1, paid_at = datetime('now') WHERE id = ?").run(order.id);
    res.json({ ok: true, sentTo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
