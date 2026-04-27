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

  // Expose env var config status so admin can verify Docker environment is wired up.
  // Passwords are masked; empty string means "not set".
  const envStatus = {
    SMTP_HOST:    process.env.SMTP_HOST    || '',
    SMTP_PORT:    process.env.SMTP_PORT    || '',
    SMTP_SECURE:  process.env.SMTP_SECURE  || '',
    SMTP_USER:    process.env.SMTP_USER    || '',
    SMTP_PASS:    process.env.SMTP_PASS    ? '●●●●●●' : '',
    MAIL_FROM:    process.env.MAIL_FROM    || '',
    BANK_IBAN:    process.env.BANK_IBAN    || '',
    BANK_BIC:     process.env.BANK_BIC     || '',
    BANK_NAME:    process.env.BANK_NAME    || '',
    TICKET_PRICE: process.env.TICKET_PRICE || '',
    DATA_DIR:     process.env.DATA_DIR     || '',
    PORT:         process.env.PORT         || '',
  };

  res.json({ settings: obj, envStatus });
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
