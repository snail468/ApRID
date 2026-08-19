// Node post-processing used both when importing airport nodes and when
// assembling a user's subscription.
//
// filter shape (stored as JSON on airport / user):
// {
//   include: "关键词1|关键词2",   // regex, keep only names matching
//   exclude: "过期|剩余|官网",     // regex, drop names matching
//   protocols: ["vmess","trojan"],// keep only these types (empty = all)
//   prefix: "🇭🇰香港",            // add prefix to every node name
//   rename: [ {from:"HK", to:"香港"} ], // sequential name replacements
//   maxLatency: 200,              // ms; drop nodes slower than this. 0 = only
//                                 // drop timed-out nodes; undefined = no limit.
// }

// Default "全局节点正则排除" template — common junk/ad node names that机场 stuff
// into subscriptions (traffic/expiry notices, official-site links, invites…).
// Deliberately conservative: only clear-cut ad/notice words, to avoid dropping
// real nodes. Admins can edit it in 设置 · 全局节点排除.
export const DEFAULT_GLOBAL_EXCLUDE = [
  '官网', '官方', '流量', '剩余', '到期', '过期', '重置', '续费', '购买', '下单',
  '优惠', '折扣', '邀请', '试用', '群', '频道', '电报', 'telegram', 't\\.me',
  '网址', '域名', '客服', '工单', '公告', '通知', '升级', '备用', '发布页',
  '防失联', '失联', '永久', '无限', '限时', 'expire', 'traffic', 'reset', 'balance',
].join('|');

// OR-combine several regex source strings into one (each wrapped so alternations
// inside a part don't leak). Empty/falsy parts are skipped.
export function combineExclude(...exprs) {
  const parts = exprs.filter(Boolean).map((s) => `(?:${s})`);
  return parts.length ? parts.join('|') : '';
}

function toRegExp(pattern) {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

export function filterNodes(nodes, filter = {}) {
  const inc = toRegExp(filter.include);
  const exc = toRegExp(filter.exclude);
  const protos = Array.isArray(filter.protocols) ? filter.protocols.filter(Boolean) : [];
  const exProtos = Array.isArray(filter.excludeProtocols) ? filter.excludeProtocols.filter(Boolean) : [];
  // latency ceiling: undefined/'' = off; 0 = drop only timed-out nodes;
  // >0 = drop timed-out nodes and any measured latency above the ceiling.
  const hasMax = filter.maxLatency !== undefined && filter.maxLatency !== null && filter.maxLatency !== '';
  const maxLat = hasMax ? Number(filter.maxLatency) : null;
  return nodes.filter((n) => {
    if (protos.length && !protos.includes(n.type)) return false;
    if (exProtos.length && exProtos.includes(n.type)) return false;
    if (inc && !inc.test(n.name)) return false;
    if (exc && exc.test(n.name)) return false;
    if (hasMax && !Number.isNaN(maxLat)) {
      const lat = n.latency;
      // untested nodes (null/undefined) are kept — we can't judge them
      if (lat != null) {
        if (lat < 0) return false;              // timed out → always dropped
        if (maxLat > 0 && lat > maxLat) return false; // over the ceiling
      }
    }
    return true;
  });
}

// Like filterNodes, but instead of just returning survivors it explains the
// verdict for every node: kept vs dropped-with-reason. Powers the live rule
// preview in the editor. Reason codes: proto | exproto | include | exclude |
// timeout | latency. Checks run in the SAME order as filterNodes so the preview
// matches real delivery exactly (first failing rule wins).
export function previewFilter(nodes, filter = {}) {
  const inc = toRegExp(filter.include);
  const exc = toRegExp(filter.exclude);
  const protos = Array.isArray(filter.protocols) ? filter.protocols.filter(Boolean) : [];
  const exProtos = Array.isArray(filter.excludeProtocols) ? filter.excludeProtocols.filter(Boolean) : [];
  const hasMax = filter.maxLatency !== undefined && filter.maxLatency !== null && filter.maxLatency !== '';
  const maxLat = hasMax ? Number(filter.maxLatency) : null;
  const kept = [];
  const dropped = [];
  for (const n of nodes) {
    let reason = null;
    if (protos.length && !protos.includes(n.type)) reason = 'proto';
    else if (exProtos.length && exProtos.includes(n.type)) reason = 'exproto';
    else if (inc && !inc.test(n.name)) reason = 'include';
    else if (exc && exc.test(n.name)) reason = 'exclude';
    else if (hasMax && !Number.isNaN(maxLat) && n.latency != null) {
      if (n.latency < 0) reason = 'timeout';
      else if (maxLat > 0 && n.latency > maxLat) reason = 'latency';
    }
    const entry = { name: n.name, type: n.type, latency: n.latency ?? null };
    if (reason) dropped.push({ ...entry, reason });
    else kept.push(entry);
  }
  return { kept, dropped };
}

export function renameNodes(nodes, filter = {}) {
  const rules = Array.isArray(filter.rename) ? filter.rename : [];
  const prefix = filter.prefix || '';
  return nodes.map((n) => {
    let name = n.name;
    for (const r of rules) {
      if (!r.from) continue;
      try {
        name = name.replace(new RegExp(r.from, 'g'), r.to ?? '');
      } catch {
        name = name.split(r.from).join(r.to ?? '');
      }
    }
    if (prefix) name = `${prefix}${name}`;
    return { ...n, name };
  });
}

// ensure names are unique within one airport by numbering duplicates:
// "香港", "香港", "香港" -> "香港", "香港 2", "香港 3"
export function dedupWithinGroup(nodes) {
  const seen = new Map();
  return nodes.map((n) => {
    const c = (seen.get(n.name) || 0) + 1;
    seen.set(n.name, c);
    return c === 1 ? n : { ...n, name: `${n.name} ${c}` };
  });
}

// unique prefixing across airports so two airports' "香港" don't collide.
// prefixMap: { airportId: "A-" }
export function applyGlobalPrefix(nodes, prefix) {
  if (!prefix) return nodes;
  return nodes.map((n) => ({ ...n, name: `${prefix}${n.name}` }));
}

// ---- physical-endpoint identity + deduped latency planning ----
// Latency (TCP-handshake RTT) is a property of the physical endpoint server:port,
// independent of which airport/account imported the node or which protocol it
// speaks. So every latency lookup keys on this. Exact match (same as the rest of
// the codebase) — duplicate nodes from the same source carry identical strings.
export function endpointKey(server, port) {
  return `${server}:${port}`;
}

// Plan a deduped latency sweep: group node rows by physical endpoint so each
// endpoint is measured at most once. When freshMs > 0, an endpoint whose newest
// existing reading is within the window is reused instead of re-measured. Pure —
// the caller does the actual pinging + DB writes.
// rows: [{ id, server, port, latency, latency_at }]
export function planLatencyChecks(rows, { now = Date.now(), freshMs = 0 } = {}) {
  const groups = new Map(); // key -> { server, port, ids:[], lastAt, lastLatency }
  for (const r of rows) {
    const key = endpointKey(r.server, r.port);
    let g = groups.get(key);
    if (!g) { g = { server: r.server, port: r.port, ids: [], lastAt: null, lastLatency: null }; groups.set(key, g); }
    g.ids.push(r.id);
    if (r.latency_at != null && r.latency != null && (g.lastAt == null || r.latency_at > g.lastAt)) {
      g.lastAt = r.latency_at; g.lastLatency = r.latency;
    }
  }
  const toMeasure = []; // [{ key, server, port }] — endpoints to actually ping
  const reused = [];    // [{ key, latency }] — endpoints reused from a fresh reading
  for (const [key, g] of groups) {
    if (freshMs > 0 && g.lastAt != null && g.lastLatency != null && (now - g.lastAt) <= freshMs) {
      reused.push({ key, latency: g.lastLatency });
    } else {
      toMeasure.push({ key, server: g.server, port: g.port });
    }
  }
  return { groups, toMeasure, reused };
}

// Collapse nodes that hit the same physical endpoint (server:port) to a single
// entry. Several airport accounts often import the same upstream servers, so a
// user's subscription would otherwise carry many identical lines. Keeps the first
// occurrence — delivery dedups after the good-nodes-first sort, and all duplicates
// of one endpoint share the same health, so the survivor is a best-ranked copy.
export function dedupByEndpoint(nodes) {
  const seen = new Set();
  const out = [];
  for (const n of nodes) {
    const k = endpointKey(n.server, n.port);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

// ---- health-based ordering (pure; stats come from nodeHealth.getNodeStatsMap) ----
// Sortable score, higher = healthier. Falls back to the node's live `latency`
// when there is no history. Buckets so order is: alive-fast > alive-slow >
// untested (neutral 0) > timed-out/dead. Untested nodes all score 0 so a stable
// sort keeps their original relative order.
export function nodeHealthScore(node, statsMap) {
  const s = statsMap.get(`${node.server}:${node.port}`);
  let uptime = null;
  let lat = null;
  if (s && s.total > 0) {
    uptime = s.ok / s.total;
    lat = s.ok > 0 ? s.avgLatency : -1;
  } else if (node.latency != null) {
    lat = node.latency;                       // live reading fallback
    uptime = node.latency >= 0 ? null : 0;    // live timeout → treat as dead
  }
  if (uptime == null && lat == null) return 0;                 // no info → neutral
  const dead = (uptime != null && uptime === 0) || lat == null || lat < 0;
  if (dead) return -1000 + (uptime != null ? uptime * 100 : 0);
  const up = uptime != null ? uptime : 0.8;   // alive but no uptime history → decent
  const latMs = Math.min(lat, 2000);
  return up * 1000 - latMs / 4;               // uptime dominates, latency is the tiebreak
}

// Stable "good nodes first" ordering given a precomputed stats map.
export function orderByHealth(nodes, statsMap) {
  return [...nodes].sort((a, b) => nodeHealthScore(b, statsMap) - nodeHealthScore(a, statsMap));
}

// full pipeline for a single airport's nodes
export function processAirportNodes(nodes, filter = {}) {
  let out = filterNodes(nodes, filter);
  out = renameNodes(out, filter);
  out = dedupWithinGroup(out);
  return out;
}
