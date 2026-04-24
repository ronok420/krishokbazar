// src/server.js — কৃষকবাজার Express Server
require('dotenv').config();
const express  = require('express');
const http     = require('http');
const cors     = require('cors');
const morgan   = require('morgan');
const path     = require('path');
let initSocket = () => {};
try {
  ({ initSocket } = require('./socket'));
} catch (err) {
  console.warn('⚠️ Socket.IO disabled. Run: npm install socket.io');
}

const app = express();

// ── MIDDLEWARE ────────────────────────────────────────
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: true, // Allow all origins (reflects request origin to support credentials)
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ── STATIC — uploaded images ──────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', process.env.UPLOAD_PATH || 'uploads')));

// ── ROUTES ────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders',   require('./routes/orders'));
app.use('/api/chat',     require('./routes/chat'));

// ── HEALTH CHECK ──────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:  'ok',
    message: '🌾 কৃষকবাজার API চলছে!',
    time:    new Date().toISOString(),
  });
});

// ── 404 HANDLER ───────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route পাওয়া যায়নি: ${req.method} ${req.path}` });
});

// ── ERROR HANDLER ─────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Server error।' });
});

// ── START ─────────────────────────────────────────────
const PORT = process.env.PORT || 8000;
const server = http.createServer(app);
initSocket(server, allowedOrigins);

server.listen(PORT, () => {
  console.log('');
  console.log('🌾 ================================');
  console.log('   কৃষকবাজার Backend চলছে!');
  console.log(`   http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/health`);
  console.log(`   Socket: ws://localhost:${PORT}`);
  console.log('🌾 ================================');
  console.log('');
});
