import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { userStatus } from '../services/subscription/build.js';
import { decorateTaskRows } from './tasks.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const airports = db.prepare('SELECT COUNT(*) n FROM airports').get().n;
  const nodes = db.prepare('SELECT COUNT(*) n FROM nodes').get().n;
  const users = db.prepare('SELECT * FROM users').all();
  const counts = { active: 0, expiring: 0, expired: 0, disabled: 0 };
  for (const u of users) counts[userStatus(u)] = (counts[userStatus(u)] || 0) + 1;

  const recentTasks = decorateTaskRows(db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 5').all());
  res.json({
    airports,
    nodes,
    users: users.length,
    userStatus: counts,
    recentTasks,
  });
});

export default router;
