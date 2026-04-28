/**
 * database.js – SQLite Setup (better-sqlite3)
 *
 * Öffnet / erstellt die Datenbank und führt alle nötigen Migrationen aus.
 * Exportiert getDb() und getSettings().
 */
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'app', 'abiball.sqlite');

// Verzeichnis sicherstellen
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  // ── Tabellen erstellen ─────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS persons (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      email      TEXT,
      code       TEXT    NOT NULL UNIQUE,
      num_tickets INTEGER NOT NULL DEFAULT 1,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id    INTEGER NOT NULL REFERENCES persons(id),
      submitted    INTEGER NOT NULL DEFAULT 0,
      paid         INTEGER NOT NULL DEFAULT 0,
      paid_amount  REAL    NOT NULL DEFAULT 0,
      paid_at      TEXT,
      total_eur    REAL    NOT NULL DEFAULT 0,
      epc_blob     TEXT,
      split_payment INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_tickets (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id       INTEGER NOT NULL REFERENCES orders(id),
      ticket_name    TEXT    NOT NULL,
      ticket_email   TEXT,
      extra_info     TEXT,
      qr_token       TEXT    UNIQUE,
      qr_issued_at   TEXT,
      split_ref      TEXT,
      split_epc_blob TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id    INTEGER REFERENCES persons(id),
      amount_eur   REAL    NOT NULL,
      reference    TEXT    NOT NULL,
      sender_name  TEXT,
      booking_date TEXT,
      matched      INTEGER NOT NULL DEFAULT 0,
      qr_sent      INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(reference, amount_eur, booking_date)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
  `);

  // ── Migrationen (ALTER TABLE wenn Spalte noch fehlt) ──────────────────
  const migrations = [
    { table: 'order_tickets', column: 'qr_token',       sql: 'ALTER TABLE order_tickets ADD COLUMN qr_token TEXT UNIQUE' },
    { table: 'order_tickets', column: 'qr_issued_at',   sql: 'ALTER TABLE order_tickets ADD COLUMN qr_issued_at TEXT' },
    { table: 'order_tickets', column: 'split_ref',      sql: 'ALTER TABLE order_tickets ADD COLUMN split_ref TEXT' },
    { table: 'order_tickets', column: 'split_epc_blob', sql: 'ALTER TABLE order_tickets ADD COLUMN split_epc_blob TEXT' },
    { table: 'orders',        column: 'split_payment',  sql: 'ALTER TABLE orders ADD COLUMN split_payment INTEGER NOT NULL DEFAULT 0' },
    { table: 'orders',        column: 'paid_amount',    sql: 'ALTER TABLE orders ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0' },
    { table: 'orders',        column: 'paid_at',        sql: 'ALTER TABLE orders ADD COLUMN paid_at TEXT' },
    { table: 'orders',        column: 'epc_blob',       sql: 'ALTER TABLE orders ADD COLUMN epc_blob TEXT' },
  ];

  for (const m of migrations) {
    const cols = db.pragma(`table_info(${m.table})`).map(c => c.name);
    if (!cols.includes(m.column)) {
      try { db.exec(m.sql); } catch (e) { /* ignore if already exists */ }
    }
  }

  // Default-Settings
  const defaults = [
    ['ticket_price', '45'],
    ['event_name',   'Abiball'],
    ['event_location', ''],
    ['event_date',   ''],
    ['bank_iban',    ''],
    ['bank_bic',     ''],
    ['bank_name',    ''],
  ];
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of defaults) insertSetting.run(k, v);
}

function getSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

module.exports = { getDb, getSettings };
