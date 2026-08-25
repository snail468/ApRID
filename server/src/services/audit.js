// Admin audit trail. A middleware records every *mutating* admin API call
// (POST/PUT/DELETE/PATCH) after the response finishes, so it can never delay or
// break the request. describeAction/sanitizeBody are pure (unit-tested).

import { db } from '../db.js';
import { describeAction, sanitizeBody, explainAudit } from './auditFormat.js';

export { describeAction, sanitizeBody, explainAudit };

const RETENTION_DAYS = 90;

function insertAudit(row) {
  db.prepare(
    'INSERT INTO audit_logs (actor, method, path, action, status, ip, detail, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(row.actor ?? null, row.method, row.path, row.action, row.status, row.ip ?? null, row.detail ?? null, row.created_at);
  db.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(row.created_at - RETENTION_DAYS * 86400000);
}

// Express middleware: mount on /api BEFORE the routers. Logs after the response
// finishes; wrapped so audit failures never surface to the client.
export function auditMiddleware(req, res, next) {
  const method = req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const path = (req.originalUrl || req.url).split('?')[0];
  // capture the body now (handlers may mutate req.body later)
  const detail = sanitizeBody(req.body);
  res.on('finish', () => {
    try {
      // actor: the authenticated admin, or the attempted username on login
      const isLogin = path === '/api/auth/login';
      if (path === '/api/auth/logout') return; // low-signal, skip
      const actor = req.admin?.user || (isLogin ? req.body?.username : null) || null;
      // only record authenticated mutations + login attempts; unauthenticated
      // 401s elsewhere (expired session) are noise.
      if (!req.admin && !isLogin) return;
      insertAudit({
        actor,
        method,
        path,
        action: isLogin
          ? (res.statusCode === 200 ? '登录成功' : '登录失败')
          : describeAction(method, path),
        status: res.statusCode,
        ip: req.ip || req.socket?.remoteAddress || null,
        detail,
        created_at: Date.now(),
      });
    } catch { /* never let auditing break anything */ }
  });
  next();
}

// Query helper for the audit page: newest first, with optional filters.
export function queryAudit({ actor, q, limit = 200, before } = {}) {
  let sql = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];
  if (actor) { sql += ' AND actor = ?'; params.push(actor); }
  if (q) { sql += ' AND (action LIKE ? OR path LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (before) { sql += ' AND id < ?'; params.push(before); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(Math.min(Number(limit) || 200, 500));
  // attach a natural-language explanation per row (computed at read time so it
  // also covers历史记录). explainAudit is pure and cannot throw on bad JSON.
  return db.prepare(sql).all(...params).map((r) => ({ ...r, explain: explainAudit(r) }));
}
