/**
 * server.js – Express-Hauptserver für das Abiball-Ticket-System
 */
require('dotenv').config({ path: '.env' });

const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const rateLimit    = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const adminAuth    = require('./src/middleware/adminAuth');

const app = express();

// Trust reverse-proxy headers (needed when running behind nginx/traefik in Docker)
app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || false,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate-Limiting für alle API-Endpunkte
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte später erneut versuchen.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Login-Versuche. Bitte in 15 Minuten erneut versuchen.' },
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.' },
});

const staticLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});

// Statische Frontend-Dateien
app.use(staticLimiter, express.static(path.join(__dirname, 'public')));

// Auth-Routen
app.use('/api/auth', loginLimiter, require('./src/routes/auth'));

// API-Routen
app.use('/api/admin/settings', adminAuth, apiLimiter, require('./src/routes/settings'));
app.use('/api/admin',          adminAuth, apiLimiter, require('./src/routes/admin'));
app.use('/api/codes',          verifyLimiter, require('./src/routes/codes'));
app.use('/api/tickets',        apiLimiter, require('./src/routes/tickets'));
// payments.js exportiert { router, recalcPaymentStatus } → .router verwenden
app.use('/api/payments',       apiLimiter, require('./src/routes/payments').router);
// Startup: Zahlungsstatus für alle Personen mit Payments neu berechnen
// (repariert Altdaten die vor dem Fix erstellt wurden)
setTimeout(() => {
  try {
    const { recalcPaymentStatus } = require('./src/routes/payments');
    const { getDb } = require('./src/database');
    const db = getDb();
    const persons = db.prepare(
      'SELECT DISTINCT person_id FROM payments WHERE person_id IS NOT NULL'
    ).all();
    for (const { person_id } of persons) {
      recalcPaymentStatus(db, person_id);
    }
    console.log(`[startup] Zahlungsstatus für ${persons.length} Person(en) neu berechnet`);
  } catch (e) {
    console.error('[startup] recalc fehlgeschlagen:', e.message);
  }
}, 0);

// SPA-Fallback
app.get('*', staticLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅  Abiball-Ticket-Server läuft auf http://localhost:${PORT}`);
});

module.exports = app;
