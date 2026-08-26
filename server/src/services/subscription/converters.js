import { load as yamlLoad, dump as yamlDump } from 'js-yaml';

// Convert normalized nodes -> various client subscription formats.
// Normalized node: { name, type, server, port, raw }

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

// Prefer the source share URI when it is available.  A subscription relay must
// not silently discard vendor / newer-core parameters it does not yet model
// (for example XHTTP, gRPC serviceName, SS plugins, or uTLS options).  We only
// replace the display name, which is deliberately changed by ApRID filters.
function sourceUriWithName(n) {
  const uri = String(n.uri || '').trim();
  if (!/^\w[\w+.-]*:\/\//.test(uri)) return '';
  if (uri.startsWith('vmess://')) {
    try {
      const raw = uri.slice('vmess://'.length);
      const obj = JSON.parse(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      obj.ps = n.name;
      return `vmess://${b64(JSON.stringify(obj))}`;
    } catch { return uri; }
  }
  const cut = uri.indexOf('#');
  return `${cut >= 0 ? uri.slice(0, cut) : uri}#${encodeURIComponent(n.name)}`;
}

// ---------------- Base64 (v2rayN / generic) ----------------
function nodeToUri(n) {
  const sourceUri = sourceUriWithName(n);
  if (sourceUri) return sourceUri;
  const r = n.raw || {};
  const enc = encodeURIComponent;
  switch (n.type) {
    case 'vmess': {
      const o = {
        v: '2', ps: n.name, add: n.server, port: String(n.port), id: r.uuid,
        aid: String(r.alterId || 0), scy: r.cipher || 'auto', net: r.network || 'tcp',
        type: 'none', host: r.host || '', path: r.path || '',
        tls: r.tls ? 'tls' : '', sni: r.sni || '',
      };
      return 'vmess://' + b64(JSON.stringify(o));
    }
    case 'vless': {
      const q = new URLSearchParams();
      q.set('type', r.network || 'tcp');
      if (r.tls || r.security) q.set('security', r.security || 'tls');
      if (r.sni) q.set('sni', r.sni);
      if (r.flow) q.set('flow', r.flow);
      if (r.host) q.set('host', r.host);
      if (r.path) q.set('path', r.path);
      if (r.pbk) q.set('pbk', r.pbk);
      if (r.sid) q.set('sid', r.sid);
      if (r.fp) q.set('fp', r.fp);
      return `vless://${r.uuid}@${n.server}:${n.port}?${q}#${enc(n.name)}`;
    }
    case 'trojan': {
      const q = new URLSearchParams();
      if (r.sni) q.set('sni', r.sni);
      if (r.network && r.network !== 'tcp') q.set('type', r.network);
      if (r.path) q.set('path', r.path);
      return `trojan://${r.password}@${n.server}:${n.port}?${q}#${enc(n.name)}`;
    }
    case 'ss': {
      const cred = b64(`${r.cipher}:${r.password}`);
      return `ss://${cred}@${n.server}:${n.port}#${enc(n.name)}`;
    }
    case 'hysteria2': {
      const q = new URLSearchParams();
      if (r.sni) q.set('sni', r.sni);
      if (r.insecure) q.set('insecure', '1');
      if (r.obfs) q.set('obfs', r.obfs);
      return `hysteria2://${r.password}@${n.server}:${n.port}?${q}#${enc(n.name)}`;
    }
    case 'tuic': {
      const q = new URLSearchParams();
      if (r.sni) q.set('sni', r.sni);
      if (r.alpn) q.set('alpn', r.alpn);
      if (r.congestion) q.set('congestion_control', r.congestion);
      return `tuic://${r.uuid}:${r.password}@${n.server}:${n.port}?${q}#${enc(n.name)}`;
    }
    case 'anytls': {
      const q = new URLSearchParams();
      if (r.sni) q.set('sni', r.sni);
      if (r.insecure) q.set('insecure', '1');
      if (r.fp) q.set('fp', r.fp);
      return `anytls://${encodeURIComponent(r.password || '')}@${n.server}:${n.port}?${q}#${enc(n.name)}`;
    }
    default:
      return '';
  }
}

export function toBase64(nodes) {
  const uris = nodes.map(nodeToUri).filter(Boolean).join('\n');
  return b64(uris);
}

// ---------------- Clash.Meta (yaml) ----------------
function nodeToClash(n) {
  const r = n.raw || {};
  const base = { name: n.name, server: n.server, port: n.port };
  switch (n.type) {
    case 'vmess': {
      const p = { ...base, type: 'vmess', uuid: r.uuid, alterId: r.alterId || 0, cipher: r.cipher || 'auto' };
      if (r.tls) { p.tls = true; if (r.sni) p.servername = r.sni; }
      if (r.network === 'ws') p['ws-opts'] = { path: r.path || '/', headers: r.host ? { Host: r.host } : {} };
      if (r.network === 'grpc') p['grpc-opts'] = { 'grpc-service-name': r.serviceName || '' };
      p.network = r.network || 'tcp';
      return p;
    }
    case 'vless': {
      const p = { ...base, type: 'vless', uuid: r.uuid, network: r.network || 'tcp' };
      if (r.tls) { p.tls = true; if (r.sni) p.servername = r.sni; }
      if (r.flow) p.flow = r.flow;
      if (r.network === 'ws') p['ws-opts'] = { path: r.path || '/', headers: r.host ? { Host: r.host } : {} };
      if (r.network === 'grpc') p['grpc-opts'] = { 'grpc-service-name': r.serviceName || '' };
      if (r.pbk) p['reality-opts'] = { 'public-key': r.pbk, 'short-id': r.sid || '' };
      if (r.fp) p['client-fingerprint'] = r.fp;
      return p;
    }
    case 'trojan': {
      const p = { ...base, type: 'trojan', password: r.password };
      if (r.sni) p.sni = r.sni;
      if (r.network === 'ws') p['ws-opts'] = { path: r.path || '/', headers: r.host ? { Host: r.host } : {} };
      if (r.network === 'grpc') p['grpc-opts'] = { 'grpc-service-name': r.serviceName || '' };
      return p;
    }
    case 'ss':
      return { ...base, type: 'ss', cipher: r.cipher, password: r.password };
    case 'hysteria2': {
      const p = { ...base, type: 'hysteria2', password: r.password };
      if (r.sni) p.sni = r.sni;
      if (r.insecure) p['skip-cert-verify'] = true;
      if (r.obfs) { p.obfs = r.obfs; p['obfs-password'] = r.obfsPassword || ''; }
      return p;
    }
    case 'tuic':
      return { ...base, type: 'tuic', uuid: r.uuid, password: r.password, sni: r.sni || '', alpn: [r.alpn || 'h3'] };
    case 'anytls': {
      const p = { ...base, type: 'anytls', password: r.password };
      if (r.sni) p.sni = r.sni;
      if (r.insecure) p['skip-cert-verify'] = true;
      if (r.fp) p['client-fingerprint'] = r.fp;
      return p;
    }
    default:
      return null;
  }
}

export function toClash(nodes, templateContent) {
  const proxies = nodes.map(nodeToClash).filter(Boolean);
  const names = proxies.map((p) => p.name);

  if (templateContent) {
    let doc;
    try { doc = yamlLoad(templateContent); } catch { doc = null; }
    if (doc && typeof doc === 'object') {
      doc.proxies = proxies;
      // inject node names into any group that declares a "<PROXIES>" placeholder
      if (Array.isArray(doc['proxy-groups'])) {
        for (const g of doc['proxy-groups']) {
          if (Array.isArray(g.proxies)) {
            g.proxies = g.proxies.flatMap((x) => (x === '<PROXIES>' ? names : [x]));
          } else {
            g.proxies = names;
          }
        }
      }
      return yamlDump(doc, { lineWidth: -1 });
    }
  }

  // default minimal clash config
  const doc = {
    'mixed-port': 7890,
    'allow-lan': true,
    mode: 'rule',
    'log-level': 'info',
    proxies,
    'proxy-groups': [
      { name: '🚀 节点选择', type: 'select', proxies: ['♻️ 自动选择', ...names] },
      { name: '♻️ 自动选择', type: 'url-test', url: 'http://www.gstatic.com/generate_204', interval: 300, proxies: names },
    ],
    rules: ['GEOIP,CN,DIRECT', 'MATCH,🚀 节点选择'],
  };
  return yamlDump(doc, { lineWidth: -1 });
}

// ---------------- sing-box (json) ----------------
// exported so the availability probe (services/probe.js) can build real sing-box
// outbounds from nodes and dial through them.
export function nodeToSingbox(n) {
  const r = n.raw || {};
  const tag = n.name;
  const transport = () => {
    if (r.network === 'ws') return { type: 'ws', path: r.path || '/', headers: r.host ? { Host: r.host } : {} };
    if (r.network === 'grpc') return { type: 'grpc', service_name: r.serviceName || '' };
    return null;
  };
  const tls = (required = false) => ({ enabled: required || !!r.tls, server_name: r.sni || n.server,
    ...(r.fp ? { utls: { enabled: true, fingerprint: r.fp } } : {}),
    ...(r.pbk ? { reality: { enabled: true, public_key: r.pbk, short_id: r.sid || '' } } : {}) });
  switch (n.type) {
    case 'vmess':
      return { type: 'vmess', tag, server: n.server, server_port: n.port, uuid: r.uuid,
        alter_id: r.alterId || 0, security: r.cipher || 'auto',
        ...(r.tls ? { tls: tls() } : {}), ...(transport() ? { transport: transport() } : {}) };
    case 'vless':
      return { type: 'vless', tag, server: n.server, server_port: n.port, uuid: r.uuid, flow: r.flow || '',
        ...(r.tls ? { tls: tls() } : {}), ...(transport() ? { transport: transport() } : {}) };
    case 'trojan':
      return { type: 'trojan', tag, server: n.server, server_port: n.port, password: r.password,
        tls: tls(true), ...(transport() ? { transport: transport() } : {}) };
    case 'ss':
      return { type: 'shadowsocks', tag, server: n.server, server_port: n.port, method: r.cipher, password: r.password };
    case 'hysteria2':
      return { type: 'hysteria2', tag, server: n.server, server_port: n.port, password: r.password,
        ...(r.obfs ? { obfs: { type: r.obfs, password: r.obfsPassword || '' } } : {}),
        tls: { enabled: true, server_name: r.sni || n.server, insecure: !!r.insecure } };
    case 'tuic':
      return { type: 'tuic', tag, server: n.server, server_port: n.port, uuid: r.uuid, password: r.password,
        ...(r.congestion ? { congestion_control: r.congestion } : {}),
        tls: { enabled: true, server_name: r.sni || n.server, alpn: [r.alpn || 'h3'] } };
    case 'anytls':
      return { type: 'anytls', tag, server: n.server, server_port: n.port, password: r.password,
        tls: { enabled: true, server_name: r.sni || n.server, insecure: !!r.insecure } };
    default:
      return null;
  }
}

export function toSingbox(nodes, templateContent) {
  const outbounds = nodes.map(nodeToSingbox).filter(Boolean);
  const tags = outbounds.map((o) => o.tag);
  if (templateContent) {
    let doc;
    try { doc = JSON.parse(templateContent); } catch { doc = null; }
    if (doc && typeof doc === 'object') {
      const selectors = (doc.outbounds || []).filter((o) => ['selector', 'urltest'].includes(o.type));
      for (const s of selectors) {
        s.outbounds = (s.outbounds || []).flatMap((x) => (x === '<PROXIES>' ? tags : [x]));
        if (!s.outbounds.length) s.outbounds = tags;
      }
      doc.outbounds = [...(doc.outbounds || []), ...outbounds];
      return JSON.stringify(doc, null, 2);
    }
  }
  const doc = {
    log: { level: 'info' },
    outbounds: [
      { type: 'selector', tag: '节点选择', outbounds: ['自动选择', ...tags], default: '自动选择' },
      { type: 'urltest', tag: '自动选择', outbounds: tags, url: 'http://www.gstatic.com/generate_204', interval: '5m' },
      ...outbounds,
      { type: 'direct', tag: 'direct' },
    ],
  };
  return JSON.stringify(doc, null, 2);
}

// ---------------- Surge ----------------
function nodeToSurge(n) {
  const r = n.raw || {};
  switch (n.type) {
    case 'vmess': {
      const parts = [`vmess, ${n.server}, ${n.port}, username=${r.uuid}`];
      if (r.tls) parts.push('tls=true', `sni=${r.sni || n.server}`);
      if (r.network === 'ws') parts.push('ws=true', `ws-path=${r.path || '/'}`, r.host ? `ws-headers=Host:${r.host}` : '');
      return `${n.name} = ${parts.filter(Boolean).join(', ')}`;
    }
    case 'trojan': {
      const parts = [`trojan, ${n.server}, ${n.port}, password=${r.password}`, `sni=${r.sni || n.server}`];
      return `${n.name} = ${parts.join(', ')}`;
    }
    case 'ss':
      return `${n.name} = ss, ${n.server}, ${n.port}, encrypt-method=${r.cipher}, password=${r.password}`;
    case 'hysteria2':
      return `${n.name} = hysteria2, ${n.server}, ${n.port}, password=${r.password}, sni=${r.sni || n.server}`;
    default:
      return null; // vless/tuic not supported by Surge
  }
}

export function toSurge(nodes, templateContent) {
  const lines = nodes.map(nodeToSurge).filter(Boolean);
  const names = nodes.map((n) => n.name);
  if (templateContent && templateContent.includes('<PROXIES>')) {
    return templateContent
      .replace('<PROXIES>', lines.join('\n'))
      .replace(/<PROXY_NAMES>/g, names.join(', '));
  }
  return [
    '[Proxy]',
    ...lines,
    '',
    '[Proxy Group]',
    `节点选择 = select, ${names.join(', ')}`,
    '',
    '[Rule]',
    'GEOIP,CN,DIRECT',
    'FINAL,节点选择',
  ].join('\n');
}

// ---------------- QuantumultX ----------------
function nodeToQuanX(n) {
  const r = n.raw || {};
  switch (n.type) {
    case 'vmess': {
      const p = [`vmess=${n.server}:${n.port}`, `method=${r.cipher || 'none'}`, `password=${r.uuid}`];
      if (r.network === 'ws') { p.push('obfs=ws', `obfs-uri=${r.path || '/'}`); if (r.host) p.push(`obfs-host=${r.host}`); }
      if (r.tls) p.push('tls-verification=true');
      p.push(`tag=${n.name}`);
      return p.join(', ');
    }
    case 'trojan':
      return `trojan=${n.server}:${n.port}, password=${r.password}, over-tls=true, tls-host=${r.sni || n.server}, tag=${n.name}`;
    case 'ss':
      return `shadowsocks=${n.server}:${n.port}, method=${r.cipher}, password=${r.password}, tag=${n.name}`;
    default:
      return null;
  }
}

export function toQuanX(nodes, templateContent) {
  const lines = nodes.map(nodeToQuanX).filter(Boolean);
  const names = nodes.map((n) => n.name);
  if (templateContent && templateContent.includes('<PROXIES>')) {
    return templateContent
      .replace('<PROXIES>', lines.join('\n'))
      .replace(/<PROXY_NAMES>/g, names.join(', '));
  }
  // default: bare server list (QuantumultX server_remote resource)
  return lines.join('\n');
}

// ---------------- Loon ----------------
function nodeToLoon(n) {
  const r = n.raw || {};
  switch (n.type) {
    case 'vmess': {
      const p = [`${n.name} = vmess`, n.server, n.port, r.cipher || 'auto', `"${r.uuid}"`];
      let line = p.join(',');
      if (r.network === 'ws') line += `,transport:ws,path:${r.path || '/'}${r.host ? `,host:${r.host}` : ''}`;
      if (r.tls) line += `,over-tls:true,tls-name:${r.sni || n.server}`;
      return line;
    }
    case 'trojan':
      return `${n.name} = trojan,${n.server},${n.port},"${r.password}",tls-name:${r.sni || n.server}`;
    case 'ss':
      return `${n.name} = shadowsocks,${n.server},${n.port},${r.cipher},"${r.password}"`;
    default:
      return null;
  }
}

export function toLoon(nodes, templateContent) {
  const lines = nodes.map(nodeToLoon).filter(Boolean);
  const names = nodes.map((n) => n.name);
  if (templateContent && templateContent.includes('<PROXIES>')) {
    return templateContent
      .replace('<PROXIES>', lines.join('\n'))
      .replace(/<PROXY_NAMES>/g, names.join(','));
  }
  return [
    '[Proxy]',
    ...lines,
    '',
    '[Proxy Group]',
    `节点选择 = select,${names.join(',')}`,
    '',
    '[Rule]',
    'GEOIP,CN,DIRECT',
    'FINAL,节点选择',
  ].join('\n');
}

// map a client label to a converter
export const FORMATS = {
  base64: { name: '通用 (Base64)', contentType: 'text/plain; charset=utf-8', build: toBase64 },
  v2rayn: { name: 'v2rayN', contentType: 'text/plain; charset=utf-8', build: toBase64 },
  clash: { name: 'Clash.Meta', contentType: 'text/yaml; charset=utf-8', build: toClash },
  singbox: { name: 'sing-box', contentType: 'application/json; charset=utf-8', build: toSingbox },
  surge: { name: 'Surge', contentType: 'text/plain; charset=utf-8', build: toSurge },
  quantumultx: { name: 'QuantumultX', contentType: 'text/plain; charset=utf-8', build: toQuanX },
  loon: { name: 'Loon', contentType: 'text/plain; charset=utf-8', build: toLoon },
};

// detect client from User-Agent
export function detectFormat(ua = '') {
  ua = ua.toLowerCase();
  if (ua.includes('clash') || ua.includes('meta') || ua.includes('mihomo') || ua.includes('stash')) return 'clash';
  if (ua.includes('sing-box') || ua.includes('singbox')) return 'singbox';
  if (ua.includes('surge')) return 'surge';
  if (ua.includes('quantumult')) return 'quantumultx';
  if (ua.includes('loon')) return 'loon';
  if (ua.includes('shadowrocket') || ua.includes('v2ray') || ua.includes('v2rayn')) return 'base64';
  return 'base64';
}
