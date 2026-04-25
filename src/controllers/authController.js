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

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

function parseCoordinate(value, min, max) {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return num;
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
  const nextLatitude = parseCoordinate(latitude, -90, 90);
  const nextLongitude = parseCoordinate(longitude, -180, 180);

  if (nextLatitude === null || nextLongitude === null) {
    return res.status(400).json({ error: 'লোকেশন সঠিক নয়।' });
  }

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
       RETURNING id, first_name, last_name, phone, role, district, latitude, longitude, is_verified`,
      [first_name, last_name, district, address, nextLatitude ?? null, nextLongitude ?? null, req.user.id]
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

// ── কাছের ব্যবহারকারী ─────────────────────────────────
// GET /api/auth/nearby?target_role=farmer&radius_km=50
async function getNearbyUsers(req, res) {
  const targetRole = ['farmer', 'buyer'].includes(req.query.target_role)
    ? req.query.target_role
    : (req.user.role === 'buyer' ? 'farmer' : 'buyer');
  const radiusKm = clampNumber(req.query.radius_km, 1, 200, 50);
  const limit = Math.round(clampNumber(req.query.limit, 1, 50, 20));

  try {
    const { rows: meRows } = await pool.query(
      'SELECT id, latitude, longitude FROM users WHERE id = $1',
      [req.user.id]
    );
    const me = meRows[0];
    if (!me?.latitude || !me?.longitude) {
      return res.status(400).json({ error: 'আগে নিজের লোকেশন সেভ করুন।' });
    }

    const { rows } = await pool.query(
      `WITH nearby AS (
         SELECT
           u.id, u.first_name, u.last_name, u.role, u.district,
           u.avatar, u.is_verified, u.latitude, u.longitude,
           fp.experience_yrs, fp.land_size, fp.village, fp.bio,
           fp.avg_rating, fp.total_orders,
           (
             6371 * acos(
               LEAST(1, GREATEST(-1,
                 cos(radians($1)) * cos(radians(u.latitude::double precision)) *
                 cos(radians(u.longitude::double precision) - radians($2)) +
                 sin(radians($1)) * sin(radians(u.latitude::double precision))
               ))
             )
           ) AS distance_km
         FROM users u
         LEFT JOIN farmer_profiles fp ON fp.user_id = u.id
         WHERE u.id <> $3
           AND u.role = $4
           AND u.latitude IS NOT NULL
           AND u.longitude IS NOT NULL
       )
       SELECT
         id, first_name, last_name, role, district, avatar, is_verified,
         experience_yrs, land_size, village, bio, avg_rating, total_orders,
         ROUND(distance_km::numeric, 2) AS distance_km,
         ROUND(latitude::numeric, 2) AS display_lat,
         ROUND(longitude::numeric, 2) AS display_lng
       FROM nearby
       WHERE distance_km <= $5
       ORDER BY distance_km ASC
       LIMIT $6`,
      [Number(me.latitude), Number(me.longitude), req.user.id, targetRole, radiusKm, limit]
    );

    res.json({
      center: {
        latitude: Number(me.latitude),
        longitude: Number(me.longitude),
      },
      radius_km: radiusKm,
      target_role: targetRole,
      users: rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error।' });
  }
}

module.exports = { register, login, getMe, updateMe, getFarmers, getFarmer, getNearbyUsers };
