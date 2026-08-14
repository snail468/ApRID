import crypto from 'node:crypto';
import { config } from '../config.js';

// Stateless, tamper-proof "magic link" tokens used by the alert emails / Telegram
// messages so the operator can act (回填订阅链接 / 拉取机场) from a public,
// login-free page. A token is `base64url(payload).base64url(HMAC-SHA256)` signed
// with JWT_SECRET. Security rests on three things: the HMAC (unforgeable without
// the secret), a short expiry, and a hard whitelist of just two actions bound to
// a single airport id — the public routes can do nothing else.

const DEFAULT_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days
const ACTIONS = new Set(['refill', 'pull']);

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function sign(data) {
  return b64url(crypto.createHmac('sha256', config.jwtSecret).update(data).digest());
}

// t: 'refill' | 'pull', ap: airportId. Returns a URL-safe token string.
export function signAction({ t, ap, ttlMs = DEFAULT_TTL_MS }) {
  if (!ACTIONS.has(t)) throw new Error(`未知动作：${t}`);
  const payload = { t, ap: Number(ap), exp: Date.now() + ttlMs };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

// Verify signature + expiry, return the payload, or throw a friendly error.
export function verifyAction(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) throw new Error('链接无效');
  const expected = sign(body);
  // constant-time compare
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('链接签名无效或已被篡改');
  let payload;
  try { payload = JSON.parse(b64urlDecode(body).toString('utf8')); } catch { throw new Error('链接无效'); }
  if (!ACTIONS.has(payload.t)) throw new Error('链接动作不被允许');
  if (!payload.exp || Date.now() > payload.exp) throw new Error('链接已过期，请在面板重新触发告警获取新链接');
  return payload;
}

// Build an absolute action URL from a base url (panel public address).
export function actionUrl(baseUrl, { t, ap, ttlMs }) {
  const token = signAction({ t, ap, ttlMs });
  const base = String(baseUrl || '').replace(/\/$/, '');
  return `${base}/action/${t}?token=${encodeURIComponent(token)}`;
}
