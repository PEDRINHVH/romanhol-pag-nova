CREATE TABLE IF NOT EXISTS payment_products (
  product_id TEXT PRIMARY KEY NOT NULL,
  product_hash TEXT,
  offer_hash TEXT,
  state TEXT NOT NULL DEFAULT 'registering',
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS payment_orders (
  id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_hash TEXT UNIQUE,
  data_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  last_checked_at INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS payment_tracking (
  order_id TEXT NOT NULL,
  order_status TEXT NOT NULL,
  provider TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  code TEXT,
  PRIMARY KEY (order_id, order_status, provider)
);
