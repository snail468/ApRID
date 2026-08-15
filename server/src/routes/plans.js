import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

const num = (v) => (v === '' || v == null ? null : Number(v));

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM plans ORDER BY id').all());
});

router.post('/', (req, res) => {
  const { name, days, traffic_gb, price } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '套餐名必填' });
  const now = Date.now();
  const info = db.prepare('INSERT INTO plans (name, days, traffic_gb, price, created_at) VALUES (?,?,?,?,?)')
    .run(String(name).trim(), num(days), num(traffic_gb), num(price), now);
  res.json(db.prepare('SELECT * FROM plans WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { name, days, traffic_gb, price } = req.body || {};
  db.prepare('UPDATE plans SET name = ?, days = ?, traffic_gb = ?, price = ? WHERE id = ?')
    .run(String(name || '').trim(), num(days), num(traffic_gb), num(price), req.params.id);
  res.json(db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM plans WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
