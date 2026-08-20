// Pure helpers for the availability probe (no DB import) so they can be
// unit-tested standalone. Used by probe.js.
import { nodeToSingbox } from './subscription/converters.js';

// Stable identity for dedup: two nodes are "the same" only when every connection
// param matches (so different-credential nodes on one endpoint are tested apart).
export function nodeSignature(n) {
  const raw = n.raw && typeof n.raw === 'object'
    ? n.raw
    : (() => { try { return JSON.parse(n.raw || '{}'); } catch { return {}; } })();
  const keys = Object.keys(raw).sort();
  const canon = keys.map((k) => `${k}=${raw[k]}`).join('&');
  return `${n.type}|${n.server}|${n.port}|${canon}`;
}

// Build a minimal sing-box config that exposes the given nodes as outbounds plus
// the clash API, so we can query each outbound's real delay. items: [{tag, node}].
export function buildProbeConfig(items, clashPort) {
  const outbounds = [];
  for (const { tag, node } of items) {
    const ob = nodeToSingbox({ ...node, name: tag });
    if (ob) { ob.tag = tag; outbounds.push(ob); }
  }
  outbounds.push({ type: 'direct', tag: 'direct' });
  return {
    log: { level: 'error', timestamp: false },
    outbounds,
    route: { final: 'direct' },
    experimental: { clash_api: { external_controller: `127.0.0.1:${clashPort}` } },
  };
}

// Pull every outbound type the installed sing-box rejected out of its
// check/run stderr, e.g. "outbounds[106]: unknown outbound type: anytls" -> ['anytls'].
// Lets the probe drop protocols this sing-box build can't parse (e.g. anytls on
// a <1.12 core) instead of the single bad outbound failing the whole config.
export function parseUnknownOutboundTypes(stderr = '') {
  const set = new Set();
  const re = /unknown outbound type:\s*([a-z0-9_-]+)/gi;
  let m;
  while ((m = re.exec(stderr))) set.add(m[1].toLowerCase());
  return [...set];
}

// Interpret a clash-API /delay response. 200 with a numeric delay = reachable
// through the proxy; anything else (timeout, connect error) = dead.
export function parseDelayResult(status, body) {
  if (status === 200 && body && typeof body.delay === 'number') {
    return { ok: true, ms: Math.round(body.delay) };
  }
  return { ok: false, ms: -1, error: (body && body.message) || `HTTP ${status}` };
}
