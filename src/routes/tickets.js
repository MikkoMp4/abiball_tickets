/**
 * routes/tickets.js – Bestellprozess
 *
 * GET  /api/tickets/config           – Ticket-Preis und Veranstaltungsinfos
 * POST /api/tickets/order            – Bestellung speichern + EPC-QR erzeugen
 * GET  /api/tickets/order/:personId  – Bestellung laden
 */
const express = require('express');
const router  = express.Router();
const { getDb } = require('../database');
const { buildEpcPayload }   = require('../utils/epcGenerator');
const { generateQrDataUrl } = require('../utils/qrGenerator');

// Ticket-Konfiguration (Platzhalter – kann über .env oder DB konfiguriert werden)
const TICKET_CONFIG = {
  price:      45.00,   // EUR pro Ticket
  event:      'Abiball 2025',
  location:   'Eventlocation, Musterstadt',
  date:       '21.06.2025',
  iban:       process.env.BANK_IBAN  || 'DE00 1234 5678 9012 3456 78',
  bic:        process.env.BANK_BIC   || 'XXXXXXXX',
  accountName: process.env.BANK_NAME || 'Abiball-Komitee e.V.',
};

// ── GET /api/tickets/config ──────────────────────────────────────────────────
router.get('/config', (req, res) => {
  res.json(TICKET_CONFIG);
});

// ── POST /api/tickets/order ──────────────────────────────────────────────────
router.post('/order', async (req, res) => {
  const { personId, tickets } = req.body;
  // tickets: [{ ticketName, ticketClass, extraInfo }]
  if (!personId || !Array.isArray(tickets) || tickets.length === 0) {
    return res.status(400).json({ error: 'personId und tickets erforderlich' });
  }

  const db = getDb();
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(personId);
  if (!person) return res.status(404).json({ error: 'Person nicht gefunden' });

  // Anzahl prüfen
  if (tickets.length > person.num_tickets) {
    return res.status(400).json({
      error: `Zu viele Tickets. Maximal ${person.num_tickets} erlaubt.`
    });
  }

  const totalEur = tickets.length * TICKET_CONFIG.price;

  // EPC-Code generieren
  const reference  = `ABIBALL-${person.code}`;
  const epcPayload = buildEpcPayload({
    name:      TICKET_CONFIG.accountName,
    iban:      TICKET_CONFIG.iban,
    bic:       TICKET_CONFIG.bic,
    amount:    totalEur,
    reference,
  });
  const epcQr = await generateQrDataUrl(epcPayload);

  // Bestellung speichern
  const insertOrder = db.prepare(
    'INSERT INTO orders (person_id, submitted, total_eur, epc_blob) VALUES (?, 1, ?, ?)'
  );
  const insertTicket = db.prepare(
    'INSERT INTO order_tickets (order_id, ticket_name, ticket_class, extra_info) VALUES (?, ?, ?, ?)'
  );

  const saveOrder = db.transaction(() => {
    const result = insertOrder.run(personId, totalEur, epcPayload);
    const orderId = result.lastInsertRowid;
    tickets.forEach(t =>
      insertTicket.run(orderId, t.ticketName || '', t.ticketClass || '', t.extraInfo || '')
    );
    return orderId;
  });

  try {
    const orderId = saveOrder();
    res.json({ orderId, totalEur, reference, epcQr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tickets/order/:personId ────────────────────────────────────────
router.get('/order/:personId', async (req, res) => {
  const db = getDb();
  const order = db.prepare(
    'SELECT * FROM orders WHERE person_id = ? AND submitted = 1 ORDER BY id DESC LIMIT 1'
  ).get(req.params.personId);

  if (!order) return res.status(404).json({ error: 'Keine Bestellung gefunden' });

  const tickets = db.prepare('SELECT * FROM order_tickets WHERE order_id = ?').all(order.id);

  let epcQr = null;
  if (order.epc_blob) {
    epcQr = await generateQrDataUrl(order.epc_blob);
  }

  res.json({ order, tickets, epcQr });
});

module.exports = router;
