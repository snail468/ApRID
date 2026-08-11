import express from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { config, resolveBaseUrl } from '../config.js';
import { userStatus } from '../services/subscription/build.js';
import { FORMATS } from '../services/subscription/converters.js';
import { runUserTriggeredReset } from '../services/automation.js';

const router = express.Router();
router.use(requireAuth);

const FIELDS = ['name', 'enabled', 'expire_at', 'template_id', 'group_name', 'remark', 'node_filter', 'traffic_limit'];

function normalize(body) {
  const out = {};
  for (const f of FIELDS) {
    if (body[f] === undefined) continue;
    if (f === 'node_filter') out[f] = typeof body[f] === 'string' ? body[f] : JSON.stringify(body[f] || {});
    else if (f === 'enabled') out[f] = body[f] ? 1 : 0;
    else out[f] = body[f];
  }
  return out;
}

function decorate(u) {
  return { ...u, status: userStatus(u) };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY id DESC').all();
  res.json(rows.map(decorate));
});

router.get('/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  res.json(decorate(u));
});

// subscription links for all formats (for the copy/QR UI)
router.get('/:id/sub', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const base = resolveBaseUrl(req);
  const links = {};
  for (const [key, fmt] of Object.entries(FORMATS)) {
    links[key] = { name: fmt.name, url: `${base}/sub/${u.token}?target=${key}` };
  }
  links.auto = { name: '自动 (按客户端)', url: `${base}/sub/${u.token}` };
  res.json({ token: u.token, name: u.name, links });
});

router.post('/', (req, res) => {
  const data = normalize(req.body || {});
  if (!data.name) return res.status(400).json({ error: '用户名称必填' });
  const now = Date.now();
  const token = nanoid(22);
  const cols = Object.keys(data);
  const info = db.prepare(
    `INSERT INTO users (${cols.join(',')}, token, created_at, updated_at) VALUES (${cols.map(() => '?').join(',')}, ?, ?, ?)`
  ).run(...cols.map((c) => data[c]), token, now, now);
  res.json(decorate(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const data = normalize(req.body || {});
  const cols = Object.keys(data);
  if (!cols.length) return res.status(400).json({ error: '无更新字段' });
  db.prepare(
    `UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
  ).run(...cols.map((c) => data[c]), Date.now(), req.params.id);
  res.json(decorate(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/batch/delete', (req, res) => {
  const ids = req.body?.ids || [];
  const del = db.prepare('DELETE FROM users WHERE id = ?');
  db.transaction((list) => list.forEach((id) => del.run(id)))(ids);
  res.json({ ok: true, deleted: ids.length });
});

// batch set group
router.post('/batch/group', (req, res) => {
  const { ids = [], group_name = null } = req.body || {};
  const g = group_name ? String(group_name).trim() || null : null;
  const upd = db.prepare('UPDATE users SET group_name = ?, updated_at = ? WHERE id = ?');
  const now = Date.now();
  db.transaction((list) => list.forEach((id) => upd.run(g, now, id)))(ids);
  res.json({ ok: true });
});

// batch enable/disable
router.post('/batch/toggle', (req, res) => {
  const { ids = [], enabled } = req.body || {};
  const upd = db.prepare('UPDATE users SET enabled = ?, updated_at = ? WHERE id = ?');
  const now = Date.now();
  db.transaction((list) => list.forEach((id) => upd.run(enabled ? 1 : 0, now, id)))(ids);
  res.json({ ok: true });
});

// Reset subscription: new token invalidates old link, then trigger airport reset automation.
router.post('/:id/reset', async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const now = Date.now();
  const newToken = nanoid(22);
  db.prepare('UPDATE users SET token = ?, reset_at = ?, updated_at = ? WHERE id = ?')
    .run(newToken, now, now, u.id);

  // fire airport automation reset in the background (non-blocking)
  const triggerAutomation = req.body?.triggerAutomation !== false;
  let automation = null;
  if (triggerAutomation) {
    runUserTriggeredReset(u.id).catch(() => {});
    automation = 'started';
  }
  res.json({ ok: true, token: newToken, automation });
});

export default router;
