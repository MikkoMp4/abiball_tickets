/**
 * database.js – SQLite-Datenbankinitialisierung
 */
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

// Always store DB in /app/data/abiball.db — mounted via ./data:/app/data in compose
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'abiball.db');

let db;
let settingsCache = null;

function getDb() {
  if (db) return db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ── Schema ────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS persons (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      email       TEXT    NOT NULL DEFAULT '',
      code        TEXT    NOT NULL UNIQUE,
      num_tickets INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id   INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      submitted   INTEGER NOT NULL DEFAULT 0,
      paid        INTEGER NOT NULL DEFAULT 0,
      paid_at     TEXT,
      total_eur   REAL    NOT NULL DEFAULT 0,
      epc_blob    TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_tickets (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      ticket_name  TEXT    NOT NULL,
      ticket_email TEXT    NOT NULL DEFAULT '',
      extra_info   TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id    INTEGER REFERENCES persons(id) ON DELETE SET NULL,
      amount_eur   REAL,
      reference    TEXT,
      sender_name  TEXT,
      booking_date TEXT,
      matched      INTEGER NOT NULL DEFAULT 0,
      qr_sent      INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
  `);

  // ── Idempotente Migrationen ───────────────────────────────────────────────
  function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === column);
  }

  if (!hasColumn('order_tickets', 'qr_token')) {
    db.exec('ALTER TABLE order_tickets ADD COLUMN qr_token TEXT UNIQUE');
  }
  if (!hasColumn('order_tickets', 'qr_issued_at')) {
    db.exec('ALTER TABLE order_tickets ADD COLUMN qr_issued_at TEXT');
  }

  console.log(`[DB] Using database at: ${DB_PATH}`);

  return db;
}

function getSettings() {
  const d = getDb();
  const rows = d.prepare('SELECT key, value FROM settings').all();
  settingsCache = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return settingsCache;
}

function setSetting(key, value) {
  const d = getDb();
  d.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
  settingsCache = null;
}

module.exports = { getDb, getSettings, setSetting };
