// src/config/migrate.js — সব Table তৈরি করবে
require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('📦 Migration শুরু হচ্ছে...');

    // ── USERS ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        first_name    VARCHAR(100) NOT NULL,
        last_name     VARCHAR(100) DEFAULT '',
        phone         VARCHAR(15)  NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role          VARCHAR(10)  NOT NULL DEFAULT 'buyer'
                        CHECK (role IN ('farmer','buyer')),
        district      VARCHAR(100) DEFAULT '',
        address       TEXT         DEFAULT '',
        avatar        VARCHAR(255) DEFAULT NULL,
        is_verified   BOOLEAN      DEFAULT FALSE,
        latitude      DECIMAL(9,6) DEFAULT NULL,
        longitude     DECIMAL(9,6) DEFAULT NULL,
        created_at    TIMESTAMP    DEFAULT NOW(),
        updated_at    TIMESTAMP    DEFAULT NOW()
      );
    `);
    console.log('  ✅ users table');

    // ── FARMER PROFILES ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS farmer_profiles (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        experience_yrs INTEGER DEFAULT 0,
        land_size      DECIMAL(6,2) DEFAULT 0,
        village        VARCHAR(200) DEFAULT '',
        bio            TEXT         DEFAULT '',
        avg_rating     DECIMAL(3,2) DEFAULT 0.00,
        total_orders   INTEGER      DEFAULT 0
      );
    `);
    console.log('  ✅ farmer_profiles table');

    // ── CATEGORIES ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id   SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        icon VARCHAR(10)  DEFAULT '🌾'
      );
    `);

    // Some imported databases may already contain `categories` data
    // but be missing the primary/unique constraints needed by FK/ON CONFLICT.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_class
          WHERE relkind = 'S' AND relname = 'categories_id_seq'
        ) THEN
          CREATE SEQUENCE public.categories_id_seq;
        END IF;
      END
      $$;
    `);

    await client.query(`
      ALTER TABLE public.categories
      ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq');
    `);

    await client.query(`
      SELECT setval(
        'public.categories_id_seq',
        GREATEST(COALESCE((SELECT MAX(id) FROM public.categories), 0), 1),
        true
      );
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'categories_pkey'
            AND conrelid = 'public.categories'::regclass
        ) THEN
          ALTER TABLE ONLY public.categories
          ADD CONSTRAINT categories_pkey PRIMARY KEY (id);
        END IF;
      END
      $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'categories_name_key'
            AND conrelid = 'public.categories'::regclass
        ) THEN
          ALTER TABLE ONLY public.categories
          ADD CONSTRAINT categories_name_key UNIQUE (name);
        END IF;
      END
      $$;
    `);
    console.log('  ✅ categories table');

    // ── PRODUCTS ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id            SERIAL PRIMARY KEY,
        farmer_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        name          VARCHAR(200) NOT NULL,
        description   TEXT         DEFAULT '',
        image         VARCHAR(255) DEFAULT NULL,
        price_per_kg  DECIMAL(8,2) NOT NULL CHECK (price_per_kg >= 0),
        quantity_kg   DECIMAL(10,2) NOT NULL CHECK (quantity_kg >= 0),
        min_order_kg  DECIMAL(8,2)  DEFAULT 1,
        harvest_date  DATE          DEFAULT NULL,
        location      VARCHAR(200)  DEFAULT '',
        district      VARCHAR(100)  DEFAULT '',
        is_organic    BOOLEAN       DEFAULT FALSE,
        status        VARCHAR(20)   DEFAULT 'available'
                        CHECK (status IN ('available','sold_out','inactive')),
        created_at    TIMESTAMP     DEFAULT NOW(),
        updated_at    TIMESTAMP     DEFAULT NOW()
      );
    `);
    console.log('  ✅ products table');

    // ── PRODUCT REVIEWS ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_reviews (
        id          SERIAL PRIMARY KEY,
        product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        reviewer_id INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
        rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment     TEXT     DEFAULT '',
        created_at  TIMESTAMP DEFAULT NOW(),
        UNIQUE(product_id, reviewer_id)
      );
    `);
    console.log('  ✅ product_reviews table');

    // ── ORDERS ─────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id               SERIAL PRIMARY KEY,
        buyer_id         INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        product_id       INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity_kg      DECIMAL(10,2) NOT NULL CHECK (quantity_kg > 0),
        price_per_kg     DECIMAL(8,2)  NOT NULL,
        bargained_price  DECIMAL(8,2)  DEFAULT NULL,
        total_price      DECIMAL(12,2) NOT NULL,
        delivery_address TEXT          NOT NULL,
        note             TEXT          DEFAULT '',
        status           VARCHAR(20)   DEFAULT 'pending'
                           CHECK (status IN ('pending','accepted','rejected','delivered')),
        created_at       TIMESTAMP     DEFAULT NOW(),
        updated_at       TIMESTAMP     DEFAULT NOW()
      );
    `);
    console.log('  ✅ orders table');

    // ── CONVERSATIONS ──────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id         SERIAL PRIMARY KEY,
        user1_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user2_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user1_id, user2_id)
      );
    `);
    console.log('  ✅ conversations table');

    // ── MESSAGES ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id              SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text            TEXT    NOT NULL,
        is_read         BOOLEAN DEFAULT FALSE,
        created_at      TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✅ messages table');

    // ── DEFAULT CATEGORIES ─────────────────────────────────────
    await client.query(`
      INSERT INTO categories (name, icon) VALUES
        ('শাকসবজি', '🥦'),
        ('ফল',      '🍎'),
        ('শস্য',    '🌾'),
        ('মসলা',    '🌶️')
      ON CONFLICT (name) DO NOTHING;
    `);
    console.log('  ✅ Default categories inserted');

    console.log('\n🎉 Migration সফল! সব table তৈরি হয়েছে।');
  } catch (err) {
    console.error('❌ Migration ব্যর্থ:', err.message);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrate();
