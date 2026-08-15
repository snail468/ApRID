import { db } from '../db.js';
import { userStatus } from './subscription/build.js';
import { notify, buildUserAlert, buildAirportAlert, buildUserMultiIpAlert, getNotifyConfig } from './notify.js';

// Alert evaluation + de-duplication + sending, kept in its own module so both the
// event hooks (fetch.js after a pull, automation.js after traffic stats) and the
// periodic sweep (scheduler) can share one implementation without import cycles.
//
// Trigger conditions split two ways:
//   - event-driven: 用户流量超限 fires from runTrafficStats; 机场用量≥97% fires from
//     fetchAirport — both at the moment the data actually changes.
//   - time-driven:  用户到期 / 机场到期≤1天 have no event; the scheduler sweeps hourly.
// De-dup: each row stores alert_key + alert_at. A new key sends immediately; the
// same key re-sends only past the cooldown; a cleared condition wipes the key.

const DAY_MS = 86400000;
export const AIRPORT_USAGE_THRESHOLD = 0.97; // 机场用量告警阈值

function cooldownMs() {
  return Math.max(0, Number(getNotifyConfig().cooldownHours) || 0) * 3600000;
}
function shouldSend(row, key, now, cd) {
  return row.alert_key !== key || !row.alert_at || (cd > 0 && now - row.alert_at >= cd);
}

// user condition -> dedup key ('expired' | 'exhausted' | 'expiring' | null)
export function evalUserReason(u, now = Date.now()) {
  const s = userStatus(u);
  if (s === 'expired') return 'expired';
  if (s === 'exhausted') return 'exhausted';
  // time-driven renewal reminder: enabled, not yet expired, ≤ 1 day left
  if (u.enabled && u.expire_at) {
    const left = u.expire_at - now;
    if (left > 0 && left <= DAY_MS) return 'expiring';
  }
  return null;
}

// airport condition -> { reasons:[], key:'traffic|expire|fetch' } (key '' = no alert)
export function evalAirport(ap, now = Date.now(), { fetchFailThreshold = 3 } = {}) {
  const reasons = [], keyParts = [];
  const total = Number(ap.total_traffic || 0);
  const used = Number(ap.used_traffic || 0);
  if (total > 0 && used >= total * AIRPORT_USAGE_THRESHOLD) {
    reasons.push(`用量已达${Math.round(AIRPORT_USAGE_THRESHOLD * 100)}%`);
    keyParts.push('traffic');
  }
  if (ap.expire_at && ap.expire_at - now <= DAY_MS) {
    reasons.push(ap.expire_at < now ? '已到期' : '即将到期(≤1天)');
    keyParts.push('expire');
  }
  const fails = Number(ap.fetch_fail_count || 0);
  if (fetchFailThreshold > 0 && fails >= fetchFailThreshold) {
    reasons.push(`订阅连续拉取失败 ${fails} 次`);
    keyParts.push('fetch'); // key stays stable across further failures (no count)
  }
  return { reasons, key: keyParts.join('|') };
}

// Evaluate one user; send a user-side alert if warranted (respecting channel/type
// switches and de-dup). Returns { sent, channels } or { sent:false }.
export async function maybeSendUserAlert(userId) {
  const cfg = getNotifyConfig();
  if (!cfg.userAlerts || !(cfg.email.enabled || cfg.telegram.enabled)) return { sent: false };
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u || !u.enabled) return { sent: false };
  const reason = evalUserReason(u);
  if (!reason) {
    if (u.alert_key) db.prepare('UPDATE users SET alert_key = NULL, alert_at = NULL WHERE id = ?').run(u.id);
    return { sent: false };
  }
  const now = Date.now();
  if (!shouldSend(u, reason, now, cooldownMs())) return { sent: false };

  // the ≤1-day renewal reminder needs no airports (no reset involved)
  let airports = [];
  if (reason !== 'expiring') {
    let filter = {};
    try { filter = JSON.parse(u.node_filter || '{}'); } catch { /* noop */ }
    airports = (Array.isArray(filter.airports) && filter.airports.length
      ? filter.airports.map((id) => db.prepare('SELECT * FROM airports WHERE id = ?').get(id))
      : db.prepare('SELECT * FROM airports').all()).filter(Boolean);
  }

  const results = await notify(buildUserAlert({ ...u, __reason: reason }, airports));
  db.prepare('UPDATE users SET alert_key = ?, alert_at = ? WHERE id = ?').run(reason, now, u.id);
  return { sent: true, reason, channels: results.filter((r) => r.ok).map((r) => r.channel) };
}

// Evaluate one airport; send an airport-side alert if warranted.
export async function maybeSendAirportAlert(airportId) {
  const cfg = getNotifyConfig();
  if (!cfg.airportAlerts || !(cfg.email.enabled || cfg.telegram.enabled)) return { sent: false };
  const ap = db.prepare('SELECT * FROM airports WHERE id = ?').get(airportId);
  if (!ap) return { sent: false };
  const now = Date.now();
  const { reasons, key } = evalAirport(ap, now, { fetchFailThreshold: Number(cfg.fetchFailThreshold ?? 3) });
  if (!key) {
    if (ap.alert_key) db.prepare('UPDATE airports SET alert_key = NULL, alert_at = NULL WHERE id = ?').run(ap.id);
    return { sent: false };
  }
  if (!shouldSend(ap, key, now, cooldownMs())) return { sent: false };

  const results = await notify(buildAirportAlert(ap, reasons));
  db.prepare('UPDATE airports SET alert_key = ?, alert_at = ? WHERE id = ?').run(key, now, ap.id);
  return { sent: true, reasons, channels: results.filter((r) => r.ok).map((r) => r.channel) };
}

// Security: a user's subscription token pulled from too many distinct IPs within
// the window → likely leaked/shared. Deduped by sec_alert_at + cooldown.
const MULTI_IP_WINDOW_MS = 24 * 3600000;
export async function maybeSendUserSecurityAlert(userId) {
  const cfg = getNotifyConfig();
  const threshold = Number(cfg.multiIpThreshold ?? 3);
  if (threshold <= 0 || !(cfg.email.enabled || cfg.telegram.enabled)) return { sent: false };
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u || !u.enabled) return { sent: false };
  const now = Date.now();
  const rows = db.prepare(
    "SELECT DISTINCT ip FROM sub_logs WHERE user_id = ? AND created_at >= ? AND ip IS NOT NULL AND ip != ''"
  ).all(userId, now - MULTI_IP_WINDOW_MS);
  const ips = rows.map((r) => r.ip);
  if (ips.length < threshold) return { sent: false };
  const cd = cooldownMs();
  if (u.sec_alert_at && cd > 0 && now - u.sec_alert_at < cd) return { sent: false };

  const results = await notify(buildUserMultiIpAlert(u, ips, 24));
  db.prepare('UPDATE users SET sec_alert_at = ? WHERE id = ?').run(now, u.id);
  return { sent: true, ips: ips.length, channels: results.filter((r) => r.ok).map((r) => r.channel) };
}
