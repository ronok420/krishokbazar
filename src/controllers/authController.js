// src/controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const pool   = require('../config/db');

// ── Token তৈরি করো ─────────────────────────────────
function makeToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ── নিবন্ধন ─────────────────────────────────────────
// POST /api/auth/register
async function register(req, res) {
  const { first_name, last_name = '', phone, password, role = 'buyer', district = '' } = req.body;

  if (!first_name || !phone || !password)
    return res.status(400).json({ error: 'নাম, ফোন ও পাসওয়ার্ড আবশ্যক।' });

  if (password.length < 6)
    return res.status(400).json({ error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষর হতে হবে।' });

  try {
    // Phone already exists?
    const existing = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existing.rows[0])
      return res.status(400).json({ error: 'এই ফোন নম্বর ইতিমধ্যে নিবন্ধিত।' });

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (first_name, last_name, phone, password_hash, role, district)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, first_name, last_name, phone, role, district, is_verified`,
      [first_name, last_name, phone, hash, role, district]
    );
    const user = rows[0];

    // কৃষক হলে farmer_profile তৈরি করো
    if (role === 'farmer') {
      await pool.query('INSERT INTO farmer_profiles (user_id) VALUES ($1)', [user.id]);
    }

    res.status(201).json({
      message: 'অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে!',
      token:   makeToken(user),
      user,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── লগইন ────────────────────────────────────────────
// POST /api/auth/login
async function login(req, res) {
  const { phone, password } = req.body;
  if (!phone || !password)
    return res.status(400).json({ error: 'ফোন ও পাসওয়ার্ড দিন।' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE phone = $1',
      [phone]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'ফোন নম্বর বা পাসওয়ার্ড ভুল।' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)  return res.status(401).json({ error: 'ফোন নম্বর বা পাসওয়ার্ড ভুল।' });

    const { password_hash, ...safeUser } = user;
    res.json({
      message: 'সফলভাবে লগইন হয়েছে!',
      token:   makeToken(user),
      user:    safeUser,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── নিজের প্রোফাইল দেখুন ────────────────────────────
// GET /api/auth/me
async function getMe(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.phone, u.role,
              u.district, u.address, u.avatar, u.is_verified,
              u.latitude, u.longitude, u.created_at,
              fp.experience_yrs, fp.land_size, fp.village, fp.bio, fp.avg_rating, fp.total_orders
       FROM users u
       LEFT JOIN farmer_profiles fp ON fp.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── প্রোফাইল আপডেট ──────────────────────────────────
// PATCH /api/auth/me
async function updateMe(req, res) {
  const { first_name, last_name, district, address, latitude, longitude } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE users SET
         first_name = COALESCE($1, first_name),
         last_name  = COALESCE($2, last_name),
         district   = COALESCE($3, district),
         address    = COALESCE($4, address),
         latitude   = COALESCE($5, latitude),
         longitude  = COALESCE($6, longitude),
         updated_at = NOW()
       WHERE id = $7
       RETURNING id, first_name, last_name, phone, role, district, is_verified`,
      [first_name, last_name, district, address, latitude, longitude, req.user.id]
    );
    res.json({ message: 'প্রোফাইল আপডেট হয়েছে।', user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── কৃষকদের তালিকা ──────────────────────────────────
// GET /api/auth/farmers
async function getFarmers(req, res) {
  const { district, verified } = req.query;
  let query  = `SELECT u.id, u.first_name, u.last_name, u.phone, u.district,
                       u.avatar, u.is_verified, u.latitude, u.longitude,
                       fp.experience_yrs, fp.land_size, fp.village, fp.avg_rating, fp.total_orders
                FROM users u
                LEFT JOIN farmer_profiles fp ON fp.user_id = u.id
                WHERE u.role = 'farmer'`;
  const vals = [];
  if (district) { vals.push(`%${district}%`); query += ` AND u.district ILIKE $${vals.length}`; }
  if (verified) { query += ` AND u.is_verified = TRUE`; }
  query += ' ORDER BY fp.avg_rating DESC NULLS LAST';

  try {
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── একজন কৃষকের বিস্তারিত ───────────────────────────
// GET /api/auth/farmers/:id
async function getFarmer(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.phone, u.district,
              u.avatar, u.is_verified, u.latitude, u.longitude,
              fp.experience_yrs, fp.land_size, fp.village, fp.bio, fp.avg_rating, fp.total_orders
       FROM users u
       LEFT JOIN farmer_profiles fp ON fp.user_id = u.id
       WHERE u.id = $1 AND u.role = 'farmer'`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'কৃষক পাওয়া যায়নি।' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

module.exports = { register, login, getMe, updateMe, getFarmers, getFarmer };
