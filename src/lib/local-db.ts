import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseSync } from "node:sqlite";

const globalDb = globalThis as unknown as { vanoLocalDb?: DatabaseSync };

function ensureColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  type: string
) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (!cols.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function vanoDataDir() {
  const fromEnv = process.env.VANO_DATA_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  const base =
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(base, "VANO POS");
}

export function localDbPath() {
  return path.join(vanoDataDir(), "data", "pos.sqlite");
}

export function localDb() {
  if (globalDb.vanoLocalDb) return globalDb.vanoLocalDb;
  const dir = path.dirname(localDbPath());
  let db: DatabaseSync;
  try {
    fs.mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(localDbPath());
  } catch {
    db = new DatabaseSync(":memory:");
  }
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS catalog_products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT,
      barcode TEXT,
      unit TEXT NOT NULL,
      price REAL NOT NULL,
      wholesale_price REAL NOT NULL,
      wholesale_min_qty INTEGER NOT NULL,
      wholesale_max_qty INTEGER NOT NULL,
      stock INTEGER NOT NULL,
      track_qty INTEGER NOT NULL,
      active INTEGER NOT NULL,
      show_in_pos INTEGER NOT NULL,
      cost REAL NOT NULL,
      customs_duty REAL NOT NULL,
      container_id TEXT,
      lots_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings_cache (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS known_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_sales (
      id TEXT PRIMARY KEY,
      receipt_number TEXT NOT NULL UNIQUE,
      cashier_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      sync_error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      stock_conflict INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      synced_at TEXT
    );
    CREATE INDEX IF NOT EXISTS local_sales_status ON local_sales(sync_status);
    CREATE TABLE IF NOT EXISTS pending_ops (
      key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      key TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_outbox (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  ensureColumn(db, "catalog_products", "category_name", "TEXT");
  ensureColumn(db, "catalog_products", "low_stock_at", "INTEGER NOT NULL DEFAULT 5");
  ensureColumn(db, "catalog_products", "created_by_id", "TEXT");
  ensureColumn(db, "catalog_products", "category_id", "TEXT");
  ensureColumn(db, "catalog_products", "description", "TEXT");
  ensureColumn(db, "catalog_products", "max_stock", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "catalog_products", "online_price", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "catalog_products", "retail_price", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "catalog_products", "max_discount_percent", "REAL");
  globalDb.vanoLocalDb = db;
  if (!getMeta("register_id")) {
    setMeta("register_id", crypto.randomUUID());
  }
  return db;
}

export function getMeta(key: string) {
  const row = localDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string) {
  localDb()
    .prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value);
}

export function writeSnapshot(key: string, value: unknown) {
  try {
    localDb()
      .prepare(
        "INSERT INTO snapshots (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json"
      )
      .run(key, JSON.stringify(value));
  } catch (error) {
    console.error(error);
  }
}

export function readSnapshot<T>(key: string): T | null {
  const row = localDb()
    .prepare("SELECT json FROM snapshots WHERE key = ?")
    .get(key) as { json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.json) as T;
}

export function registerId() {
  return getMeta("register_id") || "register";
}

export function backupLocalDb() {
  const db = localDb();
  const dir = path.join(vanoDataDir(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dir, `pos-${stamp}.sqlite`);
  const sqlPath = dest.replace(/\\/g, "/").replace(/'/g, "''");
  db.exec(`VACUUM INTO '${sqlPath}'`);
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith("pos-") && name.endsWith(".sqlite"))
    .sort();
  while (files.length > 14) {
    const oldest = files.shift();
    if (oldest) fs.rmSync(path.join(dir, oldest), { force: true });
  }
  setMeta("last_backup", new Date().toISOString());
  return dest;
}

export function maybeBackupLocalDb() {
  const last = getMeta("last_backup");
  const age = last ? Date.now() - new Date(last).getTime() : Number.POSITIVE_INFINITY;
  if (age < 12 * 60 * 60 * 1000) return null;
  return backupLocalDb();
}
