/**
 * routes/tickets.js – Bestellprozess
 *
 * GET  /api/tickets/config                          – Ticket-Preis und Veranstaltungsinfos
 * POST /api/tickets/order                           – Bestellung speichern + EPC-QR erzeugen
 * GET  /api/tickets/my-order?code=CODE              – Bestehende Bestellung laden (Manage-Mode)
 * PATCH /api/tickets/order/:orderId/ticket/:ticketId – Ticket-Name/E-Mail ändern
 * DELETE /api/tickets/order/:orderId/ticket/:ticketId – Einzelnes Ticket löschen
 *
 * Each ticket only requires: ticketName + ticketEmail (no class field).
 */
const express = require('express');
const router  = express.Router();
const { getDb, getSettings } = require('../database');
const { buildEpcPayload }   = require('../utils/epcGenerator');
const { generateQrDataUrl } = require('../utils/qrGenerator');

// ── GET /api/tickets/config ────────────────────────────────────────────────
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

// ── POST /api/tickets/order ───────────────────────────────────────────────
// Race condition protected: the entire check + insert runs inside a single
// SQLite exclusive transaction, so two simultaneous requests with the same
// code cannot both succeed.
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
      return res.status(400).json({ error: 'Jedes Ticket ben\u00f6tigt einen Namen.' });
    }
    if (!t.ticketEmail || !emailRe.test(t.ticketEmail.trim())) {
      return res.status(400).json({ error: 'Jedes Ticket ben\u00f6tigt eine g\u00fcltige E-Mail-Adresse.' });
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

  // EPC-Code generieren (before transaction – async, can’t run inside sync tx)
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(personId);
  if (!person) return res.status(404).json({ error: 'Person nicht gefunden' });

  if (tickets.length > person.num_tickets) {
    return res.status(400).json({
      error: `Zu viele Tickets. Maximal ${person.num_tickets} erlaubt.`
    });
  }

  const totalEur   = tickets.length * TICKET_CONFIG.price;
  const reference  = `ABIBALL-${person.code}`;
  const epcPayload = buildEpcPayload({
    name:      TICKET_CONFIG.accountName,
    iban:      TICKET_CONFIG.iban,
    bic:       TICKET_CONFIG.bic,
    amount:    totalEur,
    reference,
  });
  const epcQr = await generateQrDataUrl(epcPayload);

  // Atomic transaction: check-then-insert cannot be split by a concurrent request
  const insertOrder = db.prepare(
    'INSERT INTO orders (person_id, submitted, total_eur, epc_blob) VALUES (?, 1, ?, ?)'
  );
  const insertTicket = db.prepare(
    'INSERT INTO order_tickets (order_id, ticket_name, ticket_email) VALUES (?, ?, ?)'
  );

  let orderId;
  try {
    const saveOrder = db.transaction(() => {
      // --- RACE CONDITION GUARD ---
      // If another request already inserted an order for this person_id
      // (e.g. two browser tabs, two people sharing a code), abort immediately.
      const existing = db.prepare(
        'SELECT id FROM orders WHERE person_id = ? AND submitted = 1'
      ).get(personId);
      if (existing) {
        const err = new Error('already_ordered');
        err.statusCode = 409;
        throw err;
      }

      const result = insertOrder.run(personId, totalEur, epcPayload);
      const oid    = result.lastInsertRowid;
      tickets.forEach(t =>
        insertTicket.run(oid, t.ticketName.trim(), t.ticketEmail.trim())
      );
      return oid;
    });
    orderId = saveOrder();
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 409) {
      return res.status(409).json({
        error: 'Du hast bereits eine Bestellung abgesendet. Gib deinen Code erneut ein, um sie einzusehen.',
      });
    }
    return res.status(code).json({ error: err.message });
  }

  res.json({ orderId, totalEur, reference, epcQr });
});

// ── GET /api/tickets/my-order?code=CODE ──────────────────────────────────────
// Manage-Mode: load an existing order so the user can review or edit it.
router.get('/my-order', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Code fehlt' });

  const db = getDb();
  const person = db.prepare('SELECT * FROM persons WHERE code = ?').get(code.trim().toUpperCase());
  if (!person) return res.status(404).json({ error: 'Ung\u00fcltiger Code' });

  const order = db.prepare(
    'SELECT * FROM orders WHERE person_id = ? AND submitted = 1 ORDER BY id DESC LIMIT 1'
  ).get(person.id);
  if (!order) return res.status(404).json({ error: 'Keine Bestellung gefunden' });

  const tickets = db.prepare('SELECT * FROM order_tickets WHERE order_id = ?').all(order.id);

  let epcQr = null;
  if (order.epc_blob) {
    epcQr = await generateQrDataUrl(order.epc_blob);
  }

  const s = getSettings();
  res.json({
    order,
    tickets,
    epcQr,
    reference: `ABIBALL-${person.code}`,
    config: {
      price:       parseFloat(s.ticket_price || '45'),
      iban:        s.bank_iban      || '',
      accountName: s.bank_name      || '',
    },
  });
});

// ── PATCH /api/tickets/order/:orderId/ticket/:ticketId ───────────────────────
// Edit a ticket’s name and/or email. Code must match the order’s owner.
router.patch('/order/:orderId/ticket/:ticketId', (req, res) => {
  const { code, ticketName, ticketEmail } = req.body;
  const { orderId, ticketId } = req.params;

  if (!code || !ticketName || !ticketEmail) {
    return res.status(400).json({ error: 'code, ticketName und ticketEmail erforderlich' });
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(ticketEmail.trim())) {
    return res.status(400).json({ error: 'Ung\u00fcltige E-Mail-Adresse' });
  }

  const db = getDb();

  // Verify code ownership
  const person = db.prepare('SELECT * FROM persons WHERE code = ?').get(code.trim().toUpperCase());
  if (!person) return res.status(403).json({ error: 'Ung\u00fcltiger Code' });

  const order = db.prepare(
    'SELECT * FROM orders WHERE id = ? AND person_id = ?'
  ).get(orderId, person.id);
  if (!order) return res.status(403).json({ error: 'Keine Berechtigung' });

  const ticket = db.prepare(
    'SELECT * FROM order_tickets WHERE id = ? AND order_id = ?'
  ).get(ticketId, orderId);
  if (!ticket) return res.status(404).json({ error: 'Ticket nicht gefunden' });

  // Store old email to detect changes (used by caller for re-send logic)
  const oldEmail = ticket.ticket_email;

  db.prepare(
    'UPDATE order_tickets SET ticket_name = ?, ticket_email = ? WHERE id = ?'
  ).run(ticketName.trim(), ticketEmail.trim(), ticketId);

  res.json({
    success: true,
    emailChanged: oldEmail !== ticketEmail.trim(),
    paid: order.paid === 1,
  });
});

// ── DELETE /api/tickets/order/:orderId/ticket/:ticketId ──────────────────────
// Remove a single ticket from an unpaid order. Code must match the owner.
router.delete('/order/:orderId/ticket/:ticketId', (req, res) => {
  const { code } = req.body;
  const { orderId, ticketId } = req.params;

  if (!code) return res.status(400).json({ error: 'Code fehlt' });

  const db = getDb();
  const s  = getSettings();

  // Verify code ownership
  const person = db.prepare('SELECT * FROM persons WHERE code = ?').get(code.trim().toUpperCase());
  if (!person) return res.status(403).json({ error: 'Ung\u00fcltiger Code' });

  const order = db.prepare(
    'SELECT * FROM orders WHERE id = ? AND person_id = ?'
  ).get(orderId, person.id);
  if (!order) return res.status(403).json({ error: 'Keine Berechtigung' });

  // Block deletion after payment
  if (order.paid === 1) {
    return res.status(409).json({
      error: 'Die Bestellung wurde bereits bezahlt. Bitte das Komitee kontaktieren.'
    });
  }

  // Prevent deleting the last ticket
  const remaining = db.prepare(
    'SELECT COUNT(*) as cnt FROM order_tickets WHERE order_id = ?'
  ).get(orderId);
  if (remaining.cnt <= 1) {
    return res.status(409).json({
      error: 'Mindestens ein Ticket muss verbleiben. Um die gesamte Bestellung zu stornieren, wende dich ans Komitee.'
    });
  }

  // Verify the ticket belongs to this order
  const ticket = db.prepare(
    'SELECT * FROM order_tickets WHERE id = ? AND order_id = ?'
  ).get(ticketId, orderId);
  if (!ticket) return res.status(404).json({ error: 'Ticket nicht gefunden' });

  const ticketPrice = parseFloat(s.ticket_price || '45');

  db.transaction(() => {
    db.prepare('DELETE FROM order_tickets WHERE id = ?').run(ticketId);
    db.prepare('UPDATE orders SET total_eur = total_eur - ? WHERE id = ?').run(ticketPrice, orderId);
  })();

  const newTotal = db.prepare('SELECT total_eur FROM orders WHERE id = ?').get(orderId).total_eur;
  res.json({ success: true, newTotalEur: newTotal });
});

// ── GET /api/tickets/order/:personId ─────────────────────────────────────────
// Legacy endpoint – kept for backwards compatibility
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
