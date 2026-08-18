import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { queryAudit } from '../services/audit.js';
import { db } from '../db.js';

const router = express.Router();
router.use(requireAuth);

// list audit entries (newest first) with optional actor/keyword filter + cursor
router.get('/', (req, res) => {
  const { actor, q, before, limit } = req.query;
  const rows = queryAudit({ actor, q, before, limit });
  res.json(rows);
});

// distinct actors, for the filter dropdown
router.get('/actors', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT actor FROM audit_logs WHERE actor IS NOT NULL ORDER BY actor').all();
  res.json(rows.map((r) => r.actor));
});

export default router;
