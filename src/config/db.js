// src/config/db.js — PostgreSQL Connection
const { Pool } = require('pg');
require('dotenv').config();

const hasConnectionString = !!process.env.DATABASE_URL;
const poolConfig = hasConnectionString
  ? {
      connectionString: process.env.DATABASE_URL,
      // Hosted PostgreSQL (Neon/Render) requires SSL
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000, // 15 seconds for Neon cold start
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'krishokbazar_test',
      user: process.env.DB_USER || 'testuser',
      password: process.env.DB_PASSWORD || 'testpass123',
      // Local production fallback
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool(poolConfig);

// Connection test
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database সংযোগ ব্যর্থ:', err?.message || err?.code || 'Unknown error');
    if (err) {
      console.error('❌ DB বিস্তারিত:', {
        code: err.code,
        name: err.name,
        severity: err.severity,
        detail: err.detail,
        hint: err.hint,
      });
    }
  } else {
    console.log('✅ PostgreSQL সংযুক্ত!');
    release();
  }
});

module.exports = pool;
