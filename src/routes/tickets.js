/**
 * routes/tickets.js – Bestellprozess
 *
 * GET    /api/tickets/config
 * POST   /api/tickets/order                              (race-condition-safe)
 * GET    /api/tickets/my-order?code=CODE                (Manage-Mode)
 * PATCH  /api/tickets/order/:orderId/ticket/:ticketId   (Name/E-Mail ändern)
 * DELETE /api/tickets/order/:orderId/ticket/:ticketId   (Ticket löschen, user-seitig)
 * POST   /api/tickets/validate                          (QR-Token prüfen)
 */
const express = require('express');
const router  = express.Router();
const { getDb, getSettings }           = require('../database');
const { buildEpcPayload }              = require('../utils/epcGenerator');
const { generateQrDataUrl, generateQrBufferForTicket } = require('../utils/qrGenerator');
const { sendSingleTicketEmail }        = require('../utils/emailSender');

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
router.post('/order', async (req, res) => {
  const { personId, tickets } = req.body;
  if (!personId || !Array.isArray(tickets) || tickets.length === 0)
    return res.status(400).json({ error: 'personId und tickets erforderlich' });

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const t of tickets) {
    if (!t.ticketName || !t.ticketName.trim())
      return res.status(400).json({ error: 'Jedes Ticket benötigt einen Namen.' });
    if (!t.ticketEmail || !emailRe.test(t.ticketEmail.trim()))
      return res.status(400).json({ error: 'Jedes Ticket benötigt eine gültige E-Mail-Adresse.' });
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

  if (tickets.length > person.num_tickets)
    return res.status(400).json({ error: `Zu viele Tickets. Maximal ${person.num_tickets} erlaubt.` });

  const totalEur   = tickets.length * TICKET_CONFIG.price;
  const reference  = `ABIBALL-${person.code}`;
  const epcPayload = buildEpcPayload({
    name: TICKET_CONFIG.accountName, iban: TICKET_CONFIG.iban,
    bic: TICKET_CONFIG.bic, amount: totalEur, reference,
  });
  const epcQr = await generateQrDataUrl(epcPayload);

  const insertOrder  = db.prepare('INSERT INTO orders (person_id, submitted, total_eur, epc_blob) VALUES (?, 1, ?, ?)');
  const insertTicket = db.prepare('INSERT INTO order_tickets (order_id, ticket_name, ticket_email) VALUES (?, ?, ?)');

  let orderId;
  try {
    const saveOrder = db.transaction(() => {
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
      tickets.forEach(t => insertTicket.run(oid, t.ticketName.trim(), t.ticketEmail.trim()));
      return oid;
    });
    orderId = saveOrder();
  } catch (err) {
    if (err.statusCode === 409) {
      return res.status(409).json({
        error: 'Du hast bereits eine Bestellung abgesendet. Gib deinen Code erneut ein, um sie einzusehen.',
      });
    }
    return res.status(500).json({ error: err.message });
  }

  res.json({ orderId, totalEur, reference, epcQr });
});

// ── GET /api/tickets/my-order?code=CODE ──────────────────────────────────────
router.get('/my-order', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Code fehlt' });

  const db     = getDb();
  const person = db.prepare('SELECT * FROM persons WHERE code = ?').get(code.trim().toUpperCase());
  if (!person) return res.status(404).json({ error: 'Ungültiger Code' });

  const order = db.prepare(
    'SELECT * FROM orders WHERE person_id = ? AND submitted = 1 ORDER BY id DESC LIMIT 1'
  ).get(person.id);
  if (!order) return res.status(404).json({ error: 'Keine Bestellung gefunden' });

  const tickets = db.prepare('SELECT * FROM order_tickets WHERE order_id = ?').all(order.id);

  let epcQr = null;
  if (order.epc_blob) epcQr = await generateQrDataUrl(order.epc_blob);

  const s = getSettings();
  res.json({
    order, tickets, epcQr,
    reference: `ABIBALL-${person.code}`,
    config: {
      price:       parseFloat(s.ticket_price || '45'),
      iban:        s.bank_iban  || '',
      accountName: s.bank_name  || '',
    },
  });
});

// ── PATCH /api/tickets/order/:orderId/ticket/:ticketId ───────────────────────
// Ändert Name + E-Mail eines Tickets. Wenn die E-Mail sich geändert hat UND
// die Bestellung bezahlt ist, wird automatisch eine neue Ticket-E-Mail gesendet
// (mit rotiertem QR-Token, damit der alte QR-Code ungültig wird).
router.patch('/order/:orderId/ticket/:ticketId', async (req, res) => {
  const { code, ticketName, ticketEmail } = req.body;
  const { orderId, ticketId } = req.params;

  if (!code || !ticketName || !ticketEmail)
    return res.status(400).json({ error: 'code, ticketName und ticketEmail erforderlich' });

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(ticketEmail.trim()))
    return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });

  const db     = getDb();
  const person = db.prepare('SELECT * FROM persons WHERE code = ?').get(code.trim().toUpperCase());
  if (!person) return res.status(403).json({ error: 'Ungültiger Code' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND person_id = ?').get(orderId, person.id);
  if (!order) return res.status(403).json({ error: 'Keine Berechtigung' });

  const ticket = db.prepare('SELECT * FROM order_tickets WHERE id = ? AND order_id = ?').get(ticketId, orderId);
  if (!ticket) return res.status(404).json({ error: 'Ticket nicht gefunden' });

  const oldEmail   = ticket.ticket_email;
  const newEmail   = ticketEmail.trim();
  const emailChanged = oldEmail !== newEmail;

  db.prepare('UPDATE order_tickets SET ticket_name = ?, ticket_email = ? WHERE id = ?')
    .run(ticketName.trim(), newEmail, ticketId);

  // Auto-resend wenn Bestellung bezahlt und E-Mail geändert
  let emailResent = false;
  if (emailChanged && order.paid === 1) {
    try {
      const updatedTicket = db.prepare('SELECT * FROM order_tickets WHERE id = ?').get(ticketId);
      const qrBuffer = await generateQrBufferForTicket(db, updatedTicket, {
        orderId: order.id, personCode: person.code,
      });
      await sendSingleTicketEmail({
        to:         newEmail,
        personName: ticketName.trim(),
        qrBuffer,
        updated:    true,
      });
      emailResent = true;
    } catch (e) {
      // E-Mail-Fehler soll die Speicherung nicht rückgängig machen
      console.error('[tickets] resend email failed:', e.message);
    }
  }

  res.json({
    success: true,
    emailChanged,
    emailResent,
    paid: order.paid === 1,
  });
});

// ── DELETE /api/tickets/order/:orderId/ticket/:ticketId ──────────────────────
// User-seitiges Ticket-Löschen (Code als Auth).
// Blockiert wenn: Bestellung bezahlt | letztes verbleibendes Ticket.
router.delete('/order/:orderId/ticket/:ticketId', (req, res) => {
  const { code } = req.body;
  const { orderId, ticketId } = req.params;

  if (!code) return res.status(400).json({ error: 'code erforderlich' });

  const db     = getDb();
  const s      = getSettings();
  const person = db.prepare('SELECT * FROM persons WHERE code = ?').get(code.trim().toUpperCase());
  if (!person) return res.status(403).json({ error: 'Ungültiger Code' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND person_id = ?').get(orderId, person.id);
  if (!order) return res.status(403).json({ error: 'Keine Berechtigung' });

  if (order.paid === 1)
    return res.status(409).json({
      error: 'paid_order',
      message: 'Diese Bestellung wurde bereits bezahlt. Änderungen sind nicht mehr möglich. Bitte wende dich an das Orga-Team.',
    });

  const remaining = db.prepare('SELECT COUNT(*) AS cnt FROM order_tickets WHERE order_id = ?').get(orderId);
  if (remaining.cnt <= 1)
    return res.status(409).json({
      error: 'last_ticket',
      message: 'Mindestens ein Ticket muss in der Bestellung verbleiben. Um die gesamte Bestellung zu stornieren, wende dich an das Orga-Team.',
    });

  const ticket = db.prepare('SELECT * FROM order_tickets WHERE id = ? AND order_id = ?').get(ticketId, orderId);
  if (!ticket) return res.status(404).json({ error: 'Ticket nicht gefunden' });

  const ticketPrice = parseFloat(s.ticket_price || '45');
  db.transaction(() => {
    db.prepare('DELETE FROM order_tickets WHERE id = ?').run(ticketId);
    db.prepare('UPDATE orders SET total_eur = total_eur - ? WHERE id = ?').run(ticketPrice, orderId);
  })();

  const newTotal = db.prepare('SELECT total_eur FROM orders WHERE id = ?').get(orderId).total_eur;
  res.json({ ok: true, newTotalEur: newTotal });
});

// ── POST /api/tickets/validate ───────────────────────────────────────────────
// QR-Token validieren (für Einlass-Scanner).
// Body: { token }
router.post('/validate', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ valid: false, error: 'Token fehlt' });

  const db     = getDb();
  const ticket = db.prepare(
    'SELECT ot.*, o.paid, o.person_id, p.name AS person_name, p.code AS person_code ' +
    'FROM order_tickets ot ' +
    'JOIN orders o ON o.id = ot.order_id ' +
    'JOIN persons p ON p.id = o.person_id ' +
    'WHERE ot.qr_token = ?'
  ).get(token);

  if (!ticket)        return res.json({ valid: false, reason: 'Unbekanntes Token' });
  if (!ticket.paid)   return res.json({ valid: false, reason: 'Noch nicht bezahlt', name: ticket.ticket_name });

  res.json({
    valid:      true,
    ticketId:   ticket.id,
    name:       ticket.ticket_name,
    personName: ticket.person_name,
    personCode: ticket.person_code,
    issuedAt:   ticket.qr_issued_at,
  });
});

// ── GET /api/tickets/order/:personId (legacy) ─────────────────────────────────
router.get('/order/:personId', async (req, res) => {
  const db    = getDb();
  const order = db.prepare(
    'SELECT * FROM orders WHERE person_id = ? AND submitted = 1 ORDER BY id DESC LIMIT 1'
  ).get(req.params.personId);
  if (!order) return res.status(404).json({ error: 'Keine Bestellung gefunden' });
  const tickets = db.prepare('SELECT * FROM order_tickets WHERE order_id = ?').all(order.id);
  let epcQr = null;
  if (order.epc_blob) epcQr = await generateQrDataUrl(order.epc_blob);
  res.json({ order, tickets, epcQr });
});

module.exports = router;
