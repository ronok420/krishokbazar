// src/middleware/auth.js — JWT Token Verification
const jwt  = require('jsonwebtoken');
const pool = require('../config/db');

// ── Token verify করো ──────────────────────────────
async function protect(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'লগইন করুন। Token নেই।' });
    }

    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // DB থেকে user আনো
    const { rows } = await pool.query(
      'SELECT id, first_name, last_name, phone, role, district, is_verified FROM users WHERE id = $1',
      [decoded.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'User পাওয়া যায়নি।' });

    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token অবৈধ বা মেয়াদ শেষ।' });
  }
}

// ── শুধু কৃষক ──────────────────────────────────────
function farmerOnly(req, res, next) {
  if (req.user.role !== 'farmer') {
    return res.status(403).json({ error: 'শুধু কৃষকরা এই কাজ করতে পারবে।' });
  }
  next();
}

// ── শুধু ক্রেতা ─────────────────────────────────────
function buyerOnly(req, res, next) {
  if (req.user.role !== 'buyer') {
    return res.status(403).json({ error: 'শুধু ক্রেতারা এই কাজ করতে পারবে।' });
  }
  next();
}

// ── Optional auth (login না থাকলেও চলবে) ─────────────
async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const token   = header.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
      if (rows[0]) req.user = rows[0];
    }
  } catch {}
  next();
}

module.exports = { protect, farmerOnly, buyerOnly, optionalAuth };
