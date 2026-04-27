/**
 * routes/payments.js – Zahlungsabgleich und Ticket-Versand
 *
 * POST /api/payments/upload   – Kontoauszug (CSV) hochladen und prüfen
 * GET  /api/payments          – Alle Zahlungen auflisten
 * POST /api/payments/:id/send – QR-Tickets an hinterlegte E-Mail senden
 */
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');

const { getDb }           = require('../database');
const { parseBankCsv }    = require('../utils/bankParser');
const { generateQrBuffer } = require('../utils/qrGenerator');
const { sendTicketEmail }  = require('../utils/emailSender');

const TICKET_PRICE = parseFloat(process.env.TICKET_PRICE || '45');

// Multer-Konfiguration: CSV-Upload im Arbeitsspeicher (kein Dateipfad)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.csv', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ── POST /api/payments/upload ────────────────────────────────────────────────
router.post('/upload', upload.single('statement'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine CSV-Datei hochgeladen' });

  const csvText = req.file.buffer.toString('utf8');

  const entries = parseBankCsv(csvText);
  const db      = getDb();

  const allPersons = db.prepare('SELECT * FROM persons').all();
  const results    = [];

  const insertPayment = db.prepare(`
    INSERT OR IGNORE INTO payments (person_id, amount_eur, reference, sender_name, booking_date, matched)
    VALUES (@personId, @amount, @reference, @senderName, @date, @matched)
  `);

  const processEntries = db.transaction(() => {
    for (const entry of entries) {
      // Versuch, Person anhand des Verwendungszwecks zu finden (Code im Betreff)
      const refUpper = entry.reference.toUpperCase();
      const matchedPerson = allPersons.find(p => refUpper.includes(p.code)) || null;

      // Betrag prüfen
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
  res.json({ processed: results.length, results });
});

// ── GET /api/payments ────────────────────────────────────────────────────────
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

// ── POST /api/payments/:id/send ──────────────────────────────────────────────
router.post('/:id/send', async (req, res) => {
  const db = getDb();
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Zahlung nicht gefunden' });
  if (!payment.person_id) return res.status(400).json({ error: 'Keine Zuordnung zu einer Person' });

  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(payment.person_id);
  if (!person?.email) return res.status(400).json({ error: 'Keine E-Mail-Adresse hinterlegt' });

  const order = db.prepare(
    'SELECT * FROM orders WHERE person_id = ? AND submitted = 1 ORDER BY id DESC LIMIT 1'
  ).get(payment.person_id);
  if (!order) return res.status(400).json({ error: 'Keine Bestellung gefunden' });

  const orderTickets = db.prepare('SELECT * FROM order_tickets WHERE order_id = ?').all(order.id);

  try {
    // Einen QR-Code pro Ticket generieren (Inhalt: eindeutiger Ticketidentifier)
    const qrBuffers = await Promise.all(
      orderTickets.map(t =>
        generateQrBuffer(JSON.stringify({
          ticketId:   t.id,
          orderId:    order.id,
          personCode: person.code,
          name:       t.ticket_name,
        }))
      )
    );

    await sendTicketEmail({
      to:         person.email,
      personName: person.name,
      qrBuffers,
    });

    db.prepare('UPDATE payments SET qr_sent = 1 WHERE id = ?').run(payment.id);
    res.json({ ok: true, sentTo: person.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
