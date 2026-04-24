// src/controllers/productController.js
const pool = require('../config/db');

// ── সব পণ্য ──────────────────────────────────────────
// GET /api/products
async function getProducts(req, res) {
  const { search, category, district, is_organic, max_price, ordering = 'newest' } = req.query;
  let query = `
    SELECT p.*,
           u.first_name AS farmer_first, u.last_name AS farmer_last,
           u.district   AS farmer_district, u.is_verified AS farmer_verified, u.phone AS farmer_phone,
           c.name AS category_name, c.icon AS category_icon,
           COALESCE(AVG(r.rating),0) AS avg_rating,
           COUNT(r.id) AS review_count
    FROM products p
    JOIN users      u ON u.id = p.farmer_id
    LEFT JOIN categories    c ON c.id = p.category_id
    LEFT JOIN product_reviews r ON r.product_id = p.id
    WHERE p.status = 'available'
  `;
  const vals = [];

  if (search)     { vals.push(`%${search}%`);     query += ` AND (p.name ILIKE $${vals.length} OR u.first_name ILIKE $${vals.length} OR p.district ILIKE $${vals.length})`; }
  if (category)   { vals.push(category);           query += ` AND c.name = $${vals.length}`; }
  if (district)   { vals.push(`%${district}%`);    query += ` AND p.district ILIKE $${vals.length}`; }
  if (is_organic) { query += ` AND p.is_organic = TRUE`; }
  if (max_price)  { vals.push(max_price);           query += ` AND p.price_per_kg <= $${vals.length}`; }

  query += ' GROUP BY p.id, u.id, c.id';
  const orderMap = {
    newest:       'p.created_at DESC',
    price_asc:    'p.price_per_kg ASC',
    price_desc:   'p.price_per_kg DESC',
    harvest_date: 'p.harvest_date DESC',
  };
  query += ` ORDER BY ${orderMap[ordering] || 'p.created_at DESC'}`;

  try {
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── একটি পণ্যের বিস্তারিত ───────────────────────────
// GET /api/products/:id
async function getProduct(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT p.*,
              u.first_name AS farmer_first, u.last_name AS farmer_last,
              u.district   AS farmer_district, u.is_verified AS farmer_verified,
              u.phone AS farmer_phone, u.avatar AS farmer_avatar,
              fp.experience_yrs, fp.land_size, fp.village, fp.bio,
              c.name AS category_name, c.icon AS category_icon,
              COALESCE(AVG(r.rating),0) AS avg_rating
       FROM products p
       JOIN users u             ON u.id = p.farmer_id
       LEFT JOIN farmer_profiles fp ON fp.user_id = u.id
       LEFT JOIN categories c   ON c.id = p.category_id
       LEFT JOIN product_reviews r ON r.product_id = p.id
       WHERE p.id = $1
       GROUP BY p.id, u.id, fp.id, c.id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'পণ্য পাওয়া যায়নি।' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── নতুন পণ্য যোগ করুন (কৃষক) ──────────────────────
// POST /api/products
async function createProduct(req, res) {
  const {
    name, description = '', category_id, price_per_kg,
    quantity_kg, min_order_kg = 1, harvest_date,
    location = '', district = '', is_organic = false,
  } = req.body;

  if (!name || !price_per_kg || !quantity_kg)
    return res.status(400).json({ error: 'নাম, দাম ও পরিমাণ আবশ্যক।' });

  const image = req.file ? req.file.filename : null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO products
         (farmer_id, category_id, name, description, image, price_per_kg,
          quantity_kg, min_order_kg, harvest_date, location, district, is_organic)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [req.user.id, category_id || null, name, description, image,
       price_per_kg, quantity_kg, min_order_kg,
       harvest_date || null, location, district || req.user.district, is_organic]
    );
    res.status(201).json({ message: 'পণ্য প্রকাশিত হয়েছে!', product: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── পণ্য আপডেট (নিজের কৃষক) ────────────────────────
// PATCH /api/products/:id
async function updateProduct(req, res) {
  const { name, description, price_per_kg, quantity_kg, status, is_organic, harvest_date, location } = req.body;
  try {
    // Owner check
    const check = await pool.query('SELECT farmer_id FROM products WHERE id = $1', [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'পণ্য পাওয়া যায়নি।' });
    if (check.rows[0].farmer_id !== req.user.id)
      return res.status(403).json({ error: 'এই পণ্য আপনার নয়।' });

    const image = req.file ? req.file.filename : undefined;
    const { rows } = await pool.query(
      `UPDATE products SET
         name         = COALESCE($1, name),
         description  = COALESCE($2, description),
         price_per_kg = COALESCE($3, price_per_kg),
         quantity_kg  = COALESCE($4, quantity_kg),
         status       = COALESCE($5, status),
         is_organic   = COALESCE($6, is_organic),
         harvest_date = COALESCE($7, harvest_date),
         location     = COALESCE($8, location),
         image        = COALESCE($9, image),
         updated_at   = NOW()
       WHERE id = $10 RETURNING *`,
      [name, description, price_per_kg, quantity_kg, status,
       is_organic, harvest_date, location, image, req.params.id]
    );
    res.json({ message: 'পণ্য আপডেট হয়েছে।', product: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── পণ্য মুছুন ───────────────────────────────────────
// DELETE /api/products/:id
async function deleteProduct(req, res) {
  try {
    const check = await pool.query('SELECT farmer_id FROM products WHERE id = $1', [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'পণ্য পাওয়া যায়নি।' });
    if (check.rows[0].farmer_id !== req.user.id)
      return res.status(403).json({ error: 'এই পণ্য আপনার নয়।' });

    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ message: 'পণ্য মুছে ফেলা হয়েছে।' });
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── নিজের পণ্য (কৃষক) ──────────────────────────────
// GET /api/products/mine
async function myProducts(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, c.name AS category_name, c.icon AS category_icon,
              COALESCE(AVG(r.rating),0) AS avg_rating
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN product_reviews r ON r.product_id = p.id
       WHERE p.farmer_id = $1
       GROUP BY p.id, c.id
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── Categories ────────────────────────────────────────
// GET /api/products/categories
async function getCategories(req, res) {
  try {
    const { rows } = await pool.query('SELECT * FROM categories ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── Review যোগ করুন ─────────────────────────────────
// POST /api/products/:id/review
async function addReview(req, res) {
  const { rating, comment = '' } = req.body;
  if (!rating || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Rating 1-5 এর মধ্যে দিন।' });
  try {
    await pool.query(
      `INSERT INTO product_reviews (product_id, reviewer_id, rating, comment)
       VALUES ($1,$2,$3,$4) ON CONFLICT (product_id, reviewer_id)
       DO UPDATE SET rating = $3, comment = $4`,
      [req.params.id, req.user.id, rating, comment]
    );
    // avg rating update
    await pool.query(
      `UPDATE farmer_profiles fp
       SET avg_rating = (
         SELECT COALESCE(AVG(r.rating),0)
         FROM product_reviews r
         JOIN products p ON p.id = r.product_id
         WHERE p.farmer_id = (SELECT farmer_id FROM products WHERE id = $1)
       ) WHERE fp.user_id = (SELECT farmer_id FROM products WHERE id = $1)`,
      [req.params.id]
    );
    res.json({ message: 'রিভিউ যোগ হয়েছে!' });
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── পণ্যের Reviews ──────────────────────────────────
// GET /api/products/:id/reviews
async function getReviews(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, u.first_name, u.last_name
       FROM product_reviews r
       JOIN users u ON u.id = r.reviewer_id
       WHERE r.product_id = $1
       ORDER BY r.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

module.exports = {
  getProducts, getProduct, createProduct, updateProduct,
  deleteProduct, myProducts, getCategories, addReview, getReviews,
};
