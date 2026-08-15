import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { userStatus } from '../services/subscription/build.js';
import { decorateTaskRows } from './tasks.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const nodes = db.prepare('SELECT COUNT(*) n FROM nodes').get().n;
  const users = db.prepare('SELECT * FROM users').all();
  const counts = { active: 0, expiring: 0, expired: 0, exhausted: 0, disabled: 0 };
  for (const u of users) counts[userStatus(u)] = (counts[userStatus(u)] || 0) + 1;

  // airport board: health snapshot per airport (到期/用量/连续失败/节点数)
  const nodeCounts = Object.fromEntries(
    db.prepare('SELECT airport_id, COUNT(*) n FROM nodes GROUP BY airport_id').all().map((r) => [r.airport_id, r.n])
  );
  const airportRows = db.prepare(
    'SELECT id, name, account, group_name, expire_at, used_traffic, total_traffic, last_fetch_at, fetch_fail_count, cost FROM airports ORDER BY id'
  ).all().map((a) => ({ ...a, node_count: nodeCounts[a.id] || 0 }));

  // 成本 / 收益记账：机场成本合计 vs 启用用户收费合计
  const totalCost = airportRows.reduce((s, a) => s + (Number(a.cost) || 0), 0);
  const totalRevenue = users.reduce((s, u) => s + (u.enabled ? (Number(u.price) || 0) : 0), 0);

  const recentTasks = decorateTaskRows(db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 5').all());
  res.json({
    airports: airportRows.length,
    nodes,
    users: users.length,
    userStatus: counts,
    airportBoard: airportRows,
    accounting: { totalCost, totalRevenue, profit: totalRevenue - totalCost },
    recentTasks,
  });
});

export default router;
