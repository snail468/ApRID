// Minimal 5-field cron (min hour day-of-month month day-of-week) — enough to back
// the interactive Cron builder on the 自动化 page. Supports `*`, `*/n`, `a-b`,
// `a-b/n` and comma lists. Evaluated against a Date whose local fields are already
// UTC+8 (process.env.TZ = Asia/Shanghai, see config.js), so "每天 03:00" means
// 03:00 北京时间.

function parseField(field, min, max) {
  const set = new Set();
  for (const part of String(field).split(',')) {
    if (!part) return null;
    const [range, stepStr] = part.split('/');
    const step = stepStr === undefined ? 1 : parseInt(stepStr, 10);
    if (!Number.isInteger(step) || step < 1) return null;
    let lo, hi;
    if (range === '*') { lo = min; hi = max; }
    else if (range.includes('-')) {
      const [a, b] = range.split('-').map((x) => parseInt(x, 10));
      lo = a; hi = b;
    } else {
      lo = hi = parseInt(range, 10);
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi) return null;
    for (let i = lo; i <= hi; i += step) {
      if (i < min || i > max) return null;
      set.add(i);
    }
  }
  return set.size ? set : null;
}

// Parse into matcher sets, or null when the expression is invalid.
export function parseCron(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const min = parseField(parts[0], 0, 59);
  const hour = parseField(parts[1], 0, 23);
  const dom = parseField(parts[2], 1, 31);
  const month = parseField(parts[3], 1, 12);
  const dow = parseField(parts[4], 0, 7); // allow 7 as Sunday
  if (!min || !hour || !dom || !month || !dow) return null;
  if (dow.has(7)) dow.add(0);
  return {
    min, hour, dom, month, dow,
    domRestricted: parts[2] !== '*',
    dowRestricted: parts[4] !== '*',
  };
}

export function isValidCron(expr) {
  return !!parseCron(expr);
}

// Does `date` (in UTC+8 wall clock) match the cron expression?
export function cronMatch(expr, date = new Date()) {
  const c = parseCron(expr);
  if (!c) return false;
  if (!c.min.has(date.getMinutes())) return false;
  if (!c.hour.has(date.getHours())) return false;
  if (!c.month.has(date.getMonth() + 1)) return false;
  const domOk = c.dom.has(date.getDate());
  const dowOk = c.dow.has(date.getDay());
  // classic cron: when both day-of-month and day-of-week are restricted, either
  // one matching is enough; otherwise only the restricted field(s) apply.
  if (c.domRestricted && c.dowRestricted) return domOk || dowOk;
  if (c.domRestricted) return domOk;
  if (c.dowRestricted) return dowOk;
  return true;
}

// Human-readable Chinese description for the common builder patterns; falls back
// to echoing the raw expression for anything hand-written and unusual.
export function describeCron(expr) {
  if (!isValidCron(expr)) return '无效的 Cron 表达式';
  const [mi, h, dom, mon, dow] = String(expr).trim().split(/\s+/);
  const pad = (n) => String(n).padStart(2, '0');
  const num = (s) => /^\d+$/.test(s);
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  if (expr.trim() === '* * * * *') return '每分钟';
  if (h === '*' && dom === '*' && mon === '*' && dow === '*' && num(mi)) return `每小时第 ${Number(mi)} 分`;
  if (dom === '*' && mon === '*' && dow === '*' && num(mi) && /^\*\/\d+$/.test(h)) return `每 ${h.slice(2)} 小时（第 ${Number(mi)} 分）`;
  if (dom === '*' && mon === '*' && dow === '*' && num(mi) && num(h)) return `每天 ${pad(h)}:${pad(mi)}`;
  if (dom === '*' && mon === '*' && num(mi) && num(h) && num(dow)) return `每周${week[Number(dow) % 7]} ${pad(h)}:${pad(mi)}`;
  if (mon === '*' && dow === '*' && num(mi) && num(h) && num(dom)) return `每月 ${Number(dom)} 日 ${pad(h)}:${pad(mi)}`;
  return `Cron：${expr}`;
}
