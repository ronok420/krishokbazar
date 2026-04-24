// src/controllers/chatController.js
const pool = require('../config/db');

// ── সব Conversation ──────────────────────────────────
// GET /api/chat
async function getConversations(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.updated_at,
              CASE WHEN c.user1_id = $1 THEN c.user2_id ELSE c.user1_id END AS other_id,
              (SELECT text FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_text,
              (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_time,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.is_read = FALSE AND m.sender_id != $1) AS unread
       FROM conversations c
       WHERE c.user1_id = $1 OR c.user2_id = $1
       ORDER BY c.updated_at DESC`,
      [req.user.id]
    );

    // other user info নিন
    const result = await Promise.all(rows.map(async row => {
      const user = await pool.query(
        'SELECT id, first_name, last_name, role, district, avatar, is_verified FROM users WHERE id = $1',
        [row.other_id]
      );
      return { ...row, other_user: user.rows[0] };
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── নতুন Conversation শুরু করুন ─────────────────────
// POST /api/chat/start
async function startConversation(req, res) {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id দিন।' });
  if (parseInt(user_id) === req.user.id)
    return res.status(400).json({ error: 'নিজের সাথে chat করা যাবে না।' });

  try {
    // Other user exists?
    const other = await pool.query('SELECT id, first_name, last_name, role FROM users WHERE id = $1', [user_id]);
    if (!other.rows[0]) return res.status(404).json({ error: 'ব্যবহারকারী পাওয়া যায়নি।' });

    // Already exists?
    const [u1, u2] = [Math.min(req.user.id, user_id), Math.max(req.user.id, user_id)];
    const existing = await pool.query(
      'SELECT id FROM conversations WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)',
      [req.user.id, user_id]
    );
    if (existing.rows[0]) return res.json({ conversation_id: existing.rows[0].id, existing: true });

    const { rows } = await pool.query(
      'INSERT INTO conversations (user1_id, user2_id) VALUES ($1,$2) RETURNING id',
      [u1, u2]
    );
    res.status(201).json({ conversation_id: rows[0].id, other_user: other.rows[0], existing: false });
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── Conversation এর বার্তাগুলো ──────────────────────
// GET /api/chat/:id/messages
async function getMessages(req, res) {
  try {
    // Access check
    const conv = await pool.query(
      'SELECT id FROM conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [req.params.id, req.user.id]
    );
    if (!conv.rows[0]) return res.status(403).json({ error: 'এই chat দেখার অনুমতি নেই।' });

    // Mark as read
    await pool.query(
      'UPDATE messages SET is_read = TRUE WHERE conversation_id = $1 AND sender_id != $2',
      [req.params.id, req.user.id]
    );

    const { rows } = await pool.query(
      `SELECT m.*, u.first_name, u.last_name, u.role
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

// ── বার্তা পাঠান ─────────────────────────────────────
// POST /api/chat/:id/messages
async function sendMessage(req, res) {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'বার্তা লিখুন।' });

  try {
    // Access check
    const conv = await pool.query(
      'SELECT id FROM conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [req.params.id, req.user.id]
    );
    if (!conv.rows[0]) return res.status(403).json({ error: 'অনুমতি নেই।' });

    const { rows } = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, text)
       VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, req.user.id, text.trim()]
    );

    // Conversation timestamp update
    await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [req.params.id]);

    res.status(201).json({ ...rows[0], first_name: req.user.first_name, last_name: req.user.last_name });
  } catch (err) {
    res.status(500).json({ error: 'Server error।' });
  }
}

module.exports = { getConversations, startConversation, getMessages, sendMessage };
