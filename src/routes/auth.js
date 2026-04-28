/**
 * routes/auth.js
 *
 * POST /api/auth/login   – verify ADMIN_PASSWORD, set 60-day httpOnly cookie
 * POST /api/auth/logout  – clear the adminToken cookie
 * GET  /api/auth/check   – returns 200 if cookie is valid, 401 otherwise
 */
const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcrypt');

const SECRET   = process.env.ADMIN_JWT_SECRET  || 'changeme-set-ADMIN_JWT_SECRET-in-env';
const RAW_PW   = process.env.ADMIN_PASSWORD    || '';

// Pre-hash the plain-text password once at startup so every login attempt
// doesn't need to re-hash. bcrypt.compare() is still used for the check.
let hashedPassword = null;
(async () => {
  if (RAW_PW) {
    hashedPassword = await bcrypt.hash(RAW_PW, 10);
  }
})();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge:   60 * 24 * 60 * 60 * 1000, // 60 days in ms
  secure: process.env.NODE_ENV === 'production',
};

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { password } = req.body;

  if (!RAW_PW) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD ist nicht gesetzt.' });
  }
  if (!password) {
    return res.status(400).json({ error: 'Passwort fehlt.' });
  }

  const match = await bcrypt.compare(password, hashedPassword);
  if (!match) {
    // Short delay to slow brute-force even after rate limiter
    await new Promise(r => setTimeout(r, 500));
    return res.status(401).json({ error: 'Falsches Passwort.' });
  }

  const token = jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '60d' });
  res.cookie('adminToken', token, COOKIE_OPTS);
  res.json({ ok: true });
});

// ── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (_req, res) => {
  res.clearCookie('adminToken');
  res.json({ ok: true });
});

// ── GET /api/auth/check ──────────────────────────────────────────────────────
router.get('/check', (req, res) => {
  const token = req.cookies?.adminToken;
  if (!token) return res.status(401).json({ authenticated: false });
  try {
    jwt.verify(token, SECRET);
    res.json({ authenticated: true });
  } catch {
    res.status(401).json({ authenticated: false });
  }
});

module.exports = router;
