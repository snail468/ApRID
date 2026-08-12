// Self-contained logic tests (no DB / no network) — run in CI via `npm test`.
import { parseSubscription, parseUri, parseUserInfo } from '../src/services/nodeParser.js';
import { processAirportNodes, filterNodes } from '../src/services/nodeProcess.js';
import { toBase64, toClash, toSingbox, toSurge, toQuanX, toLoon, detectFormat } from '../src/services/subscription/converters.js';
import { DEFAULT_TEMPLATES } from '../src/services/subscription/defaultTemplates.js';
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

// --- UA detection ---
ok(detectFormat('ClashMetaForAndroid/2.10') === 'clash', 'detect clash UA');
ok(detectFormat('sing-box 1.8') === 'singbox', 'detect singbox UA');
ok(detectFormat('Shadowrocket/1.0') === 'base64', 'detect shadowrocket UA');
ok(detectFormat('Surge/5') === 'surge', 'detect surge UA');

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
