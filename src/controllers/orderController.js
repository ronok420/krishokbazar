// src/controllers/orderController.js
const pool = require('../config/db');
const { getIO, userRoom } = require('../socket');

// ── নতুন অর্ডার দিন ─────────────────────────────────
// POST /api/orders
async function placeOrder(req, res) {
  const { product_id, quantity_kg, delivery_address, note = '' } = req.body;
  if (!product_id || !quantity_kg || !delivery_address)
    return res.status(400).json({ error: 'পণ্য, পরিমাণ ও ঠিকানা আবশ্যক।' });

  try {
    const qty = parseFloat(quantity_kg);
    if (!qty || qty <= 0)
      return res.status(400).json({ error: 'সঠিক পরিমাণ দিন।' });

    // পণ্যের বর্তমান দাম নিন
    const prod = await pool.query(
      'SELECT id, farmer_id, price_per_kg, quantity_kg, min_order_kg, status FROM products WHERE id = $1',
      [product_id]
    );
    if (!prod.rows[0]) return res.status(404).json({ error: 'পণ্য পাওয়া যায়নি।' });
    if (prod.rows[0].farmer_id === req.user.id)
      return res.status(400).json({ error: 'নিজের পণ্যে অর্ডার করা যাবে না।' });
    if (prod.rows[0].status !== 'available')
      return res.status(400).json({ error: 'পণ্যটি এখন পাওয়া যাচ্ছে না।' });
    if (qty > parseFloat(prod.rows[0].quantity_kg))
      return res.status(400).json({ error: 'স্টকে পর্যাপ্ত পরিমাণ নেই।' });
    if (prod.rows[0].min_order_kg && qty < parseFloat(prod.rows[0].min_order_kg))
      return res.status(400).json({ error: `ন্যূনতম অর্ডার ${prod.rows[0].min_order_kg} কেজি।` });

    const price_per_kg = parseFloat(prod.rows[0].price_per_kg);
    const total_price  = price_per_kg * qty;

    const { rows } = await pool.query(
      `INSERT INTO orders (buyer_id, product_id, quantity_kg, price_per_kg, total_price, delivery_address, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, product_id, qty, price_per_kg, total_price, delivery_address, note]
    );

    const io = getIO();
    if (io) {
      io.to(userRoom(prod.rows[0].farmer_id)).emit('order:created', {
        order_id: rows[0].id,
        product_id: rows[0].product_id,
      });
      io.to(userRoom(req.user.id)).emit('order:created', {
        order_id: rows[0].id,
        product_id: rows[0].product_id,
      });
    }

    res.status(201).json({ message: 'অর্ডার দেওয়া হয়েছে!', order: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── আমার অর্ডার (ক্রেতা) ────────────────────────────
// GET /api/orders
async function myOrders(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT o.*,
              p.name AS product_name, p.image AS product_image,
              c.name AS category_name, c.icon AS category_icon,
              u.first_name AS farmer_first, u.last_name AS farmer_last, u.phone AS farmer_phone
       FROM orders o
       JOIN products p ON p.id = o.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       JOIN users    u ON u.id = p.farmer_id
       WHERE o.buyer_id = $1
       ORDER BY o.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── Incoming অর্ডার (কৃষক) ──────────────────────────
// GET /api/orders/incoming
async function incomingOrders(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT o.*,
              p.name AS product_name,
              b.first_name AS buyer_first, b.last_name AS buyer_last, b.phone AS buyer_phone
       FROM orders o
       JOIN products p ON p.id = o.product_id
       JOIN users    b ON b.id = o.buyer_id
       WHERE p.farmer_id = $1
       ORDER BY o.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── একটি অর্ডারের বিস্তারিত ─────────────────────────
// GET /api/orders/:id
async function getOrder(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT o.*,
              p.name AS product_name, p.image AS product_image,
              u.first_name AS farmer_first, u.last_name AS farmer_last, u.phone AS farmer_phone,
              b.first_name AS buyer_first,  b.last_name AS buyer_last,  b.phone AS buyer_phone
       FROM orders o
       JOIN products p ON p.id = o.product_id
       JOIN users    u ON u.id = p.farmer_id
       JOIN users    b ON b.id = o.buyer_id
       WHERE o.id = $1 AND (o.buyer_id = $2 OR p.farmer_id = $2)`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'অর্ডার পাওয়া যায়নি।' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── অর্ডার Status আপডেট (কৃষক) ─────────────────────
// PATCH /api/orders/:id/status
async function updateStatus(req, res) {
  const { status } = req.body;
  const allowed = ['accepted', 'rejected', 'delivered'];
  if (!allowed.includes(status))
    return res.status(400).json({ error: `status হতে হবে: ${allowed.join(', ')}` });

  try {
    // কৃষকের পণ্যের অর্ডার কিনা check করো
    const check = await pool.query(
      `SELECT o.id, o.status AS current_status, o.buyer_id, o.product_id, o.quantity_kg
       FROM orders o
       JOIN products p ON p.id = o.product_id
       WHERE o.id = $1 AND p.farmer_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!check.rows[0]) return res.status(404).json({ error: 'অর্ডার পাওয়া যায়নি।' });
    const currentStatus = check.rows[0].current_status;

    if ((status === 'accepted' || status === 'rejected') && currentStatus !== 'pending') {
      return res.status(400).json({ error: 'শুধু pending অর্ডার গ্রহণ/বাতিল করা যাবে।' });
    }
    if (status === 'delivered' && currentStatus !== 'accepted') {
      return res.status(400).json({ error: 'শুধু accepted অর্ডার delivered করা যাবে।' });
    }

    const { rows } = await pool.query(
      `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );

    // farmer total_orders আপডেট করো
    if (status === 'delivered') {
      await pool.query(
        `UPDATE products
         SET quantity_kg = GREATEST(quantity_kg - $1, 0),
             status = CASE WHEN quantity_kg - $1 <= 0 THEN 'sold_out' ELSE status END,
             updated_at = NOW()
         WHERE id = $2`,
        [check.rows[0].quantity_kg, check.rows[0].product_id]
      );

      await pool.query(
        `UPDATE farmer_profiles SET total_orders = total_orders + 1
         WHERE user_id = $1`,
        [req.user.id]
      );
    }

    const io = getIO();
    if (io) {
      io.to(userRoom(check.rows[0].buyer_id)).emit('order:updated', {
        order_id: rows[0].id,
        status: rows[0].status,
      });
      io.to(userRoom(req.user.id)).emit('order:updated', {
        order_id: rows[0].id,
        status: rows[0].status,
      });
    }

    res.json({ message: 'অর্ডার আপডেট হয়েছে।', order: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── দরদামের প্রস্তাব (ক্রেতা) ──────────────────────
// POST /api/orders/:id/bargain
async function bargain(req, res) {
  const { proposed_price } = req.body;
  if (!proposed_price || proposed_price <= 0)
    return res.status(400).json({ error: 'সঠিক দাম দিন।' });

  try {
    const check = await pool.query(
      'SELECT id FROM orders WHERE id = $1 AND buyer_id = $2',
      [req.params.id, req.user.id]
    );
    if (!check.rows[0]) return res.status(404).json({ error: 'অর্ডার পাওয়া যায়নি।' });

    const { rows } = await pool.query(
      `UPDATE orders SET
         bargained_price = $1,
         total_price = quantity_kg * $1,
         updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [proposed_price, req.params.id]
    );
    res.json({ message: `দরদামের প্রস্তাব পাঠানো হয়েছে: ৳${proposed_price}/কেজি`, order: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

module.exports = { placeOrder, myOrders, incomingOrders, getOrder, updateStatus, bargain };
