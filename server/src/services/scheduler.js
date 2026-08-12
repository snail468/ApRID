import { getSetting, setSetting } from '../db.js';
import { runAllAirportResets, runTrafficStats } from './automation.js';

// Lightweight in-process scheduler for the automations. Config lives in the
// settings table (survives restarts); a single 60s tick checks whether any
// automation is due and runs it. Two trigger modes per automation:
//   - daily:    run once a day at HH:MM (local time)
//   - interval: run every N hours since the last run
//
// This is the "定时任务" the Automation page configures. All runs still land in
// the tasks table with full logs, exactly like a manual run.

const SCHEDULES_KEY = 'automation_schedules';

export const DEFAULT_SCHEDULES = {
  airport_reset: { enabled: false, type: 'daily', hour: 4, minute: 0, intervalHours: 24 },
  traffic_stats: { enabled: false, type: 'daily', hour: 3, minute: 0, intervalHours: 6 },
};

const RUNNERS = {
  airport_reset: runAllAirportResets,
  traffic_stats: () => runTrafficStats({ refetch: true }),
};

function clampInt(v, min, max, dflt) {
  const n = Math.round(Number(v));
  if (Number.isNaN(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

// Merge stored config over defaults and normalise fields.
export function getSchedules() {
  let stored = {};
  try { stored = JSON.parse(getSetting(SCHEDULES_KEY, '{}')) || {}; } catch { stored = {}; }
  const out = {};
  for (const [key, def] of Object.entries(DEFAULT_SCHEDULES)) {
    const s = stored[key] || {};
    out[key] = {
      enabled: !!s.enabled,
      type: s.type === 'interval' ? 'interval' : 'daily',
      hour: clampInt(s.hour, 0, 23, def.hour),
      minute: clampInt(s.minute, 0, 59, def.minute),
      intervalHours: clampInt(s.intervalHours, 1, 168, def.intervalHours),
      lastRun: Number(getSetting(`schedule_last_${key}`, 0)) || 0,
    };
  }
  return out;
}

export function setSchedules(input = {}) {
  const cur = getSchedules();
  const merged = {};
  for (const key of Object.keys(DEFAULT_SCHEDULES)) {
    const s = { ...cur[key], ...(input[key] || {}) };
    merged[key] = {
      enabled: !!s.enabled,
      type: s.type === 'interval' ? 'interval' : 'daily',
      hour: clampInt(s.hour, 0, 23, DEFAULT_SCHEDULES[key].hour),
      minute: clampInt(s.minute, 0, 59, DEFAULT_SCHEDULES[key].minute),
      intervalHours: clampInt(s.intervalHours, 1, 168, DEFAULT_SCHEDULES[key].intervalHours),
    };
  }
  setSetting(SCHEDULES_KEY, JSON.stringify(merged));
  return getSchedules();
}

// Human-readable summary of a schedule config, shown on the panel.
export function describeSchedule(s) {
  if (!s || !s.enabled) return '未开启定时任务';
  if (s.type === 'interval') return `每 ${s.intervalHours} 小时自动运行一次`;
  return `每天 ${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')} 自动运行`;
}

function isDue(s, now) {
  if (!s.enabled) return false;
  if (s.type === 'interval') {
    return now - (s.lastRun || 0) >= s.intervalHours * 3600000;
  }
  // daily: match HH:MM in local time, and don't run twice in the same local day
  const d = new Date(now);
  if (d.getHours() !== s.hour || d.getMinutes() !== s.minute) return false;
  if (!s.lastRun) return true;
  const last = new Date(s.lastRun);
  return last.toDateString() !== d.toDateString();
}

const running = new Set();

async function tick() {
  const schedules = getSchedules();
  const now = Date.now();
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
