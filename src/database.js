/**
 * database.js – SQLite-Datenbankinitialisierung
 */
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

// DATA_DIR kommt aus .env (z.B. DATA_DIR=/app), DB-Datei liegt darin
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const DB_PATH  = process.env.DB_PATH  || path.join(DATA_DIR, 'abiball.sqlite');

let db;

function getDb() {
  if (db) return db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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
      paid_amount REAL    NOT NULL DEFAULT 0,
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
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(booking_date, reference, amount_eur)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
  `);

  function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === column);
  }

  // Migrations
  if (!hasColumn('orders', 'split_payment'))
    db.exec('ALTER TABLE orders ADD COLUMN split_payment INTEGER NOT NULL DEFAULT 0');
  if (!hasColumn('orders', 'paid_amount'))
    db.exec('ALTER TABLE orders ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0');
  if (!hasColumn('order_tickets', 'split_ref'))
    db.exec('ALTER TABLE order_tickets ADD COLUMN split_ref TEXT');
  if (!hasColumn('order_tickets', 'split_ticket_num'))
    db.exec('ALTER TABLE order_tickets ADD COLUMN split_ticket_num INTEGER');
  if (!hasColumn('order_tickets', 'split_epc_blob'))
    db.exec('ALTER TABLE order_tickets ADD COLUMN split_epc_blob TEXT');
  if (!hasColumn('order_tickets', 'split_paid_at'))
    db.exec('ALTER TABLE order_tickets ADD COLUMN split_paid_at TEXT');
  if (!hasColumn('order_tickets', 'split_amount'))
    db.exec('ALTER TABLE order_tickets ADD COLUMN split_amount REAL');
  if (!hasColumn('order_tickets', 'qr_token'))
    db.exec('ALTER TABLE order_tickets ADD COLUMN qr_token TEXT');
  if (!hasColumn('order_tickets', 'qr_issued_at'))
    db.exec('ALTER TABLE order_tickets ADD COLUMN qr_issued_at TEXT');

  // UNIQUE-Index für qr_token (separat, da SQLite kein UNIQUE bei ALTER TABLE erlaubt)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_order_tickets_qr_token ON order_tickets (qr_token) WHERE qr_token IS NOT NULL');

  // Settings aus Env-Vars seeden (nur wenn Key noch nicht existiert)
  const insertIfMissing = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const envDefaults = [
    ['bank_iban',      process.env.BANK_IBAN],
    ['bank_bic',       process.env.BANK_BIC],
    ['bank_name',      process.env.BANK_NAME],
    ['ticket_price',   process.env.TICKET_PRICE],
    ['event_name',     process.env.EVENT_NAME],
    ['event_date',     process.env.EVENT_DATE],
    ['event_location', process.env.EVENT_LOCATION],
  ];
  for (const [key, val] of envDefaults) {
    if (val) insertIfMissing.run(key, val);
  }

  console.log(`[DB] Using database at: ${DB_PATH}`);
  return db;
}

function getSettings() {
  const d    = getDb();
  const rows = d.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function setSetting(key, value) {
  getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

module.exports = { getDb, getSettings, setSetting };
