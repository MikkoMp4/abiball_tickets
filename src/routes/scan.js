/**
 * routes/scan.js – QR-Scan-Validierung für Einlass-Kontrolle
 *
 * GET  /api/admin/scan/history?limit=50  – letzte Scans (für Verlauf-Modal)
 * POST /api/admin/scan                   – Token validieren + Scan protokollieren
 */
const express = require('express');
const router  = express.Router();
const { getDb } = require('../database');

// ── POST /api/admin/scan ──────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ valid: false, reason: 'token_missing' });

  const db  = getDb();
  const row = db.prepare(`
    SELECT ot.id, ot.order_id, ot.ticket_name, ot.ticket_paid,
           o.paid AS order_paid,
           p.name AS person_name, p.code AS person_code
    FROM order_tickets ot
    JOIN orders  o ON o.id = ot.order_id
    JOIN persons p ON p.id = o.person_id
    WHERE ot.qr_token = ?
  `).get(token);

  if (!row) return res.json({ valid: false, reason: 'unknown_token' });

  // ticket_paid (pro Ticket) statt order_paid (pro Bestellung) verwenden.
  // Grund: Bei Split-Payment kann order_paid = 2 (Teilzahlung) sein, während
  // einzelne Tickets bereits vollständig bezahlt (ticket_paid = 1) sind.
  const ticketPaid = !!row.ticket_paid;

  const priorCount = db.prepare(
    'SELECT COUNT(*) AS n FROM ticket_scans WHERE ticket_id = ?'
  ).get(row.id).n;
  const scanNumber = priorCount + 1;

  db.prepare(`
    INSERT INTO ticket_scans
      (ticket_id, order_id, ticket_name, person_name, person_code, scan_number, was_paid)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.order_id, row.ticket_name, row.person_name, row.person_code,
         scanNumber, ticketPaid ? 1 : 0);

  res.json({
    valid:      true,
    ticketId:   row.id,
    ticketName: row.ticket_name,
    personName: row.person_name,
    personCode: row.person_code,
    paid:       ticketPaid,
    priorScans: priorCount,   // 0 = erster Scan
    scanNumber,
    scannedAt:  new Date().toISOString(),
  });
});

// ── GET /api/admin/scan/history ───────────────────────────────────────────
router.get('/history', (req, res) => {
  const db    = getDb();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 300);
  const scans = db.prepare(
    'SELECT * FROM ticket_scans ORDER BY id DESC LIMIT ?'
  ).all(limit);
  res.json({ scans });
});

module.exports = router;