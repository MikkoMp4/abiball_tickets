/**
 * routes/settings.js – Systemkonfiguration (IBAN, BIC, Ticketpreis, Event-Daten)
 *
 * GET  /api/admin/settings        – Alle Einstellungen auslesen
 * POST /api/admin/settings        – Einstellungen speichern / aktualisieren
 */
const express = require('express');
const router  = express.Router();
const { getDb } = require('../database');

const ALLOWED_KEYS = [
  'event_name',
  'event_location',
  'event_date',
  'ticket_price',
  'bank_iban',
  'bank_bic',
  'bank_name',
];

// ── GET /api/admin/settings ──────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db   = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj  = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({ settings: obj });
});

// ── POST /api/admin/settings ─────────────────────────────────────────────────
router.post('/', (req, res) => {
  const updates = req.body; // { key: value, … }
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Ungültige Daten' });
  }

  const db     = getDb();
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  const saveAll = db.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      if (!ALLOWED_KEYS.includes(key)) continue;
      upsert.run(key, String(value));
    }
  });

  try {
    saveAll();
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const obj  = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({ ok: true, settings: obj });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
