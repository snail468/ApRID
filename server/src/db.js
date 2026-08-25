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
  latency     INTEGER,     -- ms, -1 = timeout/unknown (TCP handshake RTT)
  latency_at  INTEGER,
  alive       INTEGER,     -- real through-proxy probe: 1 ok, 0 dead, null untested
  alive_ms    INTEGER,     -- proxy latency to the test URL (ms) when alive
  alive_at    INTEGER,
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
  type        TEXT,        -- airport_reset | node_fetch | latency | traffic_stats | alerts | user_pull
  ref_id      INTEGER,     -- airport_id or user_id
  status      TEXT,        -- pending | running | success | failed
  log         TEXT,
  created_at  INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS sub_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  ip          TEXT,
  user_agent  TEXT,
  target      TEXT,        -- requested/resolved client format
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  days        INTEGER,     -- validity length added on renewal
  traffic_gb  INTEGER,     -- per-cycle cap in GB (0/null = unlimited)
  price       REAL,        -- charge for this plan
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS renewals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER,
  plan_name     TEXT,
  days          INTEGER,
  price         REAL,
  before_expire INTEGER,
  after_expire  INTEGER,
  created_at    INTEGER NOT NULL
);

-- daily-ish snapshots of an airport's cumulative used traffic, for trend charts
-- and trailing-window consumption (used to price 流量套餐 airports).
CREATE TABLE IF NOT EXISTS traffic_snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  airport_id INTEGER,
  cum        INTEGER,   -- monotonic used_traffic_cum
  used       INTEGER,   -- raw used_traffic
  total      INTEGER,
  ts         INTEGER NOT NULL
);

-- per-airport cost ledger: every payment (开通/续费/买量/加油). kind:
--   'time'   = 时长套餐 (amount 元 / days 天)  -> monthly = amount/days*30
--   'traffic'= 流量套餐/买量 (amount 元 / traffic_gb GB) -> 单价 = Σamount/Σgb
--   'topup'  = 时长机场的一次性加油/重置 (amount 元) -> 计入当月
CREATE TABLE IF NOT EXISTS airport_costs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  airport_id INTEGER,
  kind       TEXT NOT NULL,
  amount     REAL,
  traffic_gb REAL,
  days       INTEGER,
  note       TEXT,
  created_at INTEGER NOT NULL
);

-- admin audit trail: one row per mutating admin action (谁/何时/改了什么/结果).
-- Written by the audit middleware after the response finishes, so logging can
-- never break the request. The detail column is a sanitized JSON snapshot of
-- the request body (passwords/tokens/secrets redacted).
CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT,      -- admin username (or attempted username on login)
  method     TEXT,      -- POST | PUT | DELETE | PATCH
  path       TEXT,      -- request path (no query string)
  action     TEXT,      -- human-readable 中文 summary
  status     INTEGER,   -- HTTP status code
  ip         TEXT,
  detail     TEXT,      -- sanitized JSON body snapshot
  created_at INTEGER NOT NULL
);

-- history of every latency check, keyed by the physical endpoint (server:port)
-- rather than nodes.id: latency is an endpoint property, so one row per endpoint
-- per run is shared by all duplicate nodes across airports/accounts, and history
-- survives the delete+reinsert that airport refetch does. Powers 可用率 + 延迟趋势
-- and the good-node-first ordering. (airport_id is legacy/unused — kept nullable
-- for older rows; new inserts leave it NULL.)
CREATE TABLE IF NOT EXISTS node_checks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  airport_id INTEGER,   -- legacy, unused; new rows are NULL
  server     TEXT,
  port       INTEGER,
  latency    INTEGER,   -- ms, -1 = timeout/unreachable
  ts         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_airport ON nodes(airport_id);
CREATE INDEX IF NOT EXISTS idx_users_token   ON users(token);
CREATE INDEX IF NOT EXISTS idx_sub_logs_user ON sub_logs(user_id, id);
CREATE INDEX IF NOT EXISTS idx_snap_airport  ON traffic_snapshots(airport_id, ts);
CREATE INDEX IF NOT EXISTS idx_costs_airport ON airport_costs(airport_id, id);
CREATE INDEX IF NOT EXISTS idx_node_checks   ON node_checks(airport_id, server, port, ts);
CREATE INDEX IF NOT EXISTS idx_node_checks_ep ON node_checks(server, port, ts);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
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
  // short alias to tell同机场多账户 apart (主号 / 小号 / A), used across list &下发
  account_label: 'TEXT',
  // reset_mode: 'http' (default) | 'manual'
  reset_mode: "TEXT DEFAULT 'http'",
  // monotonic cumulative used traffic (bytes) that survives airport-side resets,
  // plus the last raw reading used to detect a reset (a drop in reported usage);
  // alert dedup state for the 到期/超限告警 automation.
  used_traffic_cum: 'INTEGER', used_traffic_last: 'INTEGER',
  alert_key: 'TEXT', alert_at: 'INTEGER',
  // consecutive subscription-pull failures (reset to 0 on success) + last success
  // time, powering the 拉取连续失败 alert; cost for 成本/收益记账. cost is the
  // normalized 每月成本 (元/月); cost_amount/cost_cycle_days keep the raw
  // "付了多少钱 / 多少天一个周期" input so it can be re-edited.
  fetch_fail_count: 'INTEGER', last_fetch_ok: 'INTEGER',
  cost: 'REAL', cost_amount: 'REAL', cost_cycle_days: 'INTEGER',
  // 'time' | 'traffic' — how this airport is billed (drives monthly-cost calc)
  cost_type: "TEXT DEFAULT 'time'",
});

// Backfill raw cost input for rows that only had the old monthly `cost` value.
db.exec(`
  UPDATE airports SET cost_amount = cost, cost_cycle_days = 30
   WHERE cost IS NOT NULL AND cost_amount IS NULL
`);

// Migrate legacy per-airport cost fields into the cost ledger (once): any airport
// that has a cost but no ledger rows gets a 'time' package record.
{
  const legacy = db.prepare(
    'SELECT id, cost_amount, cost_cycle_days FROM airports WHERE cost_amount IS NOT NULL AND id NOT IN (SELECT DISTINCT airport_id FROM airport_costs)'
  ).all();
  if (legacy.length) {
    const now = Date.now();
    const ins = db.prepare('INSERT INTO airport_costs (airport_id, kind, amount, days, created_at) VALUES (?,?,?,?,?)');
    const setType = db.prepare("UPDATE airports SET cost_type = COALESCE(cost_type, 'time') WHERE id = ?");
    for (const a of legacy) { ins.run(a.id, 'time', a.cost_amount, a.cost_cycle_days || 30, now); setType.run(a.id); }
  }
}
ensureColumns('users', {
  traffic_base: 'INTEGER', traffic_used: 'INTEGER',
  traffic_limit: 'INTEGER', traffic_updated_at: 'INTEGER',
  alert_key: 'TEXT', alert_at: 'INTEGER',
  last_sub_at: 'INTEGER', // last time the user pulled their panel subscription
  sec_alert_at: 'INTEGER', // last security (multi-IP) alert time, for dedup
  price: 'REAL',           // charge for this user, for 成本/收益记账
  // monthly traffic auto-reset: day-of-month 1–31 (null/0 = off), and the last
  // time the traffic counter was reset (manual or auto), for the daily sweep dedup.
  traffic_reset_day: 'INTEGER', traffic_reset_at: 'INTEGER',
});
ensureColumns('nodes', {
  // real through-proxy availability probe results (see services/probe.js)
  alive: 'INTEGER', alive_ms: 'INTEGER', alive_at: 'INTEGER',
});

// Seed the cumulative-traffic baseline on existing rows so the monotonic counter
// starts aligned with the last absolute reading (keeps user traffic_base, which
// was measured on the absolute scale, consistent across the upgrade).
db.exec(`
  UPDATE airports
     SET used_traffic_cum  = COALESCE(used_traffic_cum, used_traffic),
         used_traffic_last = COALESCE(used_traffic_last, used_traffic)
   WHERE used_traffic IS NOT NULL
     AND (used_traffic_cum IS NULL OR used_traffic_last IS NULL)
`);

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
