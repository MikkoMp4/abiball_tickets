/**
 * routes/codes.js – Code-Validierung
 *
 * POST /api/codes/verify  – Zugangscode prüfen und Person zurückgeben
 */
const express = require('express');
const router  = express.Router();
const { getDb } = require('../database');

// ── POST /api/codes/verify ───────────────────────────────────────────────────
router.post('/verify', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code fehlt' });

  const db = getDb();
  const person = db.prepare('SELECT * FROM persons WHERE code = ?').get(code.trim().toUpperCase());

  if (!person) return res.status(404).json({ error: 'Ungültiger Code' });

  // Prüfen ob bereits eine abgeschlossene Bestellung vorliegt
  const order = db.prepare(
    'SELECT * FROM orders WHERE person_id = ? AND submitted = 1'
  ).get(person.id);

  res.json({ person, alreadyOrdered: !!order });
});

module.exports = router;
