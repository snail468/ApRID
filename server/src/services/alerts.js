import { db } from '../db.js';
import { userStatus } from './subscription/build.js';
import { notify, buildUserAlert, buildAirportAlert, getNotifyConfig } from './notify.js';

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

// user condition -> dedup key ('expired' | 'exhausted' | null)
export function evalUserReason(u) {
  const s = userStatus(u);
  return s === 'expired' ? 'expired' : s === 'exhausted' ? 'exhausted' : null;
}

// airport condition -> { reasons:[], key:'traffic|expire' } (key '' = no alert)
export function evalAirport(ap, now = Date.now()) {
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

  let filter = {};
  try { filter = JSON.parse(u.node_filter || '{}'); } catch { /* noop */ }
  const airports = (Array.isArray(filter.airports) && filter.airports.length
    ? filter.airports.map((id) => db.prepare('SELECT * FROM airports WHERE id = ?').get(id))
    : db.prepare('SELECT * FROM airports').all()).filter(Boolean);

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
  const { reasons, key } = evalAirport(ap, now);
  if (!key) {
    if (ap.alert_key) db.prepare('UPDATE airports SET alert_key = NULL, alert_at = NULL WHERE id = ?').run(ap.id);
    return { sent: false };
  }
  if (!shouldSend(ap, key, now, cooldownMs())) return { sent: false };

  const results = await notify(buildAirportAlert(ap, reasons));
  db.prepare('UPDATE airports SET alert_key = ?, alert_at = ? WHERE id = ?').run(key, now, ap.id);
  return { sent: true, reasons, channels: results.filter((r) => r.ok).map((r) => r.channel) };
}
