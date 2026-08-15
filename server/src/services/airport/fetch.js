import { db, getSetting } from '../../db.js';
import { proxyDispatcher, xfetch } from './proxy.js';
import { parseSubscription, parseUserInfo } from '../nodeParser.js';
import { processAirportNodes, combineExclude } from '../nodeProcess.js';
import { detectChallenge, ANTIBOT_HINT } from './antibot.js';
import { accumulateUsed } from '../util.js';
import { maybeSendAirportAlert } from '../alerts.js';

export const DEFAULT_UA = 'ClashMetaForAndroid/2.10.1.Meta';

function safeJson(s, fallback = {}) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

export async function httpGet(url, { headers = {}, proxy, method = 'GET', body, userAgent, cookie } = {}) {
  const finalHeaders = { 'User-Agent': userAgent || DEFAULT_UA, ...headers };
  if (cookie) finalHeaders.Cookie = cookie;
  const opts = { method, headers: finalHeaders, redirect: 'follow' };
  if (body) opts.body = body;
  if (proxy) opts.dispatcher = proxyDispatcher(proxy);
  const res = await xfetch(url, opts);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

// Fetch an airport's subscription, parse nodes, store, and update traffic/expiry.
export async function fetchAirport(airportId) {
  const ap = db.prepare('SELECT * FROM airports WHERE id = ?').get(airportId);
  if (!ap) throw new Error('机场不存在');
  if (!ap.sub_url) throw new Error('该机场未配置订阅链接');
  try {
    return await doFetchAirport(airportId, ap);
  } catch (err) {
    // consecutive-failure counter powers the 拉取连续失败 alert (评估在告警扫描里)
    db.prepare('UPDATE airports SET fetch_fail_count = COALESCE(fetch_fail_count, 0) + 1 WHERE id = ?').run(airportId);
    throw err;
  }
}

async function doFetchAirport(airportId, ap) {
  const headers = safeJson(ap.request_headers, {});
  const { status, headers: resHeaders, text } = await httpGet(ap.sub_url, {
    headers,
    proxy: ap.proxy || undefined,
    userAgent: ap.user_agent || undefined,
    cookie: ap.cookie || undefined,
  });

  const challenge = detectChallenge(status, text, resHeaders);
  if (challenge) throw new Error(`${challenge}。${ANTIBOT_HINT}`);
  if (status >= 400) throw new Error(`拉取失败 HTTP ${status}`);

  const rawNodes = parseSubscription(text);
  const filter = safeJson(ap.node_filter, {});
  // fold the global node-exclude regex into this airport's exclude so junk nodes
  // (traffic/expiry notices, ad links) never enter the node table.
  filter.exclude = combineExclude(getSetting('global_node_exclude', ''), filter.exclude);
  const nodes = processAirportNodes(rawNodes, filter);

  const info = parseUserInfo(resHeaders.get('subscription-userinfo'));

  // Advance the monotonic cumulative counter only when the airport reported a
  // fresh usage figure; this is what user traffic stats (B - A) are measured on,
  // and it survives airport-side billing resets. See accumulateUsed().
  let cum = null, last = null;
  if (info.used != null) {
    ({ cum, last } = accumulateUsed(ap.used_traffic_cum, ap.used_traffic_last, info.used));
  }

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
      `UPDATE airports SET last_fetch_at = ?, last_fetch_ok = ?, fetch_fail_count = 0,
       used_traffic = COALESCE(?, used_traffic),
       used_traffic_cum = COALESCE(?, used_traffic_cum), used_traffic_last = COALESCE(?, used_traffic_last),
       total_traffic = COALESCE(?, total_traffic), expire_at = COALESCE(?, expire_at), updated_at = ?
       WHERE id = ?`
    ).run(now, now, info.used ?? null, cum, last, info.total ?? null, info.expire ?? null, now, airportId);
  });
  tx();

  // event-driven: usage/expiry just changed → evaluate the airport-side alert
  // (deduped in alerts.js; non-blocking so the pull isn't delayed by notify I/O).
  Promise.resolve().then(() => maybeSendAirportAlert(airportId)).catch(() => {});

  return { count: nodes.length, traffic: info };
}
