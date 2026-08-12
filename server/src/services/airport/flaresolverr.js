import { db } from '../../db.js';
import { config } from '../../config.js';

// FlareSolverr integration — the reliable path for Cloudflare-protected airports.
//
// FlareSolverr runs undetected-chromedriver and solves the Cloudflare challenge,
// returning the resulting cookies (crucially cf_clearance) plus the exact
// User-Agent its browser used. We then reuse ApRID's lightweight HTTP adapters
// with that cookie + UA. Because aprid and flaresolverr share the same docker
// network (hence the same public egress IP), and we adopt FlareSolverr's UA, the
// cf_clearance cookie is accepted by Cloudflare — so login / reset / pull all
// pass without us running a full browser ourselves.

function origin(url) {
  let raw = (url || '').trim();
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  const u = new URL(raw);
  return `${u.protocol}//${u.host}`;
}

// merge two "k=v; k2=v2" cookie strings; later values win on name collision
function mergeCookie(existing, add) {
  const map = new Map();
  const put = (str) => (str || '').split(';').map((s) => s.trim()).filter(Boolean).forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) map.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  });
  put(existing); put(add);
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

// Call FlareSolverr to solve the airport's Cloudflare challenge.
// Returns { cookieString, userAgent }.
export async function solveClearance(ap, log) {
  const fsUrl = (ap.flaresolverr_url || '').trim() || config.flaresolverrUrl;
  if (!fsUrl) throw new Error('未配置 FlareSolverr 地址（FLARESOLVERR_URL 或机场「FlareSolverr 地址」字段）');
  const target = origin(ap.url);
  log?.(`FlareSolverr 解 Cloudflare：${fsUrl} → ${target}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 95000);
  let j;
  try {
    const res = await fetch(fsUrl.replace(/\/$/, '') + '/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url: target, maxTimeout: 60000 }),
      signal: controller.signal,
    });
    j = await res.json().catch(() => null);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('FlareSolverr 超时（>95s）：站点挑战过重或服务过载');
    throw new Error(`无法连接 FlareSolverr（${fsUrl}）：${e.message}。请确认 flaresolverr 侧车已启动`);
  } finally {
    clearTimeout(timer);
  }

  if (!j) throw new Error('FlareSolverr 返回无法解析');
  if (j.status !== 'ok') throw new Error(`FlareSolverr 未通过：${j.message || j.status}`);
  const sol = j.solution || {};
  const cookieString = (sol.cookies || []).map((c) => `${c.name}=${c.value}`).join('; ');
  if (!/cf_clearance=/.test(cookieString)) {
    log?.('⚠ FlareSolverr 未返回 cf_clearance（该站点可能未启用 CF，或挑战类型不受支持）');
  }
  return { cookieString, userAgent: sol.userAgent || '' };
}

// Solve + persist the clearance onto the airport record, so the reset AND the
// subsequent subscription pull (and future pulls until it expires) all reuse it.
// Returns an in-memory ap with the merged cookie / UA applied.
export async function applyClearance(ap, log) {
  const { cookieString, userAgent } = await solveClearance(ap, log);
  const cookie = mergeCookie(ap.cookie, cookieString);
  const ua = userAgent || ap.user_agent || null;
  if (ap.id) {
    db.prepare('UPDATE airports SET cookie = ?, user_agent = ?, updated_at = ? WHERE id = ?')
      .run(cookie, ua, Date.now(), ap.id);
  }
  log?.('已获取 cf_clearance 并写回机场（UA 同步为 FlareSolverr 浏览器，供后续拉取复用）');
  return { ...ap, cookie, user_agent: ua };
}
