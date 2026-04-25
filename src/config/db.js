// src/config/db.js — PostgreSQL Connection
const { Pool } = require('pg');
require('dotenv').config();

function buildPoolConfig() {
  if (!process.env.DATABASE_URL) {
    return {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'krishokbazar_test',
      user: process.env.DB_USER || 'testuser',
      password: process.env.DB_PASSWORD || 'testpass123',
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    };
  }

  if (process.env.DATABASE_HOSTADDR) {
    const databaseUrl = new URL(process.env.DATABASE_URL);

    return {
      host: process.env.DATABASE_HOSTADDR,
      port: Number(databaseUrl.port || 5432),
      database: databaseUrl.pathname.slice(1),
      user: decodeURIComponent(databaseUrl.username),
      password: decodeURIComponent(databaseUrl.password),
      options: databaseUrl.searchParams.get('options') || undefined,
      ssl: {
        rejectUnauthorized: false,
        servername: databaseUrl.hostname,
      },
      connectionTimeoutMillis: 30000,
    };
  }

  return {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  };
}

const pool = new Pool(buildPoolConfig());

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database সংযোগ ব্যর্থ — full error:');
    console.error(err);
  } else {
    console.log('✅ PostgreSQL সংযুক্ত!');
    release();
  }
});

module.exports = pool;
