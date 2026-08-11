import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 200').all();
  res.json(rows);
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
