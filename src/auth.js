const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const secret = () => process.env.JWT_SECRET || 'dev-only-change-me';

function signToken(payload) {
  return jwt.sign(payload, secret(), { expiresIn: '14d' });
}

function verifyToken(token) {
  return jwt.verify(token, secret());
}

async function hashPin(pin) {
  return bcrypt.hash(String(pin), 10);
}

async function comparePin(pin, hash) {
  return bcrypt.compare(String(pin), hash);
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function authRequired(role) {
  return (req, res, next) => {
    try {
      const token = bearer(req);
      if (!token) return res.status(401).json({ error: 'Authentication required' });
      const user = verifyToken(token);
      if (role && user.role !== role) return res.status(403).json({ error: 'Forbidden' });
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired session' });
    }
  };
}

module.exports = { signToken, verifyToken, hashPin, comparePin, authRequired };
