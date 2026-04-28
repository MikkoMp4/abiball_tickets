/**
 * database.js – SQLite-Datenbank-Initialisierung & Schema-Migrationen
 */
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH  = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tickets.db');
let   db;

function getDb() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  // ── persons ────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS persons (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      email       TEXT,
      code        TEXT    NOT NULL UNIQUE,
      num_tickets INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── orders ─────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id     INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      total_eur     REAL    NOT NULL DEFAULT 0,
      paid          INTEGER NOT NULL DEFAULT 0,
      paid_amount   REAL    NOT NULL DEFAULT 0,
      paid_at       TEXT,
      submitted     INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── order_tickets ──────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_tickets (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      ticket_name  TEXT    NOT NULL,
      ticket_email TEXT,
      extra_info   TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── payments ───────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id    INTEGER REFERENCES persons(id) ON DELETE SET NULL,
      amount_eur   REAL    NOT NULL,
      reference    TEXT,
      sender_name  TEXT,
      booking_date TEXT,
      matched      INTEGER NOT NULL DEFAULT 0,
      qr_sent      INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(booking_date, reference, amount_eur)
    );
  `);

  // ── settings ───────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // ── Migrationen: neue Spalten nachrüsten ──────────────────────────────────
  const migrations = [
    // Split-Payment auf Order-Ebene
    { table: 'orders', col: 'split_payment', sql: 'ALTER TABLE orders ADD COLUMN split_payment INTEGER NOT NULL DEFAULT 0' },

    // Split-Infos auf Ticket-Ebene
    { table: 'order_tickets', col: 'split_ref',        sql: 'ALTER TABLE order_tickets ADD COLUMN split_ref TEXT' },
    { table: 'order_tickets', col: 'split_ticket_num', sql: 'ALTER TABLE order_tickets ADD COLUMN split_ticket_num INTEGER' },
    { table: 'order_tickets', col: 'split_epc_blob',   sql: 'ALTER TABLE order_tickets ADD COLUMN split_epc_blob TEXT' },
    { table: 'order_tickets', col: 'split_paid_at',    sql: 'ALTER TABLE order_tickets ADD COLUMN split_paid_at TEXT' },
    { table: 'order_tickets', col: 'split_amount',     sql: 'ALTER TABLE order_tickets ADD COLUMN split_amount REAL' },

    // QR-Token für Gültigkeitsverfolgung
    { table: 'order_tickets', col: 'qr_token',    sql: 'ALTER TABLE order_tickets ADD COLUMN qr_token TEXT UNIQUE' },
    { table: 'order_tickets', col: 'qr_issued_at', sql: 'ALTER TABLE order_tickets ADD COLUMN qr_issued_at TEXT' },
  ];

  for (const m of migrations) {
    try {
      const exists = db.prepare(
        `SELECT COUNT(*) AS c FROM pragma_table_info(?) WHERE name = ?`
      ).get(m.table, m.col);
      if (exists.c === 0) db.exec(m.sql);
    } catch { /* Spalte existiert bereits */ }
  }
}

// ── Settings-Hilfsfunktionen ─────────────────────────────────────────────────
function getSettings() {
  const db   = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function setSetting(key, value) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

module.exports = { getDb, getSettings, setSetting };
