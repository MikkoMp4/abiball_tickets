/**
 * routes/tickets.js – Bestellprozess
 *
 * GET  /api/tickets/config           – Ticket-Preis und Veranstaltungsinfos
 * POST /api/tickets/order            – Bestellung speichern + EPC-QR erzeugen
 * GET  /api/tickets/order/:personId  – Bestellung laden
 *
 * Each ticket now only requires: ticketName + ticketEmail (no class field).
 */
const express = require('express');
const router  = express.Router();
const { getDb, getSettings } = require('../database');
const { buildEpcPayload }   = require('../utils/epcGenerator');
const { generateQrDataUrl } = require('../utils/qrGenerator');

// ── GET /api/tickets/config ──────────────────────────────────────────────────
router.get('/config', (req, res) => {
  const s = getSettings();
  res.json({
    price:       parseFloat(s.ticket_price || '45'),
    event:       s.event_name     || 'Abiball',
    location:    s.event_location || '',
    date:        s.event_date     || '',
    iban:        s.bank_iban      || '',
    bic:         s.bank_bic       || '',
    accountName: s.bank_name      || '',
  });
});

// ── POST /api/tickets/order ──────────────────────────────────────────────────
router.post('/order', async (req, res) => {
  const { personId, tickets } = req.body;
  // tickets: [{ ticketName, ticketEmail }]
  if (!personId || !Array.isArray(tickets) || tickets.length === 0) {
    return res.status(400).json({ error: 'personId und tickets erforderlich' });
  }

  // Basic e-mail validation
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const t of tickets) {
    if (!t.ticketName || !t.ticketName.trim()) {
      return res.status(400).json({ error: 'Jedes Ticket benötigt einen Namen.' });
    }
    if (!t.ticketEmail || !emailRe.test(t.ticketEmail.trim())) {
      return res.status(400).json({ error: 'Jedes Ticket benötigt eine gültige E-Mail-Adresse.' });
    }
  }

  const db = getDb();
  const s  = getSettings();
  const TICKET_CONFIG = {
    price:       parseFloat(s.ticket_price || '45'),
    iban:        s.bank_iban  || '',
    bic:         s.bank_bic   || '',
    accountName: s.bank_name  || '',
  };

  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(personId);
  if (!person) return res.status(404).json({ error: 'Person nicht gefunden' });

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
  // ticket_class is kept in schema for backwards compat but always empty now
  const insertOrder = db.prepare(
    'INSERT INTO orders (person_id, submitted, total_eur, epc_blob) VALUES (?, 1, ?, ?)'
  );
  const insertTicket = db.prepare(
    'INSERT INTO order_tickets (order_id, ticket_name, ticket_class, extra_info) VALUES (?, ?, ?, ?)'
  );

  const saveOrder = db.transaction(() => {
    const result  = insertOrder.run(personId, totalEur, epcPayload);
    const orderId = result.lastInsertRowid;
    tickets.forEach(t =>
      insertTicket.run(orderId, t.ticketName.trim(), '', t.ticketEmail.trim())
      // extra_info column reused for e-mail; ticket_class intentionally left empty
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
