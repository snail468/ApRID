import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

// Resolve a human-readable target for a task row so logs show e.g.
// "机场订阅重置 · 香港机场 / user@x" instead of a bare id.
export function decorateTaskRows(rows) {
  const airports = new Map(
    db.prepare('SELECT id, name, account FROM airports').all()
      .map((a) => [a.id, a.account ? `${a.name} / ${a.account}` : a.name])
  );
  const users = new Map(db.prepare('SELECT id, name FROM users').all().map((u) => [u.id, u.name]));
  return rows.map((t) => {
    let ref_name = null;
    if (t.ref_id != null) {
      if (t.type === 'airport_reset' || t.type === 'node_fetch' || t.type === 'latency') {
        ref_name = airports.get(t.ref_id) || null;
      } else {
        ref_name = users.get(t.ref_id) || null;
      }
    } else if (t.type === 'traffic_stats' || t.type === 'traffic_reset') {
      ref_name = '全部启用用户';
    }
    return { ...t, ref_name };
  });
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 200').all();
  res.json(decorateTaskRows(rows));
});

router.get('/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  res.json(t);
});

router.delete('/', (req, res) => {
  db.prepare("DELETE FROM tasks WHERE status IN ('success','failed')").run();
  res.json({ ok: true });
});

export default router;
