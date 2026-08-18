import express from 'express';
import { db, getSetting } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { pingNodes } from '../services/latency.js';
import { recordLatencyResults, getNodeHistory } from '../services/nodeHealth.js';
import { previewFilter, combineExclude } from '../services/nodeProcess.js';

const router = express.Router();
router.use(requireAuth);

// Live rule preview: run a draft filter against the candidate nodes (the given
// airports, or all) and report which nodes are kept vs dropped-with-reason. The
// global node-exclude is folded in exactly as real delivery does, so the preview
// matches what a user's client would actually receive.
router.post('/preview', (req, res) => {
  const { airportIds, filter = {} } = req.body || {};
  const ids = Array.isArray(airportIds) ? airportIds.filter((x) => x != null) : [];
  const rows = ids.length
    ? db.prepare(`SELECT name, type, latency FROM nodes WHERE airport_id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : db.prepare('SELECT name, type, latency FROM nodes').all();
  const f = { ...filter, exclude: combineExclude(getSetting('global_node_exclude', ''), filter.exclude) };
  const { kept, dropped } = previewFilter(rows, f);
  const CAP = 400; // cap transported items; counts stay accurate
  res.json({
    total: rows.length,
    keptCount: kept.length,
    droppedCount: dropped.length,
    kept: kept.slice(0, CAP),
    dropped: dropped.slice(0, CAP),
    truncated: kept.length > CAP || dropped.length > CAP,
  });
});

router.get('/', (req, res) => {
  const { airport_id, type, q } = req.query;
  const windowDays = Number(req.query.windowDays) || 7;
  // Join each node against its availability history (kept by server:port so it
  // survives re-pulls) to expose 可用率 + 平均延迟 over the trailing window.
  let sql = `SELECT n.*, a.name AS airport_name, a.account AS airport_account,
                    h.total AS check_total, h.ok AS check_ok, h.avg_latency AS avg_latency
             FROM nodes n
             LEFT JOIN airports a ON a.id = n.airport_id
             LEFT JOIN (
               SELECT airport_id, server, port,
                      COUNT(*) AS total,
                      SUM(CASE WHEN latency >= 0 THEN 1 ELSE 0 END) AS ok,
                      AVG(CASE WHEN latency >= 0 THEN latency END) AS avg_latency
                 FROM node_checks WHERE ts >= ?
                GROUP BY airport_id, server, port
             ) h ON h.airport_id = n.airport_id AND h.server = n.server AND h.port = n.port
             WHERE 1=1`;
  const params = [Date.now() - windowDays * 86400000];
  if (airport_id) { sql += ' AND n.airport_id = ?'; params.push(airport_id); }
  if (type) { sql += ' AND n.type = ?'; params.push(type); }
  if (q) { sql += ' AND n.name LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY n.airport_id, n.id';
  res.json(db.prepare(sql).all(...params));
});

// latency samples for one node over the trailing window (for the 延迟趋势 curve)
router.get('/:id/history', (req, res) => {
  const node = db.prepare('SELECT airport_id, server, port FROM nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: '节点不存在' });
  const days = Number(req.query.days) || 7;
  res.json(getNodeHistory(node.airport_id, node.server, node.port, days));
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
    ? db.prepare(`SELECT id, airport_id, server, port FROM nodes WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : db.prepare('SELECT id, airport_id, server, port FROM nodes').all();
  const results = await pingNodes(rows);
  recordLatencyResults(rows, results);
  res.json({ results });
});

export default router;
