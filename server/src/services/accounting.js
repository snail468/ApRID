import { db } from '../db.js';

// 成本/收益记账 for airports. Two billing types:
//   - time    : 时长套餐, 月成本 = 当前套餐 amount/days*30 + 近30天一次性加油(topup)
//   - traffic : 流量套餐, 单价 = Σ(traffic金额)/Σ(traffic GB); 月成本 = 近30天消耗 × 单价
// Consumption comes from the monotonic traffic_snapshots (survives airport resets).

const DAY = 86400000;
const GB = 1024 ** 3;

// bytes consumed in the trailing 30 days (from daily snapshots). Falls back to a
// normalized rate when less than 30 days of history is available.
export function trailing30dConsumption(airportId, now = Date.now()) {
  const latest = db.prepare('SELECT cum, ts FROM traffic_snapshots WHERE airport_id = ? ORDER BY ts DESC LIMIT 1').get(airportId);
  if (!latest) return 0;
  const curCum = Number(latest.cum) || 0;
  const past = db.prepare('SELECT cum FROM traffic_snapshots WHERE airport_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1').get(airportId, now - 30 * DAY);
  if (past) return Math.max(0, curCum - Number(past.cum));
  const earliest = db.prepare('SELECT cum, ts FROM traffic_snapshots WHERE airport_id = ? ORDER BY ts ASC LIMIT 1').get(airportId);
  if (!earliest) return 0;
  const elapsedDays = Math.max(1, (Number(latest.ts) - Number(earliest.ts)) / DAY);
  const consumed = Math.max(0, curCum - Number(earliest.cum));
  return (consumed / elapsedDays) * 30; // extrapolate to a 30-day figure
}

// blended unit price 元/GB across all 流量套餐 purchases (incl. resets/买量).
export function airportUnitPrice(airportId) {
  const r = db.prepare("SELECT COALESCE(SUM(amount),0) amt, COALESCE(SUM(traffic_gb),0) gb FROM airport_costs WHERE airport_id = ? AND kind = 'traffic'").get(airportId);
  return r.gb > 0 ? r.amt / r.gb : 0;
}

// normalized 每月成本 (元) for one airport.
export function airportMonthlyCost(airportId, now = Date.now()) {
  const ap = db.prepare('SELECT cost_type FROM airports WHERE id = ?').get(airportId);
  const type = ap?.cost_type || 'time';
  if (type === 'traffic') {
    const gb = trailing30dConsumption(airportId, now) / GB;
    return round2(airportUnitPrice(airportId) * gb);
  }
  const t = db.prepare("SELECT amount, days FROM airport_costs WHERE airport_id = ? AND kind = 'time' ORDER BY id DESC LIMIT 1").get(airportId);
  const base = t && t.days ? (Number(t.amount) || 0) / Number(t.days) * 30 : 0;
  const topups = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM airport_costs WHERE airport_id = ? AND kind = 'topup' AND created_at >= ?").get(airportId, now - 30 * DAY).s;
  return round2(base + (Number(topups) || 0));
}

// full trend/accounting payload for one airport (chart + KPIs).
export function airportTrend(airportId, now = Date.now()) {
  const ap = db.prepare('SELECT cost_type, used_traffic, total_traffic FROM airports WHERE id = ?').get(airportId) || {};
  const snapshots = db.prepare('SELECT cum, used, total, ts FROM traffic_snapshots WHERE airport_id = ? ORDER BY ts ASC').all(airportId);
  const consumption30d = trailing30dConsumption(airportId, now);
  const unitPrice = airportUnitPrice(airportId);
  const monthlyCost = airportMonthlyCost(airportId, now);
  // remaining traffic (for 流量套餐) uses the airport's own reported used/total
  const remaining = (Number(ap.total_traffic) || 0) - (Number(ap.used_traffic) || 0);
  const dailyRate = consumption30d / 30; // bytes/day
  const daysLeft = dailyRate > 0 && remaining > 0 ? Math.floor(remaining / dailyRate) : null;
  return {
    costType: ap.cost_type || 'time',
    snapshots,
    consumption30d,          // bytes
    unitPrice,               // 元/GB
    monthlyCost,             // 元/月
    remaining,               // bytes (may be 0 if airport doesn't report total)
    daysLeft,                // 预计可用天数 at current rate
  };
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
