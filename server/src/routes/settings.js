import express from 'express';
import bcrypt from 'bcryptjs';
import qrcode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { authenticator } from 'otplib';
import { db, getSetting, setSetting } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { getNotifyConfigMasked, saveNotifyConfig, unmaskPatch, sendTestNotification } from '../services/notify.js';
import { DEFAULT_GLOBAL_EXCLUDE } from '../services/nodeProcess.js';
import { sanitizeAdminSlug } from '../services/util.js';

const router = express.Router();
router.use(requireAuth);

// ---- 数据库备份 / 恢复 ----
// Backup: VACUUM INTO makes a consistent single-file snapshot (WAL-safe), streamed
// as a download; the temp copy is removed afterwards.
router.get('/backup', (req, res) => {
  const tmp = path.join(path.dirname(config.dbPath), `.backup-${Date.now()}.db`);
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  } catch (err) {
    return res.status(500).json({ error: '备份失败：' + err.message });
  }
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  res.download(tmp, `aprid-backup-${stamp}.db`, () => { fs.unlink(tmp, () => {}); });
});

// Restore: accept a raw .db upload, verify it's a valid SQLite DB with our schema,
// then swap it in and restart the process (docker restart policy brings it back).
router.post('/restore', express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 100) return res.status(400).json({ error: '上传文件为空或过小' });
  if (buf.slice(0, 16).toString('latin1') !== 'SQLite format 3\0') {
    return res.status(400).json({ error: '不是有效的 SQLite 数据库文件' });
  }
  const staging = config.dbPath + '.restore';
  try {
    fs.writeFileSync(staging, buf);
    const test = new DatabaseSync(staging, { readOnly: true });
    // must contain our core tables, else it's some other sqlite file
    test.prepare('SELECT 1 FROM settings LIMIT 1').get();
    test.prepare('SELECT 1 FROM users LIMIT 1').all();
    test.close();
  } catch (err) {
    try { fs.unlinkSync(staging); } catch { /* noop */ }
    return res.status(400).json({ error: '数据库校验失败：' + err.message });
  }
  res.json({ ok: true, restarting: true });
  // swap on disk and exit so a clean process reopens the restored DB
  setTimeout(() => {
    try {
      try { db.close(); } catch { /* noop */ }
      for (const s of ['-wal', '-shm', '']) { try { fs.unlinkSync(config.dbPath + s); } catch { /* noop */ } }
      fs.renameSync(staging, config.dbPath);
      console.log('[restore] database replaced, exiting to restart');
    } catch (err) {
      console.error('[restore] swap failed:', err.message);
    }
    process.exit(0);
  }, 600);
});

// ---- 全局节点正则排除 ----
router.get('/node-exclude', (req, res) => {
  res.json({ value: getSetting('global_node_exclude', ''), default: DEFAULT_GLOBAL_EXCLUDE });
});
router.put('/node-exclude', (req, res) => {
  setSetting('global_node_exclude', String(req.body?.value ?? '').trim());
  res.json({ ok: true, value: getSetting('global_node_exclude', '') });
});

// ---- 隐藏管理入口（自定义面板路径） ----
router.get('/admin-path', (req, res) => {
  res.json({ value: sanitizeAdminSlug(getSetting('admin_path', '')) });
});
router.put('/admin-path', (req, res) => {
  const slug = sanitizeAdminSlug(req.body?.value);
  setSetting('admin_path', slug);
  res.json({ ok: true, value: slug });
});

// ---- 订阅下发选项（去重 / 好节点优先） ----
router.get('/delivery', (req, res) => {
  res.json({
    dedup: getSetting('sub_dedup_endpoints', '1') !== '0',
    sortByHealth: getSetting('sub_sort_by_health', '1') !== '0',
    dropDead: getSetting('sub_drop_dead', '0') === '1',
  });
});
router.put('/delivery', (req, res) => {
  const b = req.body || {};
  if (b.dedup !== undefined) setSetting('sub_dedup_endpoints', b.dedup ? '1' : '0');
  if (b.sortByHealth !== undefined) setSetting('sub_sort_by_health', b.sortByHealth ? '1' : '0');
  if (b.dropDead !== undefined) setSetting('sub_drop_dead', b.dropDead ? '1' : '0');
  res.json({
    ok: true,
    dedup: getSetting('sub_dedup_endpoints', '1') !== '0',
    sortByHealth: getSetting('sub_sort_by_health', '1') !== '0',
    dropDead: getSetting('sub_drop_dead', '0') === '1',
  });
});

// ---- 告警通知配置 ----
router.get('/notify', (req, res) => res.json(getNotifyConfigMasked()));
router.put('/notify', (req, res) => {
  const patch = unmaskPatch(req.body || {});
  saveNotifyConfig(patch);
  res.json({ ok: true, config: getNotifyConfigMasked() });
});
router.post('/notify/test', async (req, res) => {
  try {
    const results = await sendTestNotification();
    res.json({ ok: true, results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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
