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

const DISTRICT_COORDS = {
  'ঢাকা': [23.8103, 90.4125],
  dhaka: [23.8103, 90.4125],
  'চট্টগ্রাম': [22.3569, 91.7832],
  chittagong: [22.3569, 91.7832],
  'রাজশাহী': [24.3745, 88.6042],
  rajshahi: [24.3745, 88.6042],
  'খুলনা': [22.8456, 89.5403],
  khulna: [22.8456, 89.5403],
  'বরিশাল': [22.7010, 90.3535],
  barishal: [22.7010, 90.3535],
  barisal: [22.7010, 90.3535],
  'সিলেট': [24.8949, 91.8687],
  sylhet: [24.8949, 91.8687],
  'রংপুর': [25.7439, 89.2752],
  rangpur: [25.7439, 89.2752],
  'ময়মনসিংহ': [24.7471, 90.4203],
  mymensingh: [24.7471, 90.4203],
  'কুমিল্লা': [23.4607, 91.1809],
  cumilla: [23.4607, 91.1809],
  comilla: [23.4607, 91.1809],
  'নরসিংদী': [23.9322, 90.7154],
  narsingdi: [23.9322, 90.7154],
  'গাজীপুর': [24.0023, 90.4264],
  gazipur: [24.0023, 90.4264],
  'বগুড়া': [24.8465, 89.3776],
  bogura: [24.8465, 89.3776],
  bogra: [24.8465, 89.3776],
};

function districtCoords(district = '') {
  const key = `${district}`.trim().toLowerCase();
  return DISTRICT_COORDS[key] || null;
}

function coordsForUser(user) {
  const lat = Number(user?.latitude);
  const lng = Number(user?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { latitude: lat, longitude: lng, source: 'gps' };
  }
  const approx = districtCoords(user?.district);
  if (!approx) return null;
  return { latitude: approx[0], longitude: approx[1], source: 'district' };
}

function haversineKm(from, to) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
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
      'SELECT id, district, latitude, longitude FROM users WHERE id = $1',
      [req.user.id]
    );
    const me = meRows[0];
    const myCoords = coordsForUser(me);
    if (!myCoords) {
      return res.status(400).json({ error: 'আগে নিজের লোকেশন সেভ করুন অথবা প্রোফাইলে জেলা দিন।' });
    }

    const { rows } = await pool.query(
      `SELECT
         u.id, u.first_name, u.last_name, u.role, u.district,
         u.avatar, u.is_verified, u.latitude, u.longitude,
         fp.experience_yrs, fp.land_size, fp.village, fp.bio,
         fp.avg_rating, fp.total_orders
       FROM users u
       LEFT JOIN farmer_profiles fp ON fp.user_id = u.id
       WHERE u.id <> $1
         AND u.role = $2`,
      [req.user.id, targetRole]
    );

    const users = rows
      .map((user) => {
        const targetCoords = coordsForUser(user);
        if (!targetCoords) return null;
        const distanceKm = haversineKm(myCoords, targetCoords);
        return {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          district: user.district,
          avatar: user.avatar,
          is_verified: user.is_verified,
          experience_yrs: user.experience_yrs,
          land_size: user.land_size,
          village: user.village,
          bio: user.bio,
          avg_rating: user.avg_rating,
          total_orders: user.total_orders,
          distance_km: Number(distanceKm.toFixed(2)),
          display_lat: Number(targetCoords.latitude.toFixed(2)),
          display_lng: Number(targetCoords.longitude.toFixed(2)),
          location_source: targetCoords.source,
        };
      })
      .filter(Boolean)
      .filter((user) => user.distance_km <= radiusKm)
      .sort((a, b) => a.distance_km - b.distance_km)
      .slice(0, limit);

    res.json({
      center: {
        latitude: myCoords.latitude,
        longitude: myCoords.longitude,
      },
      radius_km: radiusKm,
      target_role: targetRole,
      users,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error।' });
  }
}

module.exports = { register, login, getMe, updateMe, getFarmers, getFarmer, getNearbyUsers };
