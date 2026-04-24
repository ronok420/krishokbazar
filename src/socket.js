const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const pool = require('./config/db');

let ioInstance = null;

function userRoom(userId) {
  return `user:${userId}`;
}

function conversationRoom(conversationId) {
  return `conv:${conversationId}`;
}

async function getUserFromToken(token) {
  if (!token) return null;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const { rows } = await pool.query(
    'SELECT id, first_name, last_name, phone, role, district, is_verified FROM users WHERE id = $1',
    [decoded.id]
  );
  return rows[0] || null;
}

async function getConversation(conversationId) {
  const { rows } = await pool.query(
    'SELECT id, user1_id, user2_id FROM conversations WHERE id = $1',
    [conversationId]
  );
  return rows[0] || null;
}

async function canAccessConversation(conversationId, userId) {
  const conv = await getConversation(conversationId);
  if (!conv) return null;
  if (conv.user1_id !== userId && conv.user2_id !== userId) return null;
  return conv;
}

function initSocket(server, allowedOrigins = []) {
  if (ioInstance) return ioInstance;

  ioInstance = new Server(server, {
    cors: {
      origin: true, // Allow all origins
      credentials: true,
    },
  });

  ioInstance.use(async (socket, next) => {
    try {
      const authHeader = socket.handshake.headers?.authorization;
      const bearerToken = authHeader?.startsWith('Bearer ')
        ? authHeader.split(' ')[1]
        : null;
      const token = socket.handshake.auth?.token || bearerToken;
      const user = await getUserFromToken(token);
      if (!user) return next(new Error('Unauthorized'));
      socket.user = user;
      return next();
    } catch (err) {
      return next(new Error('Unauthorized'));
    }
  });

  ioInstance.on('connection', (socket) => {
    socket.join(userRoom(socket.user.id));

    socket.on('chat:join_conversation', async (payload = {}, ack = () => {}) => {
      try {
        const conversationId = Number(payload.conversation_id);
        if (!conversationId) return ack({ ok: false, error: 'conversation_id required' });
        const conv = await canAccessConversation(conversationId, socket.user.id);
        if (!conv) return ack({ ok: false, error: 'Access denied' });

        if (socket.data.activeConversationId) {
          socket.leave(conversationRoom(socket.data.activeConversationId));
        }

        socket.join(conversationRoom(conversationId));
        socket.data.activeConversationId = conversationId;
        return ack({ ok: true, conversation_id: conversationId });
      } catch (err) {
        return ack({ ok: false, error: 'Join failed' });
      }
    });

    socket.on('chat:leave_conversation', (payload = {}, ack = () => {}) => {
      const conversationId = Number(payload.conversation_id || socket.data.activeConversationId);
      if (conversationId) socket.leave(conversationRoom(conversationId));
      if (socket.data.activeConversationId === conversationId) {
        socket.data.activeConversationId = null;
      }
      return ack({ ok: true });
    });

    socket.on('chat:send_message', async (payload = {}, ack = () => {}) => {
      try {
        const conversationId = Number(payload.conversation_id);
        const text = `${payload.text || ''}`.trim();
        if (!conversationId) return ack({ ok: false, error: 'conversation_id required' });
        if (!text) return ack({ ok: false, error: 'Message is empty' });

        const conv = await canAccessConversation(conversationId, socket.user.id);
        if (!conv) return ack({ ok: false, error: 'Access denied' });

        const { rows } = await pool.query(
          `INSERT INTO messages (conversation_id, sender_id, text)
           VALUES ($1,$2,$3)
           RETURNING id, conversation_id, sender_id, text, is_read, created_at`,
          [conversationId, socket.user.id, text]
        );

        await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);

        const message = {
          ...rows[0],
          first_name: socket.user.first_name,
          last_name: socket.user.last_name,
        };

        ioInstance.to(conversationRoom(conversationId)).emit('chat:new_message', message);
        ioInstance.to(userRoom(conv.user1_id)).emit('chat:conversation_updated', {
          conversation_id: conversationId,
          last_text: text,
          last_time: message.created_at,
        });
        ioInstance.to(userRoom(conv.user2_id)).emit('chat:conversation_updated', {
          conversation_id: conversationId,
          last_text: text,
          last_time: message.created_at,
        });

        return ack({ ok: true, message });
      } catch (err) {
        return ack({ ok: false, error: 'Message send failed' });
      }
    });
  });

  return ioInstance;
}

function getIO() {
  return ioInstance;
}

module.exports = { initSocket, getIO, userRoom, conversationRoom };
