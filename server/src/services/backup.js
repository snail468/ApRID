// 异地备份：把数据库快照上传到 WebDAV 或自定义 HTTP 端点。
// 配置以单条 JSON 存在 settings 表；密码脱敏后才回传前端（与 notify.js 同套路）。
// 快照复用 VACUUM INTO（WAL 安全的单文件一致性快照），上传后删除临时文件。

import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting, setSetting } from '../db.js';
import { config } from '../config.js';

const KEY = 'offsite_backup_config';
const MASK = '••••••••';

const DEFAULTS = {
  provider: 'webdav',   // 'webdav' | 'http'
  url: '',              // WebDAV 目录 URL，或 HTTP 上传端点
  username: '',         // Basic 认证用户名（可空）
  password: '',         // Basic 认证密码 / 令牌（可空）
  method: 'PUT',        // http provider 用：PUT | POST
  keep: 7,              // WebDAV 上保留最近份数（best-effort 清理旧备份；0=不清理）
};

export function getBackupConfig() {
  let stored = {};
  try { stored = JSON.parse(getSetting(KEY, '{}')) || {}; } catch { stored = {}; }
  return { ...DEFAULTS, ...stored };
}

// 保存补丁；空密码表示"保持原密码不变"（GET 从不回传真实密码）。
export function saveBackupConfig(patch = {}) {
  const cur = getBackupConfig();
  const next = { ...cur, ...patch };
  if (patch.password === '' || patch.password == null) next.password = cur.password;
  next.keep = Math.max(0, Math.min(365, Number(next.keep) || 0));
  next.provider = next.provider === 'http' ? 'http' : 'webdav';
  next.method = String(next.method || 'PUT').toUpperCase() === 'POST' ? 'POST' : 'PUT';
  setSetting(KEY, JSON.stringify(next));
  return getBackupConfig();
}

// 交给前端的配置：密码脱敏成占位符，UI 只显示"已配置"而不泄露值。
export function getBackupConfigMasked() {
  const c = getBackupConfig();
  return { ...c, password: c.password ? MASK : '' };
}
// 保存前把占位符还原成"不改动"。
export function unmaskBackupPatch(patch = {}) {
  const p = { ...patch };
  if (p.password === MASK) delete p.password;
  return p;
}

// VACUUM INTO 生成一致性快照文件，返回 { path, filename }。调用方负责删除临时文件。
export function makeSnapshot() {
  const tmp = path.join(path.dirname(config.dbPath), `.backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const d = new Date();
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  return { path: tmp, filename: `aprid-backup-${stamp}.db` };
}
const p2 = (n) => String(n).padStart(2, '0');

function authHeader(cfg) {
  if (!cfg.username && !cfg.password) return null;
  return 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`, 'utf8').toString('base64');
}

// ---- WebDAV ----
async function webdavPut(cfg, url, body, timeoutMs = 30000) {
  const headers = { 'Content-Type': 'application/octet-stream' };
  const auth = authHeader(cfg);
  if (auth) headers.Authorization = auth;
  const res = await fetchWithTimeout(url, { method: 'PUT', headers, body }, timeoutMs);
  if (res.status < 200 || res.status >= 300) throw new Error(`WebDAV 上传失败：HTTP ${res.status}`);
  return res;
}

async function webdavDelete(cfg, url) {
  const headers = {};
  const auth = authHeader(cfg);
  if (auth) headers.Authorization = auth;
  try { await fetchWithTimeout(url, { method: 'DELETE', headers }, 15000); } catch { /* best-effort */ }
}

// PROPFIND depth 1，取出目录下的历史备份文件（用于按 keep 清理）。best-effort。
async function webdavListBackups(cfg, baseDir) {
  const headers = { Depth: '1', 'Content-Type': 'application/xml' };
  const auth = authHeader(cfg);
  if (auth) headers.Authorization = auth;
  const body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/></d:prop></d:propfind>';
  let xml = '';
  try {
    const res = await fetchWithTimeout(baseDir, { method: 'PROPFIND', headers, body }, 15000);
    if (res.status < 200 || res.status >= 300) return [];
    xml = await res.text();
  } catch { return []; }
  const hrefs = [...xml.matchAll(/<[^>]*?href[^>]*?>([^<]+)<\/[^>]*?href>/gi)].map((m) => decodeAndTrim(m[1]));
  return hrefs.filter((h) => /aprid-backup-[\w-]+\.db$/i.test(h));
}

function decodeAndTrim(s) { try { return decodeURIComponent(s.trim()); } catch { return s.trim(); } }

// 把 PROPFIND 返回的 href（可能是绝对路径或完整 URL）解析成可 DELETE 的绝对 URL。
function resolveHref(baseDir, href) {
  if (/^https?:\/\//i.test(href)) return href;
  const u = new URL(baseDir);
  return `${u.origin}${href.startsWith('/') ? '' : '/'}${href}`;
}

async function retainWebdav(cfg, baseDir, log) {
  const keep = Number(cfg.keep) || 0;
  if (keep <= 0) return 0;
  const backups = await webdavListBackups(cfg, baseDir);
  if (backups.length <= keep) return 0;
  // 文件名含 YYYYMMDD-HHmm 时间戳，字典序 = 时间序；保留最新 keep 个，其余删除。
  const sorted = backups.sort();
  const toDelete = sorted.slice(0, sorted.length - keep);
  for (const href of toDelete) await webdavDelete(cfg, resolveHref(baseDir, href));
  log?.(`已清理 ${toDelete.length} 个旧备份（保留最近 ${keep} 份）`);
  return toDelete.length;
}

// ---- HTTP 自定义端点 ----
async function httpUpload(cfg, buf, filename) {
  const method = String(cfg.method || 'PUT').toUpperCase() === 'POST' ? 'POST' : 'PUT';
  const headers = { 'Content-Type': 'application/octet-stream', 'X-Filename': filename };
  const auth = authHeader(cfg);
  if (auth) headers.Authorization = auth;
  const res = await fetchWithTimeout(cfg.url, { method, headers, body: buf }, 30000);
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP 上传失败：HTTP ${res.status}`);
  return cfg.url;
}

// ---- 对外：执行一次异地备份（快照 + 上传 + 清理），返回统计。log 回调写任务日志。----
export async function performOffsiteBackup(cfg, { log } = {}) {
  if (!cfg || !cfg.url) throw new Error('未配置备份地址（URL）');
  log?.(`生成数据库快照…`);
  const snap = makeSnapshot();
  try {
    const buf = fs.readFileSync(snap.path);
    log?.(`快照就绪：${snap.filename}（${fmtBytes(buf.length)}），上传方式：${cfg.provider === 'http' ? 'HTTP' : 'WebDAV'}`);
    let target, deleted = 0;
    if (cfg.provider === 'http') {
      target = await httpUpload(cfg, buf, snap.filename);
    } else {
      const baseDir = cfg.url.replace(/\/+$/, '') + '/';
      target = baseDir + snap.filename;
      await webdavPut(cfg, target, buf);
      try { deleted = await retainWebdav(cfg, baseDir, log); } catch (err) { log?.(`清理旧备份跳过：${err.message}`); }
    }
    log?.(`上传成功 → ${target}`);
    return { target, bytes: buf.length, deleted, filename: snap.filename };
  } finally {
    fs.unlink(snap.path, () => {});
  }
}

// ---- 对外：测试连通。WebDAV 走"上传探针文件再删除"以真实验证写权限；HTTP 走可达性探测。----
export async function testBackupConnection(cfg) {
  if (!cfg || !cfg.url) throw new Error('请先填写备份地址（URL）');
  if (cfg.provider === 'http') {
    // 自定义 HTTP 端点：发一个 HEAD 探测可达性（拿到任意 HTTP 响应即视为可达）。
    try {
      const headers = {};
      const auth = authHeader(cfg);
      if (auth) headers.Authorization = auth;
      const res = await fetchWithTimeout(cfg.url, { method: 'HEAD', headers }, 12000);
      return { ok: true, note: `端点可达（HTTP ${res.status}）；实际写入将在备份时验证` };
    } catch (err) {
      throw new Error(`无法连接端点：${err.message}`);
    }
  }
  // WebDAV：上传一个极小的探针文件再删除，真实验证读写与认证。
  const baseDir = cfg.url.replace(/\/+$/, '') + '/';
  const probeName = `.aprid-conn-test-${Date.now()}`;
  const probeUrl = baseDir + probeName;
  try {
    await webdavPut(cfg, probeUrl, Buffer.from('aprid-connectivity-test'), 12000);
  } catch (err) {
    throw new Error(`WebDAV 连接/写入失败：${err.message}（检查 URL、账号密码，URL 需指向一个已存在的目录）`);
  }
  await webdavDelete(cfg, probeUrl);
  return { ok: true, note: 'WebDAV 读写正常（探针文件已写入并删除）' };
}

// fetch 带超时（AbortController），避免上传/探测卡死任务。
async function fetchWithTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('请求超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
