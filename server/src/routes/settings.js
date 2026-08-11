import express from 'express';
import bcrypt from 'bcryptjs';
import qrcode from 'qrcode';
import { authenticator } from 'otplib';
import { db, getSetting, setSetting } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

// change account name / password
router.post('/account', (req, res) => {
  const { username, currentPassword, newPassword } = req.body || {};
  const hash = getSetting('admin_password_hash');
  if (!bcrypt.compareSync(currentPassword || '', hash)) {
    return res.status(400).json({ error: '当前密码不正确' });
  }
  if (username) setSetting('admin_username', username.trim());
  if (newPassword) setSetting('admin_password_hash', bcrypt.hashSync(newPassword, 10));
  res.json({ ok: true, username: getSetting('admin_username') });
});

// begin 2FA setup: generate secret + otpauth QR (not yet enabled)
router.post('/2fa/setup', async (req, res) => {
  const secret = authenticator.generateSecret();
  setSetting('twofa_pending_secret', secret);
  const uri = authenticator.keyuri(getSetting('admin_username'), 'ApRID', secret);
  const qr = await qrcode.toDataURL(uri);
  res.json({ secret, uri, qr });
});

// confirm 2FA with a code -> enable
router.post('/2fa/enable', (req, res) => {
  const { otp } = req.body || {};
  const secret = getSetting('twofa_pending_secret');
  if (!secret) return res.status(400).json({ error: '请先开始两步验证设置' });
  if (!authenticator.check(String(otp || ''), secret)) {
    return res.status(400).json({ error: '验证码错误' });
  }
  setSetting('twofa_secret', secret);
  setSetting('twofa_enabled', '1');
  setSetting('twofa_pending_secret', '');
  res.json({ ok: true });
});

router.post('/2fa/disable', (req, res) => {
  const { currentPassword } = req.body || {};
  if (!bcrypt.compareSync(currentPassword || '', getSetting('admin_password_hash'))) {
    return res.status(400).json({ error: '当前密码不正确' });
  }
  setSetting('twofa_enabled', '0');
  setSetting('twofa_secret', '');
  // revoke all trusted devices too
  db.prepare('DELETE FROM trusted_devices').run();
  res.json({ ok: true });
});

// trusted devices management
router.get('/devices', (req, res) => {
  const rows = db.prepare('SELECT id, label, created_at, expires_at FROM trusted_devices ORDER BY created_at DESC').all();
  res.json(rows);
});
router.delete('/devices/:id', (req, res) => {
  db.prepare('DELETE FROM trusted_devices WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
router.delete('/devices', (req, res) => {
  db.prepare('DELETE FROM trusted_devices').run();
  res.json({ ok: true });
});

router.get('/', (req, res) => {
  res.json({
    username: getSetting('admin_username'),
    twofaEnabled: getSetting('twofa_enabled') === '1',
  });
});

export default router;
