// shared byte formatter (server-side, mirrors the web fmtBytes)
export function fmtBytes(b) {
  if (b == null) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = Number(b);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
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
