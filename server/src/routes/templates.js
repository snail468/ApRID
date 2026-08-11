import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM templates ORDER BY id DESC').all());
});

router.post('/', (req, res) => {
  const { name, client_type, content, is_default } = req.body || {};
  if (!name) return res.status(400).json({ error: '模板名称必填' });
  const now = Date.now();
  if (is_default && client_type) {
    db.prepare('UPDATE templates SET is_default = 0 WHERE client_type = ?').run(client_type);
  }
  const info = db.prepare(
    'INSERT INTO templates (name, client_type, content, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?)'
  ).run(name, client_type || '', content || '', is_default ? 1 : 0, now, now);
  res.json(db.prepare('SELECT * FROM templates WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { name, client_type, content, is_default } = req.body || {};
  if (is_default && client_type) {
    db.prepare('UPDATE templates SET is_default = 0 WHERE client_type = ? AND id != ?').run(client_type, req.params.id);
  }
  db.prepare(
    'UPDATE templates SET name = ?, client_type = ?, content = ?, is_default = ?, updated_at = ? WHERE id = ?'
  ).run(name, client_type || '', content || '', is_default ? 1 : 0, Date.now(), req.params.id);
  res.json(db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
