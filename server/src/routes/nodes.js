import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { pingNodes } from '../services/latency.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { airport_id, type, q } = req.query;
  let sql = `SELECT n.*, a.name AS airport_name, a.account AS airport_account
             FROM nodes n LEFT JOIN airports a ON a.id = n.airport_id WHERE 1=1`;
  const params = [];
  if (airport_id) { sql += ' AND n.airport_id = ?'; params.push(airport_id); }
  if (type) { sql += ' AND n.type = ?'; params.push(type); }
  if (q) { sql += ' AND n.name LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY n.airport_id, n.id';
  res.json(db.prepare(sql).all(...params));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM nodes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/batch/delete', (req, res) => {
  const ids = req.body?.ids || [];
  const del = db.prepare('DELETE FROM nodes WHERE id = ?');
  db.transaction((list) => list.forEach((id) => del.run(id)))(ids);
  res.json({ ok: true, deleted: ids.length });
});

// latency check for selected nodes (or all)
router.post('/latency', async (req, res) => {
  const ids = req.body?.ids;
  const rows = ids?.length
    ? db.prepare(`SELECT id, server, port FROM nodes WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : db.prepare('SELECT id, server, port FROM nodes').all();
  const results = await pingNodes(rows);
  const now = Date.now();
  const upd = db.prepare('UPDATE nodes SET latency = ?, latency_at = ? WHERE id = ?');
  db.transaction((list) => list.forEach((r) => upd.run(r.latency, now, r.id)))(results);
  res.json({ results });
});

export default router;
