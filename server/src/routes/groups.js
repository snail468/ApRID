import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

const KINDS = { airport: 'airports', user: 'users' };

function assertKind(kind) {
  if (!KINDS[kind]) throw Object.assign(new Error('分组类型无效'), { status: 400 });
  return KINDS[kind];
}

// list groups of a kind (with member counts derived from the target table)
router.get('/', (req, res) => {
  const kind = String(req.query.kind || '');
  const table = assertKind(kind);
  const rows = db.prepare('SELECT * FROM groups WHERE kind = ? ORDER BY name').all(kind);
  const counts = db.prepare(
    `SELECT group_name AS name, COUNT(*) AS n FROM ${table} WHERE group_name IS NOT NULL AND group_name != '' GROUP BY group_name`
  ).all();
  const countMap = Object.fromEntries(counts.map((c) => [c.name, c.n]));
  res.json(rows.map((g) => ({ ...g, count: countMap[g.name] || 0 })));
});

router.post('/', (req, res) => {
  const { kind, name } = req.body || {};
  assertKind(kind);
  const trimmed = String(name || '').trim();
  if (!trimmed) return res.status(400).json({ error: '分组名称必填' });
  const now = Date.now();
  try {
    const info = db.prepare('INSERT INTO groups (kind, name, created_at) VALUES (?,?,?)').run(kind, trimmed, now);
    res.json(db.prepare('SELECT * FROM groups WHERE id = ?').get(info.lastInsertRowid));
  } catch {
    res.status(400).json({ error: '该分组已存在' });
  }
});

// rename: also update every member row currently in the group
router.put('/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: '分组不存在' });
  const table = assertKind(g.kind);
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '分组名称必填' });
  const tx = db.transaction(() => {
    db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, g.id);
    db.prepare(`UPDATE ${table} SET group_name = ? WHERE group_name = ?`).run(name, g.name);
  });
  try { tx(); } catch { return res.status(400).json({ error: '该分组名已存在' }); }
  res.json(db.prepare('SELECT * FROM groups WHERE id = ?').get(g.id));
});

// delete group and clear it from members
router.delete('/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!g) return res.json({ ok: true });
  const table = assertKind(g.kind);
  db.transaction(() => {
    db.prepare(`UPDATE ${table} SET group_name = NULL WHERE group_name = ?`).run(g.name);
    db.prepare('DELETE FROM groups WHERE id = ?').run(g.id);
  })();
  res.json({ ok: true });
});

export default router;
