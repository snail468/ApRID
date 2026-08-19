// Self-contained logic tests (no DB / no network) — run in CI via `npm test`.
import { parseSubscription, parseUri, parseUserInfo } from '../src/services/nodeParser.js';
import { processAirportNodes, filterNodes, nodeHealthScore, orderByHealth, previewFilter, planLatencyChecks, endpointKey, dedupByEndpoint } from '../src/services/nodeProcess.js';
import { toBase64, toClash, toSingbox, toSurge, toQuanX, toLoon, detectFormat } from '../src/services/subscription/converters.js';
import { DEFAULT_TEMPLATES } from '../src/services/subscription/defaultTemplates.js';
import { accumulateUsed, shouldResetToday } from '../src/services/util.js';
import { signAction, verifyAction } from '../src/services/actionToken.js';
import { cronMatch, isValidCron, describeCron } from '../src/services/cron.js';
import { combineExclude, DEFAULT_GLOBAL_EXCLUDE } from '../src/services/nodeProcess.js';
import { describeAction, sanitizeBody } from '../src/services/auditFormat.js';
import { nodeSignature, buildProbeConfig, parseDelayResult } from '../src/services/probeFormat.js';
import { load as yamlLoad } from 'js-yaml';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };

// --- parse individual protocol URIs ---
const vmess = 'vmess://' + Buffer.from(JSON.stringify({
  v: '2', ps: '香港01', add: 'hk.example.com', port: '443', id: '11111111-2222-3333-4444-555555555555',
  aid: '0', net: 'ws', host: 'hk.example.com', path: '/vm', tls: 'tls', scy: 'auto',
})).toString('base64');
const vless = 'vless://11111111-2222-3333-4444-555555555555@vl.example.com:443?type=ws&security=tls&sni=vl.example.com&path=%2Fvless#美国01';
const trojan = 'trojan://mypassword@tj.example.com:443?sni=tj.example.com#日本01';
const ss = 'ss://' + Buffer.from('aes-256-gcm:sspass').toString('base64') + '@ss.example.com:8388#新加坡01';
const hy2 = 'hysteria2://hy2pass@hy.example.com:443?sni=hy.example.com&insecure=1#韩国01';
const tuic = 'tuic://uuid-x:pw-y@tu.example.com:443?sni=tu.example.com&alpn=h3#台湾01';

for (const [name, uri] of [['vmess', vmess], ['vless', vless], ['trojan', trojan], ['ss', ss], ['hy2', hy2], ['tuic', tuic]]) {
  const n = parseUri(uri);
  ok(n && n.server && n.port, `parse ${name} -> ${n?.name} ${n?.type} ${n?.server}:${n?.port}`);
}

// --- base64 subscription blob ---
const blob = Buffer.from([vmess, vless, trojan, ss].join('\n')).toString('base64');
ok(parseSubscription(blob).length === 4, 'base64 subscription -> 4 nodes');

// --- clash yaml ---
const clashYaml = `proxies:
  - {name: CY-香港, type: trojan, server: c.example.com, port: 443, password: pw, sni: c.example.com}
  - {name: CY-vmess, type: vmess, server: v.example.com, port: 443, uuid: 11111111-2222-3333-4444-555555555555, cipher: auto, network: ws, tls: true, ws-opts: {path: /p}}
`;
ok(parseSubscription(clashYaml).length === 2, 'clash yaml -> 2 nodes');

// --- Subscription-Userinfo header parsing ---
const info = parseUserInfo('upload=100; download=200; total=1000; expire=1700000000');
ok(info.used === 300 && info.total === 1000 && info.expire === 1700000000000, 'parseUserInfo used/total/expire');

// --- node processing: filter + rename + prefix + dedup ---
const dup = [
  { name: '香港', type: 'vmess', server: 'a', port: 1, raw: {} },
  { name: '香港', type: 'vmess', server: 'b', port: 2, raw: {} },
  { name: '美国 官网续费', type: 'ss', server: 'c', port: 3, raw: {} },
];
const proc = processAirportNodes(dup, { exclude: '官网', prefix: '🇭🇰', rename: [{ from: '香港', to: 'HK' }] });
ok(proc.length === 2, 'filter dropped 官网 node');
ok(proc[0].name === '🇭🇰HK' && proc[1].name === '🇭🇰HK 2', `rename+prefix+dedup -> ${proc.map((n) => n.name).join(', ')}`);

// --- anytls protocol ---
const anytls = 'anytls://anytlspass@at.example.com:443?sni=at.example.com&insecure=1#香港AnyTLS';
const an = parseUri(anytls);
ok(an && an.type === 'anytls' && an.server === 'at.example.com' && an.raw.password === 'anytlspass', `parse anytls -> ${an?.name}`);
ok(toBase64([an]).length > 0 && Buffer.from(toBase64([an]), 'base64').toString().startsWith('anytls://'), 'toBase64 anytls');
ok(toClash([an]).includes('type: anytls'), 'toClash anytls');
ok(JSON.parse(toSingbox([an])).outbounds.some((o) => o.type === 'anytls'), 'toSingbox anytls');

// --- excludeProtocols filter ---
const mixed = [
  { name: 'A', type: 'vmess', server: 'a', port: 1, raw: {} },
  { name: 'B', type: 'ss', server: 'b', port: 2, raw: {} },
  { name: 'C', type: 'anytls', server: 'c', port: 3, raw: {} },
];
const noSs = processAirportNodes(mixed, { excludeProtocols: ['ss'] });
ok(noSs.length === 2 && !noSs.some((n) => n.type === 'ss'), 'excludeProtocols drops ss');
const onlyAny = processAirportNodes(mixed, { protocols: ['anytls'] });
ok(onlyAny.length === 1 && onlyAny[0].type === 'anytls', 'protocols keeps only anytls');

// --- converters ---
const nodes = parseSubscription(blob);
ok(Buffer.from(toBase64(nodes), 'base64').toString().includes('vmess://'), 'toBase64 round-trips');
ok(toClash(nodes).includes('type: vmess'), 'toClash has proxies');
ok(JSON.parse(toSingbox(nodes)).outbounds.some((o) => o.type === 'vmess'), 'toSingbox valid json');
ok(toSurge(nodes).includes('[Proxy]'), 'toSurge');
ok(toQuanX(nodes).includes('vmess=') || toQuanX(nodes).includes('trojan='), 'toQuanX');
ok(toLoon(nodes).includes('[Proxy]'), 'toLoon');

// --- template <PROXIES> placeholder ---
const tpl = 'proxies: []\nproxy-groups:\n  - name: G\n    type: select\n    proxies: [<PROXIES>]\n';
const out = toClash(nodes, tpl);
ok(!out.includes('<PROXIES>'), 'clash template placeholder replaced');

// --- maxLatency filter ---
const latNodes = [
  { name: 'fast', type: 'ss', server: 'a', port: 1, raw: {}, latency: 80 },
  { name: 'slow', type: 'ss', server: 'b', port: 2, raw: {}, latency: 350 },
  { name: 'timeout', type: 'ss', server: 'c', port: 3, raw: {}, latency: -1 },
  { name: 'untested', type: 'ss', server: 'd', port: 4, raw: {}, latency: null },
];
ok(filterNodes(latNodes, {}).length === 4, 'maxLatency off keeps all');
// 0 = only drop timed-out nodes
const lat0 = filterNodes(latNodes, { maxLatency: 0 }).map((n) => n.name);
ok(lat0.length === 3 && !lat0.includes('timeout'), `maxLatency 0 drops only timeout -> ${lat0.join(',')}`);
// >0 = drop timeout + over ceiling, keep untested
const lat200 = filterNodes(latNodes, { maxLatency: 200 }).map((n) => n.name);
ok(lat200.includes('fast') && lat200.includes('untested') && !lat200.includes('slow') && !lat200.includes('timeout'),
  `maxLatency 200 -> ${lat200.join(',')}`);

// --- default templates preserve standard routing rules & render ---
ok(DEFAULT_TEMPLATES.clash.content.includes('RULE-SET,Telegram,📲 电报信息'), 'clash default keeps ACL4SSR Telegram rule');
ok(DEFAULT_TEMPLATES.clash.content.includes('rule-providers'), 'clash default keeps rule-providers');
const clashRendered = toClash(nodes, DEFAULT_TEMPLATES.clash.content);
ok(!clashRendered.includes('<PROXIES>') && clashRendered.includes('📲 电报信息'), 'clash default template renders w/ groups');

// no ProxyGroup loop: build group->group ref graph, assert acyclic (FlClash rejects loops)
{
  const doc = yamlLoad(clashRendered);
  const groups = new Map((doc['proxy-groups'] || []).map((g) => [g.name, g]));
  const refs = (name) => (groups.get(name)?.proxies || []).filter((p) => groups.has(p));
  let cyclic = false;
  for (const start of groups.keys()) {
    const seen = new Set();
    const stack = [start];
    while (stack.length && !cyclic) {
      const cur = stack.pop();
      for (const nxt of refs(cur)) {
        if (nxt === start) { cyclic = true; break; }
        if (!seen.has(nxt)) { seen.add(nxt); stack.push(nxt); }
      }
    }
    if (cyclic) break;
  }
  ok(!cyclic, 'clash default has no ProxyGroup reference loop');
}
const sbRendered = JSON.parse(toSingbox(nodes, DEFAULT_TEMPLATES.singbox.content));
ok(sbRendered.outbounds.some((o) => o.tag === '💬 AI 平台') && sbRendered.route.rules.length > 3, 'singbox default keeps AI group + route rules');
ok(!JSON.stringify(sbRendered).includes('<PROXIES>'), 'singbox default placeholder replaced');
const surgeRendered = toSurge(nodes, DEFAULT_TEMPLATES.surge.content);
ok(surgeRendered.includes('RULE-SET,') && surgeRendered.includes('📲 电报信息') && !surgeRendered.includes('<PROXY_NAMES>'), 'surge default keeps RULE-SET rules');
const loonRendered = toLoon(nodes, DEFAULT_TEMPLATES.loon.content);
ok(loonRendered.includes('[Remote Rule]') && !loonRendered.includes('<PROXIES>'), 'loon default keeps remote rules');
const quanRendered = toQuanX(nodes, DEFAULT_TEMPLATES.quantumultx.content);
ok(quanRendered.includes('[filter_remote]') && !quanRendered.includes('<PROXY_NAMES>'), 'quanx default keeps filter_remote');

// --- monotonic cumulative traffic survives airport resets ---
{
  // raw readings: 100 -> 150 -> 30 (airport reset) -> 50
  let cum = null, last = null;
  for (const raw of [100, 150, 30, 50]) ({ cum, last } = accumulateUsed(cum, last, raw));
  // 100 (baseline) + 50 (growth) + 30 (fresh after reset) + 20 (growth) = 200
  ok(cum === 200 && last === 50, `accumulateUsed reset-safe cum=${cum} last=${last}`);
  // normal monotonic growth (no reset)
  let c2 = null, l2 = null;
  for (const raw of [10, 40, 90]) ({ cum: c2, last: l2 } = accumulateUsed(c2, l2, raw));
  ok(c2 === 90, `accumulateUsed monotonic growth cum=${c2}`);
  // non-numeric reading is ignored, counter unchanged
  const kept = accumulateUsed(90, 90, null);
  ok(kept.cum === 90 && kept.last === 90, 'accumulateUsed ignores null reading');
}

// --- monthly traffic reset day (with month-end clamp + same-day dedup) ---
{
  const D = (y, mo, d) => new Date(y, mo - 1, d, 12, 0); // local; mo is 1-based
  ok(shouldResetToday(15, D(2026, 3, 15)) === true, 'reset day = today → due');
  ok(shouldResetToday(15, D(2026, 3, 14)) === false, 'reset day ≠ today → not due');
  ok(shouldResetToday(15, D(2026, 3, 15), D(2026, 3, 15)) === false, 'already reset today → skip');
  ok(shouldResetToday(15, D(2026, 3, 15), D(2026, 2, 15)) === true, 'last reset last month → due');
  // month-end clamp: 2026 is non-leap so Feb has 28 days
  ok(shouldResetToday(31, D(2026, 2, 28)) === true, 'day 31 clamps to Feb 28 → due');
  ok(shouldResetToday(31, D(2026, 2, 27)) === false, 'day 31 not on Feb 27');
  ok(shouldResetToday(31, D(2026, 1, 31)) === true, 'day 31 on Jan 31 → due');
  ok(shouldResetToday(30, D(2026, 4, 30)) === true, 'day 30 on Apr 30 → due');
  // off / invalid
  ok(shouldResetToday(0, D(2026, 3, 15)) === false, 'day 0 = off');
  ok(shouldResetToday(null, D(2026, 3, 15)) === false, 'null = off');
  ok(shouldResetToday(32, D(2026, 3, 15)) === false, 'invalid day 32 = off');
}

// --- signed action tokens (magic links) ---
{
  const token = signAction({ t: 'refill', ap: 5 });
  const p = verifyAction(token);
  ok(p.t === 'refill' && p.ap === 5, `verifyAction round-trip -> ${p.t}/${p.ap}`);
  // tampering breaks the signature
  const tampered = token.slice(0, -2) + (token.slice(-1) === 'A' ? 'B' : 'A');
  let rejected = false;
  try { verifyAction(tampered); } catch { rejected = true; }
  ok(rejected, 'verifyAction rejects tampered token');
  // expired token rejected
  let expiredRejected = false;
  try { verifyAction(signAction({ t: 'pull', ap: 1, ttlMs: -1000 })); } catch { expiredRejected = true; }
  ok(expiredRejected, 'verifyAction rejects expired token');
  // unknown action can't even be signed
  let signRejected = false;
  try { signAction({ t: 'delete', ap: 1 }); } catch { signRejected = true; }
  ok(signRejected, 'signAction rejects unknown action');
}

// --- cron matcher + description ---
{
  // build dates from LOCAL components so getHours/getDay match the intended wall
  // clock regardless of the test runner's timezone (CI runs UTC; app runs UTC+8).
  const local = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi);
  ok(local(2026, 8, 17, 9, 0).getDay() === 1, 'test fixture: 2026-08-17 is Monday');
  ok(cronMatch('30 3 * * *', local(2026, 8, 14, 3, 30)), 'cron daily match');
  ok(!cronMatch('0 3 * * *', local(2026, 8, 14, 3, 30)), 'cron daily non-match minute');
  ok(cronMatch('*/15 * * * *', local(2026, 8, 14, 10, 45)), 'cron step match');
  ok(!cronMatch('*/15 * * * *', local(2026, 8, 14, 10, 46)), 'cron step non-match');
  ok(cronMatch('0 9 * * 1', local(2026, 8, 17, 9, 0)), 'cron weekday (Mon) match');
  ok(!cronMatch('0 9 * * 1', local(2026, 8, 18, 9, 0)), 'cron weekday non-match (Tue)');
  ok(cronMatch('0 8-10 * * *', local(2026, 8, 14, 9, 0)), 'cron range match');
  ok(cronMatch('0 8,20 * * *', local(2026, 8, 14, 20, 0)), 'cron list match');
  ok(isValidCron('0 3 * * *') && !isValidCron('99 3 * * *') && !isValidCron('* * * *'), 'cron validity');
  ok(describeCron('30 3 * * *') === '每天 03:30', `describeCron daily -> ${describeCron('30 3 * * *')}`);
  ok(describeCron('0 9 * * 1') === '每周周一 09:00', `describeCron weekly -> ${describeCron('0 9 * * 1')}`);
  ok(describeCron('0 */2 * * *') === '每 2 小时（第 0 分）', `describeCron everyN -> ${describeCron('0 */2 * * *')}`);
}

// --- global node exclude ---
{
  const combined = combineExclude(DEFAULT_GLOBAL_EXCLUDE, '自定义排除');
  const re = new RegExp(combined, 'i');
  ok(re.test('剩余流量 1024GB') && re.test('官网 example.com') && re.test('自定义排除节点'), 'global exclude matches junk + custom');
  ok(!re.test('香港 01') && !re.test('美国 IEPL 专线'), 'global exclude keeps real nodes');
  const nodes = [
    { name: '香港01', type: 'ss', server: 'a', port: 1, raw: {} },
    { name: '距离下次重置剩余', type: 'ss', server: 'b', port: 2, raw: {} },
    { name: '官网 buy.example.com', type: 'ss', server: 'c', port: 3, raw: {} },
  ];
  const kept = filterNodes(nodes, { exclude: DEFAULT_GLOBAL_EXCLUDE }).map((n) => n.name);
  ok(kept.length === 1 && kept[0] === '香港01', `filterNodes global exclude -> ${kept.join(',')}`);
  ok(combineExclude('', null, 'a') === '(?:a)' && combineExclude() === '', 'combineExclude skips empties');
}

// --- node health scoring + good-node-first ordering ---
{
  const stats = new Map([
    ['1.1.1.1:443', { total: 10, ok: 10, uptime: 1, avgLatency: 55 }],   // fast + reliable
    ['3.3.3.3:443', { total: 10, ok: 10, uptime: 1, avgLatency: 850 }],  // reliable but slow
    ['2.2.2.2:443', { total: 10, ok: 0, uptime: 0, avgLatency: null }],  // always times out
  ]);
  const good = { server: '1.1.1.1', port: 443 };
  const slow = { server: '3.3.3.3', port: 443 };
  const dead = { server: '2.2.2.2', port: 443 };
  const untested = { server: '9.9.9.9', port: 443, latency: null };      // no history, no live
  ok(nodeHealthScore(good, stats) > nodeHealthScore(slow, stats), 'health: fast > slow');
  ok(nodeHealthScore(slow, stats) > nodeHealthScore(untested, stats), 'health: reliable-slow > untested');
  ok(nodeHealthScore(untested, stats) > nodeHealthScore(dead, stats), 'health: untested > dead');
  ok(nodeHealthScore(untested, stats) === 0, 'health: untested scores neutral 0');
  // live-latency fallback when no history exists
  const liveFast = { server: 'x', port: 1, latency: 40 };
  const liveDead = { server: 'y', port: 1, latency: -1 };
  ok(nodeHealthScore(liveFast, stats) > 0 && nodeHealthScore(liveDead, stats) < -900, 'health: falls back to live latency');
  // ordering is stable & good-first; untested keeps its input position among peers
  const order = orderByHealth([dead, untested, slow, good], stats).map((n) => n.server);
  ok(order.join(',') === '1.1.1.1,3.3.3.3,9.9.9.9,2.2.2.2', `orderByHealth good-first -> ${order.join(',')}`);
}

// --- deduped latency planning: one ping per endpoint, fan-out, freshness reuse ---
{
  const now = 1_000_000_000_000;
  // 5 node rows, but only 3 unique endpoints (a & c each imported by 2 accounts)
  const rows = [
    { id: 1, server: 'a', port: 443, latency: 80, latency_at: now - 5000 },
    { id: 2, server: 'a', port: 443, latency: null, latency_at: null },      // dup of #1
    { id: 3, server: 'b', port: 443, latency: null, latency_at: null },
    { id: 4, server: 'c', port: 443, latency: 200, latency_at: now - 60 * 60000 }, // 1h old
    { id: 5, server: 'c', port: 443, latency: null, latency_at: null },      // dup of #4
  ];
  ok(endpointKey('a', 443) === 'a:443', 'endpointKey');

  // no freshness: every unique endpoint measured once, all dups grouped
  const plan = planLatencyChecks(rows, { now, freshMs: 0 });
  ok(plan.groups.size === 3, `dedup -> 3 endpoints (from 5 rows), got ${plan.groups.size}`);
  ok(plan.toMeasure.length === 3 && plan.reused.length === 0, 'no freshness: measure all 3');
  ok(plan.groups.get('a:443').ids.join(',') === '1,2', 'endpoint a fans out to rows 1,2');
  ok(plan.groups.get('c:443').ids.join(',') === '4,5', 'endpoint c fans out to rows 4,5');

  // freshness 10min: endpoint a (5s old) reused; c (1h old) & b (never) re-measured
  const plan2 = planLatencyChecks(rows, { now, freshMs: 10 * 60000 });
  ok(plan2.reused.length === 1 && plan2.reused[0].key === 'a:443' && plan2.reused[0].latency === 80, 'fresh endpoint reused');
  ok(plan2.toMeasure.map((m) => m.key).sort().join(',') === 'b:443,c:443', `stale/untested measured -> ${plan2.toMeasure.map((m) => m.key).join(',')}`);
}

// --- delivery dedup by endpoint (drop identical server:port across accounts) ---
{
  const nodes = [
    { name: 'A-香港', server: 'hk.example.com', port: 443, type: 'vmess' },
    { name: 'B-香港', server: 'hk.example.com', port: 443, type: 'vmess' }, // dup endpoint (other account)
    { name: 'C-日本', server: 'jp.example.com', port: 443, type: 'ss' },
    { name: 'D-香港-8443', server: 'hk.example.com', port: 8443, type: 'vmess' }, // same host, diff port → kept
  ];
  const out = dedupByEndpoint(nodes);
  ok(out.length === 3, `dedupByEndpoint 4→3, got ${out.length}`);
  ok(out.map((n) => n.name).join(',') === 'A-香港,C-日本,D-香港-8443', `keeps first per endpoint -> ${out.map((n) => n.name).join(',')}`);
}

// --- rule preview: kept vs dropped-with-reason (mirrors filterNodes order) ---
{
  const pnodes = [
    { name: '香港01', type: 'ss', latency: 80 },
    { name: '美国官网', type: 'ss', latency: 120 },     // exclude match
    { name: '日本vmess', type: 'vmess', latency: 500 }, // excluded protocol
    { name: '新加坡', type: 'ss', latency: -1 },         // timeout
    { name: '台湾', type: 'ss', latency: 900 },          // over latency ceiling
    { name: '韩国', type: 'trojan', latency: 60 },       // not in include
  ];
  const pv = previewFilter(pnodes, {
    include: '香港|美国|新加坡|台湾|日本', exclude: '官网',
    excludeProtocols: ['vmess'], maxLatency: 200,
  });
  const keptNames = pv.kept.map((n) => n.name);
  ok(keptNames.length === 1 && keptNames[0] === '香港01', `preview kept -> ${keptNames.join(',')}`);
  const reasons = Object.fromEntries(pv.dropped.map((d) => [d.name, d.reason]));
  ok(reasons['美国官网'] === 'exclude', 'preview reason exclude');
  ok(reasons['日本vmess'] === 'exproto', 'preview reason excluded-protocol');
  ok(reasons['新加坡'] === 'timeout', 'preview reason timeout');
  ok(reasons['台湾'] === 'latency', 'preview reason latency');
  ok(reasons['韩国'] === 'include', 'preview reason not-included');
  ok(pv.keptCount === undefined && (pv.kept.length + pv.dropped.length) === 6, 'preview accounts for every node');
}

// --- audit: action description + body sanitization ---
{
  ok(describeAction('DELETE', '/api/users/5') === '删除用户 #5', `describeAction delete user -> ${describeAction('DELETE', '/api/users/5')}`);
  ok(describeAction('POST', '/api/airports') === '新增机场', `describeAction create airport -> ${describeAction('POST', '/api/airports')}`);
  ok(describeAction('PUT', '/api/airports/3') === '修改机场 #3', `describeAction update airport -> ${describeAction('PUT', '/api/airports/3')}`);
  ok(describeAction('POST', '/api/airports/3/fetch') === '机场 #3 · 拉取', `describeAction airport fetch -> ${describeAction('POST', '/api/airports/3/fetch')}`);
  ok(describeAction('POST', '/api/users/batch/delete') === '用户 · 批量删除', `describeAction batch delete -> ${describeAction('POST', '/api/users/batch/delete')}`);
  ok(describeAction('POST', '/api/settings/account') === '设置 · 修改账户', `describeAction account -> ${describeAction('POST', '/api/settings/account')}`);
  ok(describeAction('POST', '/api/nodes/latency') === '节点 · 延迟检测', `describeAction latency -> ${describeAction('POST', '/api/nodes/latency')}`);
  // sanitize: secrets redacted, plain fields kept, empty -> null
  const clean = JSON.parse(sanitizeBody({ username: 'admin', password: 'hunter2', newPassword: 'x', otp: '123', nested: { authToken: 't', name: 'ok' } }));
  ok(clean.username === 'admin' && clean.password === '***' && clean.newPassword === '***' && clean.otp === '***', 'sanitizeBody redacts secrets');
  ok(clean.nested.authToken === '***' && clean.nested.name === 'ok', 'sanitizeBody redacts nested secrets, keeps plain');
  ok(sanitizeBody({}) === null && sanitizeBody(null) === null && sanitizeBody(Buffer.from('x')) === null, 'sanitizeBody empty/buffer -> null');
  const longStr = sanitizeBody({ content: 'a'.repeat(500) });
  ok(JSON.parse(longStr).content.length <= 301, 'sanitizeBody truncates long strings');
}

// --- availability probe: signature dedup + sing-box config + delay parsing ---
{
  // identical configs share a signature; different uuid → different signature
  const a = { type: 'vmess', server: 'hk.com', port: 443, raw: { uuid: 'u1', network: 'ws' } };
  const b = { type: 'vmess', server: 'hk.com', port: 443, raw: { network: 'ws', uuid: 'u1' } }; // key order differs
  const c = { type: 'vmess', server: 'hk.com', port: 443, raw: { uuid: 'u2', network: 'ws' } };
  ok(nodeSignature(a) === nodeSignature(b), 'nodeSignature stable regardless of raw key order');
  ok(nodeSignature(a) !== nodeSignature(c), 'different uuid → different signature');
  ok(nodeSignature({ ...a, raw: JSON.stringify(a.raw) }) === nodeSignature(a), 'signature accepts stringified raw');

  // probe config: one outbound per node (tagged) + direct + clash api
  const cfg = buildProbeConfig([
    { tag: 'p0', node: { type: 'trojan', server: 't.com', port: 443, raw: { password: 'pw', sni: 't.com' } } },
    { tag: 'p1', node: { type: 'ss', server: 's.com', port: 8388, raw: { cipher: 'aes-256-gcm', password: 'pw' } } },
  ], 39001);
  const tags = cfg.outbounds.map((o) => o.tag);
  ok(tags.includes('p0') && tags.includes('p1') && tags.includes('direct'), `probe config tags -> ${tags.join(',')}`);
  ok(cfg.experimental.clash_api.external_controller === '127.0.0.1:39001', 'probe config wires clash api port');
  ok(cfg.outbounds.find((o) => o.tag === 'p0').type === 'trojan', 'probe outbound built from node');

  // delay parsing
  ok(parseDelayResult(200, { delay: 187 }).ok === true && parseDelayResult(200, { delay: 187 }).ms === 187, 'delay 200 → alive');
  ok(parseDelayResult(408, { message: 'timeout' }).ok === false && parseDelayResult(408, { message: 'timeout' }).ms === -1, 'delay 408 → dead');
  ok(parseDelayResult(200, {}).ok === false, 'delay 200 without number → dead');
}

// --- UA detection ---
ok(detectFormat('ClashMetaForAndroid/2.10') === 'clash', 'detect clash UA');
ok(detectFormat('sing-box 1.8') === 'singbox', 'detect singbox UA');
ok(detectFormat('Shadowrocket/1.0') === 'base64', 'detect shadowrocket UA');
ok(detectFormat('Surge/5') === 'surge', 'detect surge UA');

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
