import { ProxyAgent } from 'undici';
import { db } from '../../db.js';
import { parseSubscription, parseUserInfo } from '../nodeParser.js';
import { processAirportNodes } from '../nodeProcess.js';

function safeJson(s, fallback = {}) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

export async function httpGet(url, { headers = {}, proxy, method = 'GET', body } = {}) {
  const opts = {
    method,
    headers: { 'User-Agent': 'ClashMetaForAndroid/2.10.1', ...headers },
    redirect: 'follow',
  };
  if (body) opts.body = body;
  if (proxy) opts.dispatcher = new ProxyAgent(proxy);
  const res = await fetch(url, opts);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

// Fetch an airport's subscription, parse nodes, store, and update traffic/expiry.
export async function fetchAirport(airportId) {
  const ap = db.prepare('SELECT * FROM airports WHERE id = ?').get(airportId);
  if (!ap) throw new Error('机场不存在');
  if (!ap.sub_url) throw new Error('该机场未配置订阅链接');

  const headers = safeJson(ap.request_headers, {});
  const { status, headers: resHeaders, text } = await httpGet(ap.sub_url, {
    headers,
    proxy: ap.proxy || undefined,
  });
  if (status >= 400) throw new Error(`拉取失败 HTTP ${status}`);

  const rawNodes = parseSubscription(text);
  const filter = safeJson(ap.node_filter, {});
  const nodes = processAirportNodes(rawNodes, filter);

  const info = parseUserInfo(resHeaders.get('subscription-userinfo'));

  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM nodes WHERE airport_id = ?').run(airportId);
    const ins = db.prepare(
      'INSERT INTO nodes (airport_id, name, type, server, port, raw, uri, group_name, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    );
    for (const n of nodes) {
      ins.run(airportId, n.name, n.type, n.server, n.port, JSON.stringify(n.raw || {}), n.uri || '', ap.group_name || '', now);
    }
    db.prepare(
      `UPDATE airports SET last_fetch_at = ?, used_traffic = COALESCE(?, used_traffic),
       total_traffic = COALESCE(?, total_traffic), expire_at = COALESCE(?, expire_at), updated_at = ?
       WHERE id = ?`
    ).run(now, info.used ?? null, info.total ?? null, info.expire ?? null, now, airportId);
  });
  tx();

  return { count: nodes.length, traffic: info };
}
