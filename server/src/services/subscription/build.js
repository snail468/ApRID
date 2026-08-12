import { db } from '../../db.js';
import { FORMATS } from './converters.js';
import { filterNodes, renameNodes, dedupWithinGroup, applyGlobalPrefix } from '../nodeProcess.js';

// A synthetic single-node subscription used for expired / reset states.
// Uses a harmless unreachable trojan node whose *name* carries the message.
function noticeNode(message) {
  return [{
    name: message,
    type: 'trojan',
    server: '127.0.0.1',
    port: 1,
    raw: { password: 'notice', sni: 'notice' },
  }];
}

// true when a per-user traffic cap is configured and has been reached
export function trafficExhausted(user) {
  const limit = Number(user.traffic_limit || 0);
  const used = Number(user.traffic_used || 0);
  return limit > 0 && used >= limit;
}

export function userStatus(user) {
  if (!user.enabled) return 'disabled';
  if (user.expire_at && user.expire_at < Date.now()) return 'expired';
  if (trafficExhausted(user)) return 'exhausted';
  const days = user.expire_at ? (user.expire_at - Date.now()) / 86400000 : Infinity;
  if (days <= 3) return 'expiring';
  return 'active';
}

// gather the normalized nodes a user should receive
export function collectUserNodes(user) {
  const filter = safeJson(user.node_filter);
  // which airports: filter.airports = [ids] or empty = all
  const airportIds = Array.isArray(filter.airports) ? filter.airports : null;

  let airports = db.prepare('SELECT * FROM airports').all();
  if (airportIds && airportIds.length) {
    airports = airports.filter((a) => airportIds.includes(a.id));
  }

  const collected = [];
  for (const ap of airports) {
    let nodes = db.prepare('SELECT * FROM nodes WHERE airport_id = ?').all(ap.id)
      .map((row) => ({ name: row.name, type: row.type, server: row.server, port: row.port, raw: safeJson(row.raw), latency: row.latency }));

    // per-airport processing already applied at import time is stored in nodes,
    // but apply cross-airport unique prefix here if configured on the airport
    const apFilter = safeJson(ap.node_filter);
    if (apFilter.globalPrefix) nodes = applyGlobalPrefix(nodes, apFilter.globalPrefix);
    collected.push(...nodes);
  }

  // user-level filtering / renaming
  let out = filterNodes(collected, filter);
  out = renameNodes(out, filter);
  out = dedupWithinGroup(out);
  return out;
}

export function buildSubscription(user, format) {
  const fmt = FORMATS[format] || FORMATS.base64;
  const status = userStatus(user);

  let nodes;
  if (status === 'disabled') {
    nodes = noticeNode('订阅已停用');
  } else if (status === 'expired') {
    nodes = noticeNode('已到期，请续费');
  } else if (status === 'exhausted') {
    nodes = noticeNode('流量已用完，请续费');
  } else {
    nodes = collectUserNodes(user);
    if (!nodes.length) nodes = noticeNode('暂无可用节点');
  }

  // template lookup
  let templateContent = null;
  if (user.template_id) {
    const t = db.prepare('SELECT content FROM templates WHERE id = ?').get(user.template_id);
    templateContent = t?.content || null;
  }
  if (!templateContent) {
    const def = db.prepare('SELECT content FROM templates WHERE client_type = ? AND is_default = 1').get(format);
    templateContent = def?.content || null;
  }

  const body = fmt.build(nodes, templateContent);
  return { body, contentType: fmt.contentType, nodeCount: nodes.length, status };
}

// subscription served when the token no longer matches (post-reset old link)
export function buildResetNotice(format) {
  const fmt = FORMATS[format] || FORMATS.base64;
  const nodes = noticeNode('不可获取订阅');
  return { body: fmt.build(nodes, null), contentType: fmt.contentType };
}

function safeJson(s) {
  if (!s) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return {}; }
}
