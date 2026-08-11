import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { fetchAirport } from '../services/airport/fetch.js';
import { runAirportReset } from '../services/automation.js';

const router = express.Router();
router.use(requireAuth);

const FIELDS = ['name', 'url', 'account', 'password', 'sub_url', 'panel_type',
  'request_headers', 'proxy', 'group_name', 'remark', 'node_filter',
  'expire_at', 'used_traffic', 'total_traffic'];

function normalize(body) {
  const out = {};
  for (const f of FIELDS) {
    if (body[f] === undefined) continue;
    if (f === 'request_headers' || f === 'node_filter') {
      out[f] = typeof body[f] === 'string' ? body[f] : JSON.stringify(body[f] || {});
    } else {
      out[f] = body[f];
    }
  }
  return out;
}

function withCounts(ap) {
  const c = db.prepare('SELECT COUNT(*) n FROM nodes WHERE airport_id = ?').get(ap.id);
  return { ...ap, node_count: c.n };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM airports ORDER BY id DESC').all();
  res.json(rows.map(withCounts));
});

router.get('/:id', (req, res) => {
  const ap = db.prepare('SELECT * FROM airports WHERE id = ?').get(req.params.id);
  if (!ap) return res.status(404).json({ error: '机场不存在' });
  res.json(withCounts(ap));
});

router.post('/', (req, res) => {
  const data = normalize(req.body || {});
  if (!data.name) return res.status(400).json({ error: '机场名称必填' });
  const now = Date.now();
  const cols = Object.keys(data);
  const info = db.prepare(
    `INSERT INTO airports (${cols.join(',')}, created_at, updated_at) VALUES (${cols.map(() => '?').join(',')}, ?, ?)`
  ).run(...cols.map((c) => data[c]), now, now);
  res.json(db.prepare('SELECT * FROM airports WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const data = normalize(req.body || {});
  const cols = Object.keys(data);
  if (!cols.length) return res.status(400).json({ error: '无更新字段' });
  db.prepare(
    `UPDATE airports SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
  ).run(...cols.map((c) => data[c]), Date.now(), req.params.id);
  res.json(db.prepare('SELECT * FROM airports WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM airports WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// batch delete
router.post('/batch/delete', (req, res) => {
  const ids = req.body?.ids || [];
  const del = db.prepare('DELETE FROM airports WHERE id = ?');
  const tx = db.transaction((list) => list.forEach((id) => del.run(id)));
  tx(ids);
  res.json({ ok: true, deleted: ids.length });
});

// fetch/pull subscription now
router.post('/:id/fetch', async (req, res) => {
  try {
    const r = await fetchAirport(Number(req.params.id));
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// batch fetch
router.post('/batch/fetch', async (req, res) => {
  const ids = req.body?.ids || db.prepare('SELECT id FROM airports').all().map((r) => r.id);
  const results = [];
  for (const id of ids) {
    try { results.push({ id, ok: true, ...(await fetchAirport(id)) }); }
    catch (err) { results.push({ id, ok: false, error: err.message }); }
  }
  res.json({ results });
});

// automation: reset subscription (login -> reset -> write back -> fetch)
router.post('/:id/reset', async (req, res) => {
  try {
    const r = await runAirportReset(Number(req.params.id));
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message, taskId: err.taskId });
  }
});

export default router;
