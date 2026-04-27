/**
 * database.js – SQLite-Datenbank und Schema-Initialisierung
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../abiball.sqlite');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS persons (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      email       TEXT,
      code        TEXT    NOT NULL UNIQUE,
      num_tickets INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id  INTEGER NOT NULL REFERENCES persons(id),
      submitted  INTEGER NOT NULL DEFAULT 0,
      total_eur  REAL,
      epc_blob   TEXT,
      paid       INTEGER NOT NULL DEFAULT 0,
      paid_at    TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_tickets (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id     INTEGER NOT NULL REFERENCES orders(id),
      ticket_name  TEXT    NOT NULL,
      ticket_class TEXT,
      extra_info   TEXT
    );

    CREATE TABLE IF NOT EXISTS payments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id       INTEGER REFERENCES persons(id),
      amount_eur      REAL,
      reference       TEXT,
      sender_name     TEXT,
      booking_date    TEXT,
      matched         INTEGER NOT NULL DEFAULT 0,
      qr_sent         INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Migrate existing orders table: add paid / paid_at columns if missing
  const orderCols = db.pragma('table_info(orders)').map(c => c.name);
  if (!orderCols.includes('paid')) {
    db.exec('ALTER TABLE orders ADD COLUMN paid INTEGER NOT NULL DEFAULT 0');
  }
  if (!orderCols.includes('paid_at')) {
    db.exec('ALTER TABLE orders ADD COLUMN paid_at TEXT');
  }

  // Seed default settings if not present
  const seedSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  const defaults = [
    ['event_name',    'Abiball 2025'],
    ['event_location','Eventlocation, Musterstadt'],
    ['event_date',    '21.06.2025'],
    ['ticket_price',  '45.00'],
    ['bank_iban',     process.env.BANK_IBAN  || 'DE00 1234 5678 9012 3456 78'],
    ['bank_bic',      process.env.BANK_BIC   || 'XXXXXXXX'],
    ['bank_name',     process.env.BANK_NAME  || 'Abiball-Komitee e.V.'],
  ];
  const seedAll = db.transaction(() => defaults.forEach(([k, v]) => seedSetting.run(k, v)));
  seedAll();
}

/**
 * Returns all settings as a plain key-value object.
 */
function getSettings() {
  const db   = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

module.exports = { getDb, getSettings };
