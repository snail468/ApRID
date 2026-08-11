import express from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { db, getSetting } from '../db.js';
import { config } from '../config.js';
import { signSession, setSessionCookie, clearSessionCookie, requireAuth } from '../middleware/auth.js';

const router = express.Router();

const hashDeviceToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function deviceIsTrusted(req) {
  const raw = req.cookies?.aprid_device;
  if (!raw) return false;
  const row = db.prepare('SELECT * FROM trusted_devices WHERE token_hash = ?').get(hashDeviceToken(raw));
  return !!row && row.expires_at > Date.now();
}

router.post('/login', (req, res) => {
  const { username, password, otp, trustDevice } = req.body || {};
  const adminUser = getSetting('admin_username');
  const hash = getSetting('admin_password_hash');

  if (username !== adminUser || !hash || !bcrypt.compareSync(password || '', hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const twofaEnabled = getSetting('twofa_enabled') === '1';
  if (twofaEnabled && !deviceIsTrusted(req)) {
    const secret = getSetting('twofa_secret');
    if (!otp) return res.status(200).json({ need2fa: true });
    if (!authenticator.check(String(otp), secret)) {
      return res.status(401).json({ error: '两步验证码错误', need2fa: true });
    }
  }

  const token = signSession({ scope: 'admin', user: adminUser });
  setSessionCookie(res, token);

  // trusted device (skip 2FA for TRUSTED_DEVICE_DAYS)
  if (trustDevice && twofaEnabled) {
    const raw = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    db.prepare('INSERT INTO trusted_devices (token_hash, label, created_at, expires_at) VALUES (?,?,?,?)')
      .run(hashDeviceToken(raw), req.headers['user-agent']?.slice(0, 120) || 'device', now, now + config.trustedDeviceDays * 86400000);
    res.cookie('aprid_device', raw, {
      httpOnly: true, sameSite: 'lax', path: '/',
      maxAge: config.trustedDeviceDays * 86400000,
    });
  }

  res.json({ ok: true, token, user: adminUser });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: req.admin.user,
    twofaEnabled: getSetting('twofa_enabled') === '1',
  });
});

export default router;
