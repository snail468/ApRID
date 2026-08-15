import { getSetting, setSetting } from '../db.js';
import { runAllAirportResets, runTrafficStats, runAlertCheck, runLatencyCheck } from './automation.js';
import { cronMatch, isValidCron, describeCron } from './cron.js';

// Lightweight in-process scheduler for the automations. Config lives in the
// settings table (survives restarts); a single 60s tick checks whether any
// automation is due and runs it. Each automation is triggered by an interactive
// Cron expression (evaluated in UTC+8, see config.js). All runs still land in the
// tasks table with full logs, exactly like a manual run.

const SCHEDULES_KEY = 'automation_schedules';

export const DEFAULT_SCHEDULES = {
  airport_reset: { enabled: false, cron: '0 4 * * *' },
  traffic_stats: { enabled: false, cron: '0 3 * * *' },
  latency: { enabled: false, cron: '0 5 * * *', airports: [], cleanup: false },
  // 告警的时间驱动条件（到期/即将到期）无事件可挂，只能定期看钟。默认每小时开启，
  // 现在也走交互式 Cron，管理员可自行改。事件驱动条件（超限/机场用量）不受此影响。
  alerts: { enabled: true, cron: '0 * * * *' },
};

const RUNNERS = {
  airport_reset: runAllAirportResets,
  traffic_stats: () => runTrafficStats({ refetch: true }),
  latency: () => runLatencyCheck(getSchedules().latency.airports, { cleanup: getSchedules().latency.cleanup }),
  alerts: () => runAlertCheck({ recordEmpty: false }),
};

// Legacy → cron migration: older installs stored {type:'daily',hour,minute} or
// {type:'interval',intervalHours}. Synthesise an equivalent cron so their config
// keeps working after the switch to Cron-only scheduling.
function legacyToCron(s, def) {
  if (s.cron && isValidCron(s.cron)) return s.cron;
  if (s.type === 'interval') {
    const n = Math.min(23, Math.max(1, Math.round(Number(s.intervalHours) || 24)));
    return n >= 24 ? '0 0 * * *' : `0 */${n} * * *`;
  }
  if (s.type === 'daily' && s.hour != null) {
    const h = Math.min(23, Math.max(0, Math.round(Number(s.hour) || 0)));
    const m = Math.min(59, Math.max(0, Math.round(Number(s.minute) || 0)));
    return `${m} ${h} * * *`;
  }
  return def.cron;
}

// Merge stored config over defaults and normalise fields.
export function getSchedules() {
  let stored = {};
  try { stored = JSON.parse(getSetting(SCHEDULES_KEY, '{}')) || {}; } catch { stored = {}; }
  const out = {};
  for (const [key, def] of Object.entries(DEFAULT_SCHEDULES)) {
    const s = stored[key] || {};
    const cron = legacyToCron(s, def);
    out[key] = {
      // fall back to the default's enabled state only when nothing is stored yet
      enabled: s.enabled != null ? !!s.enabled : !!def.enabled,
      cron,
      lastRun: Number(getSetting(`schedule_last_${key}`, 0)) || 0,
    };
    if ('airports' in def) out[key].airports = Array.isArray(s.airports) ? s.airports : def.airports;
    if ('cleanup' in def) out[key].cleanup = s.cleanup != null ? !!s.cleanup : !!def.cleanup;
  }
  return out;
}

export function setSchedules(input = {}) {
  const cur = getSchedules();
  const merged = {};
  for (const [key, def] of Object.entries(DEFAULT_SCHEDULES)) {
    const s = { ...cur[key], ...(input[key] || {}) };
    const cron = isValidCron(s.cron) ? s.cron.trim() : def.cron;
    merged[key] = { enabled: !!s.enabled, cron };
    if ('airports' in def) {
      merged[key].airports = Array.isArray(s.airports) ? s.airports.map(Number).filter((n) => !Number.isNaN(n)) : [];
    }
    if ('cleanup' in def) merged[key].cleanup = !!s.cleanup;
  }
  setSetting(SCHEDULES_KEY, JSON.stringify(merged));
  return getSchedules();
}

// Human-readable summary of a schedule config, shown on the panel.
export function describeSchedule(s) {
  if (!s || !s.enabled) return '未开启定时任务';
  return describeCron(s.cron);
}

function isDue(s, now) {
  if (!s.enabled || !s.cron) return false;
  const d = new Date(now);
  if (!cronMatch(s.cron, d)) return false;
  // cron granularity is 1 minute; don't fire twice within the same minute
  return Math.floor((s.lastRun || 0) / 60000) !== Math.floor(now / 60000);
}

const running = new Set();

async function tick() {
  const now = Date.now();
  const schedules = getSchedules();
  for (const [key, s] of Object.entries(schedules)) {
    if (running.has(key) || !isDue(s, now)) continue;
    const runner = RUNNERS[key];
    if (!runner) continue;
    running.add(key);
    // mark lastRun up front so a long run doesn't re-trigger on the next tick
    setSetting(`schedule_last_${key}`, String(now));
    console.log(`[scheduler] 定时触发自动化：${key}`);
    Promise.resolve()
      .then(runner)
      .catch((err) => console.error(`[scheduler] ${key} 运行失败:`, err.message))
      .finally(() => running.delete(key));
  }
}

let timer = null;
export function startScheduler() {
  if (timer) return;
  timer = setInterval(() => { tick().catch(() => {}); }, 60 * 1000);
  if (timer.unref) timer.unref();
  console.log('[init] 自动化定时调度器已启动（每分钟检查一次）');
}
