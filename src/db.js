const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL is not set. Database-backed routes will fail until it is configured.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

async function initDb() {
  if (!process.env.DATABASE_URL) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_reps (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      pin_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS retailers (
      id BIGSERIAL PRIMARY KEY,
      sales_rep_id BIGINT REFERENCES sales_reps(id) ON DELETE SET NULL,
      shop_name TEXT NOT NULL,
      owner_name TEXT,
      phone TEXT,
      area TEXT,
      address TEXT,
      location_url TEXT,
      payment_terms_days INTEGER NOT NULL DEFAULT 7 CHECK (payment_terms_days >= 0),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_retailers_rep ON retailers(sales_rep_id);
    CREATE INDEX IF NOT EXISTS idx_retailers_created ON retailers(created_at DESC);

    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      sku TEXT UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      unit TEXT NOT NULL DEFAULT 'pc',
      base_price NUMERIC(12,2) NOT NULL CHECK (base_price >= 0),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS price_slabs (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      min_qty NUMERIC(12,2) NOT NULL CHECK (min_qty > 0),
      price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
      UNIQUE(product_id, min_qty)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      order_no TEXT UNIQUE,
      retailer_id BIGINT NOT NULL REFERENCES retailers(id),
      sales_rep_id BIGINT NOT NULL REFERENCES sales_reps(id),
      delivery_date DATE,
      notes TEXT,
      total NUMERIC(14,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'NEW',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_orders_rep_created ON orders(sales_rep_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_retailer_created ON orders(retailer_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS order_items (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
      product_name_snapshot TEXT NOT NULL,
      unit_snapshot TEXT NOT NULL,
      quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
      unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
      line_total NUMERIC(14,2) NOT NULL CHECK (line_total >= 0)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      retailer_id BIGINT NOT NULL REFERENCES retailers(id),
      sales_rep_id BIGINT REFERENCES sales_reps(id) ON DELETE SET NULL,
      order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
      amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
      payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
      method TEXT NOT NULL DEFAULT 'Cash',
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_payments_retailer_date ON payments(retailer_id, payment_date DESC);
    CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
  `);
}

module.exports = { pool, initDb };
