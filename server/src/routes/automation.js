import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { runAirportReset, runTrafficStats } from '../services/automation.js';

const router = express.Router();
router.use(requireAuth);

// Overview of automations + their most recent task, so the UI can render状态/进度.
router.get('/', (req, res) => {
  const last = (type) => db.prepare('SELECT * FROM tasks WHERE type = ? ORDER BY id DESC LIMIT 1').get(type);
  const airports = db.prepare('SELECT id, name, group_name, account, sub_url, last_fetch_at FROM airports ORDER BY id DESC').all();
  res.json({
    automations: [
      { key: 'airport_reset', name: '机场订阅自动重置', last: last('airport_reset') },
      { key: 'traffic_stats', name: '用户流量统计', last: last('traffic_stats') },
    ],
    airports,
  });
});

// Run "机场订阅自动重置": one airport, or all when no id supplied.
router.post('/airport-reset', async (req, res) => {
  const id = req.body?.airportId;
  try {
    if (id) {
      const r = await runAirportReset(Number(id));
      return res.json({ ok: true, ...r });
    }
    const ids = db.prepare('SELECT id FROM airports WHERE sub_url IS NOT NULL AND sub_url != \'\'').all().map((a) => a.id);
    const results = [];
    for (const aid of ids) {
      try { results.push({ airportId: aid, ok: true, ...(await runAirportReset(aid)) }); }
      catch (err) { results.push({ airportId: aid, ok: false, error: err.message, taskId: err.taskId }); }
    }
    res.json({ ok: true, results });
  } catch (err) {
    res.status(400).json({ error: err.message, taskId: err.taskId });
  }
});

// Run "用户流量统计".
router.post('/traffic-stats', async (req, res) => {
  try {
    const r = await runTrafficStats({ refetch: req.body?.refetch !== false });
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message, taskId: err.taskId });
  }
});

export default router;
