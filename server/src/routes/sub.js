import express from 'express';
import { db } from '../db.js';
import { buildSubscription, buildResetNotice } from '../services/subscription/build.js';
import { detectFormat, FORMATS } from '../services/subscription/converters.js';

const router = express.Router();

// public subscription endpoint — NO auth.
// GET /sub/:token?target=clash
router.get('/:token', (req, res) => {
  const token = req.params.token;
  const target = (req.query.target || '').toString().toLowerCase();
  const format = FORMATS[target] ? target : detectFormat(req.headers['user-agent']);

  const user = db.prepare('SELECT * FROM users WHERE token = ?').get(token);

  // token not found -> either never existed or was reset: show "不可获取订阅"
  if (!user) {
    const notice = buildResetNotice(format);
    res.setHeader('Content-Type', notice.contentType);
    return res.send(notice.body);
  }

  const { body, contentType, status } = buildSubscription(user, format);

  res.setHeader('Content-Type', contentType);
  res.setHeader('Profile-Update-Interval', '12');
  // subscription name shown in clients (Chinese-safe via filename*)
  const fname = encodeURIComponent(user.name || 'ApRID');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fname}`);

  // traffic/expiry line for client display
  if (status === 'active' || status === 'expiring') {
    const total = 1099511627776; // 1TB placeholder for aggregated panel
    const used = 0;
    const expire = user.expire_at ? Math.floor(user.expire_at / 1000) : 0;
    res.setHeader('Subscription-Userinfo',
      `upload=0; download=${used}; total=${total}; expire=${expire}`);
  }

  res.send(body);
});

export default router;
