import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { config } from './config.js';

// Use Node's built-in SQLite (compiled into the node binary) instead of the
// native better-sqlite3 addon — the addon segfaulted (exit 139) on some hosts
// at `new Database()`, while the built-in engine runs anywhere node runs.
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// better-sqlite3-compatible transaction helper: db.transaction(fn)(...args)
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN');
  try {
    const result = fn(...args);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS trusted_devices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL,
  label      TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS airports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  url             TEXT,
  account         TEXT,
  password        TEXT,
  sub_url         TEXT,
  panel_type      TEXT DEFAULT 'sspanel',   -- sspanel | v2board | xboard | manual
  request_headers TEXT DEFAULT '{}',        -- JSON object
  user_agent      TEXT,                     -- subscription pull User-Agent
  cookie          TEXT,                     -- optional cookie for anti-bot protected panels
  auth_token      TEXT,                     -- optional Authorization token to skip login on reset
  proxy           TEXT,                     -- optional http/socks proxy for fetching
  group_name      TEXT,
  remark          TEXT,
  node_filter     TEXT DEFAULT '{}',        -- JSON: {include, exclude, protocols, prefix, rename}
  expire_at       INTEGER,                  -- account expiry (ms epoch)
  used_traffic    INTEGER,                  -- bytes
  total_traffic   INTEGER,                  -- bytes
  last_fetch_at   INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  airport_id  INTEGER,
  name        TEXT,
  type        TEXT,        -- vmess | vless | trojan | ss | hysteria2 | tuic ...
  server      TEXT,
  port        INTEGER,
  raw         TEXT,        -- JSON of parsed params
  uri         TEXT,        -- original share uri if any
  group_name  TEXT,
  latency     INTEGER,     -- ms, -1 = timeout/unknown
  latency_at  INTEGER,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (airport_id) REFERENCES airports(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  token        TEXT NOT NULL UNIQUE,   -- subscription token
  enabled      INTEGER DEFAULT 1,
  expire_at    INTEGER,                -- ms epoch, null = never
  template_id  INTEGER,
  group_name   TEXT,
  remark       TEXT,
  node_filter  TEXT DEFAULT '{}',      -- which airports/nodes this user gets
  reset_at     INTEGER,                -- last subscription reset (invalidates old token)
  traffic_base    INTEGER,             -- baseline airport used-traffic (A) at first measure, bytes
  traffic_used    INTEGER,             -- measured usage since baseline (B - A), bytes
  traffic_limit   INTEGER,             -- per-user cap in bytes (null/0 = unlimited)
  traffic_updated_at INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,            -- 'airport' | 'user'
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(kind, name)
);

CREATE TABLE IF NOT EXISTS templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  client_type TEXT,       -- clash | singbox | surge | quantumultx | loon | base64 | v2rayn
  content     TEXT,
  is_default  INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT,        -- airport_reset | node_fetch | latency
  ref_id      INTEGER,     -- airport_id or user_id
  status      TEXT,        -- pending | running | success | failed
  log         TEXT,
  created_at  INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_nodes_airport ON nodes(airport_id);
CREATE INDEX IF NOT EXISTS idx_users_token   ON users(token);
`);

// ---- lightweight migrations: add columns that may be missing on older DBs ----
function ensureColumns(table, columns) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, def] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}
ensureColumns('airports', {
  user_agent: 'TEXT', cookie: 'TEXT', auth_token: 'TEXT',
  // reset_mode: 'http' (default) | 'flaresolverr' | 'manual'
  reset_mode: "TEXT DEFAULT 'http'", flaresolverr_url: 'TEXT',
});
ensureColumns('users', {
  traffic_base: 'INTEGER', traffic_used: 'INTEGER',
  traffic_limit: 'INTEGER', traffic_updated_at: 'INTEGER',
});

// ---- settings helpers ----
const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

export function getSetting(key, fallback = null) {
  const row = getStmt.get(key);
  return row ? row.value : fallback;
}
export function setSetting(key, value) {
  setStmt.run(key, value == null ? null : String(value));
}

// ---- seed admin from env on first run ----
export function seedAdmin() {
  if (!getSetting('admin_username')) {
    setSetting('admin_username', config.adminUsername);
    setSetting('admin_password_hash', bcrypt.hashSync(config.adminPassword, 10));
    setSetting('twofa_enabled', '0');
    setSetting('twofa_secret', '');
    console.log(`[init] seeded admin user "${config.adminUsername}" from env`);
  }
}
