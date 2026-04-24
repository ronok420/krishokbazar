// src/config/db.js — PostgreSQL Connection
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'krishokbazar_test',
  user:     process.env.DB_USER     || 'testuser',
  password: process.env.DB_PASSWORD || 'testpass123',
  // Production এ SSL
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Connection test
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database সংযোগ ব্যর্থ:', err.message);
  } else {
    console.log('✅ PostgreSQL সংযুক্ত!');
    release();
  }
});

module.exports = pool;
