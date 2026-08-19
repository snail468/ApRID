// shared byte formatter (server-side, mirrors the web fmtBytes)
export function fmtBytes(b) {
  if (b == null) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = Number(b);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

// Whether a user's monthly traffic reset is due today. `resetDay` is the chosen
// day-of-month (1–31, falsy = off); on shorter months it clamps to the last day
// (so 31 fires on Feb 28/29, Apr 30, …). Guards against resetting twice in one
// day via `lastResetDate`. Operates on the passed Date objects' local fields —
// the server runs in Asia/Shanghai (see config.js), so these are UTC+8 wall-clock.
export function shouldResetToday(resetDay, nowDate, lastResetDate = null) {
  const day = Number(resetDay);
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;
  const y = nowDate.getFullYear(), m = nowDate.getMonth(), d = nowDate.getDate();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const effective = Math.min(day, daysInMonth);
  if (d !== effective) return false;
  if (lastResetDate &&
      lastResetDate.getFullYear() === y &&
      lastResetDate.getMonth() === m &&
      lastResetDate.getDate() === d) return false; // already reset today
  return true;
}

// Advance an airport's monotonic cumulative used-traffic counter given a fresh
// raw reading. Airports periodically reset their reported usage (billing-cycle
// reset), which makes the raw number *drop*; a naive `current - baseline` would
// then lose everything accumulated before the reset. We instead keep a counter
// that only ever grows:
//   - first reading            -> counter starts at the raw value
//   - reading >= last reading  -> add the increment (normal growth)
//   - reading <  last reading  -> airport reset; the new reading is fresh usage
//                                 since the reset, so add it whole
// Returns the next { cum, last } to persist. All inputs may be null/undefined.
export function accumulateUsed(prevCum, prevLast, raw) {
  const r = Number(raw);
  // no usable reading (null/''/NaN) -> leave the counter untouched
  if (raw == null || raw === '' || !Number.isFinite(r)) {
    return { cum: Number(prevCum) || 0, last: prevLast == null ? null : Number(prevLast) };
  }
  if (prevLast == null) {
    // establish the baseline; keep any pre-seeded cum (upgrade migration)
    return { cum: prevCum == null ? r : Number(prevCum), last: r };
  }
  const last = Number(prevLast);
  const cum = Number(prevCum) || 0;
  const delta = r < last ? r : r - last; // reset detected when reading drops
  return { cum: cum + delta, last: r };
}
