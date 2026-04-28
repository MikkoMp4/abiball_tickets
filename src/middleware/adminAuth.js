/**
 * middleware/adminAuth.js
 * Verifies the adminToken JWT cookie on every /api/admin/* request.
 * Returns 401 if missing or invalid.
 */
const jwt = require('jsonwebtoken');

const SECRET = process.env.ADMIN_JWT_SECRET || 'changeme-set-ADMIN_JWT_SECRET-in-env';

function adminAuth(req, res, next) {
  const token = req.cookies?.adminToken;
  if (!token) {
    return res.status(401).json({ error: 'Nicht authentifiziert' });
  }
  try {
    jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token ungültig oder abgelaufen' });
  }
}

module.exports = adminAuth;
