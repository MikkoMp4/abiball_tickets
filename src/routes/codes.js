/**
 * routes/codes.js – Code-Validierung
 *
 * POST /api/codes/verify  – Zugangscode prüfen und Person zurückgeben
 *
 * Response includes `alreadyOrdered` flag plus full order details so the
 * frontend can redirect directly to manage-mode instead of showing a
 * generic "already ordered" error.
 */
const express = require('express');
const router  = express.Router();
const { getDb } = require('../database');

// ── POST /api/codes/verify ────────────────────────────────────────────
router.post('/verify', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code fehlt' });

  const db = getDb();
  const person = db.prepare('SELECT * FROM persons WHERE code = ?').get(code.trim().toUpperCase());

  if (!person) return res.status(404).json({ error: 'Ung\u00fcltiger Code' });

  // Check for an existing submitted order
  const order = db.prepare(
    'SELECT * FROM orders WHERE person_id = ? AND submitted = 1 ORDER BY id DESC LIMIT 1'
  ).get(person.id);

  if (!order) {
    // No order yet – send to fresh order form
    return res.json({ person, alreadyOrdered: false });
  }

  // Order exists – include details so frontend can go straight to manage-mode
  return res.json({
    person,
    alreadyOrdered: true,
    orderId:   order.id,
    reference: `ABIBALL-${person.code}`,
    totalEur:  order.total_eur,
    paid:      order.paid === 1,
  });
});

module.exports = router;
