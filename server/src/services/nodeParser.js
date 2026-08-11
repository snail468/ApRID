import { load as yamlLoad } from 'js-yaml';

// Normalized node shape:
// { name, type, server, port, raw:{...protocol specific...}, uri }

const b64decode = (s) => {
  try {
    return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
};

const isBase64 = (s) => /^[A-Za-z0-9+/=_\-\s]+$/.test(s.trim()) && s.trim().length > 24;

function safeUrl(u) {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

// ---- individual protocol parsers ----
function parseVmess(uri) {
  const json = b64decode(uri.slice('vmess://'.length));
  let o;
  try {
    o = JSON.parse(json);
  } catch {
    return null;
  }
  return {
    name: o.ps || o.remark || `${o.add}:${o.port}`,
    type: 'vmess',
    server: o.add,
    port: parseInt(o.port, 10),
    uri,
    raw: {
      uuid: o.id,
      alterId: parseInt(o.aid || 0, 10),
      cipher: o.scy || 'auto',
      network: o.net || 'tcp',
      tls: o.tls === 'tls',
      sni: o.sni || o.host || '',
      host: o.host || '',
      path: o.path || '',
      wsHeaders: o.host ? { Host: o.host } : {},
    },
  };
}

function parseVlessTrojan(uri, type) {
  const u = safeUrl(uri);
  if (!u) return null;
  const q = u.searchParams;
  return {
    name: decodeURIComponent(u.hash.slice(1)) || `${u.hostname}:${u.port}`,
    type,
    server: u.hostname,
    port: parseInt(u.port, 10),
    uri,
    raw: {
      uuid: type === 'vless' ? decodeURIComponent(u.username) : undefined,
      password: type === 'trojan' ? decodeURIComponent(u.username) : undefined,
      network: q.get('type') || 'tcp',
      tls: (q.get('security') || (type === 'trojan' ? 'tls' : '')) !== '',
      security: q.get('security') || '',
      sni: q.get('sni') || q.get('peer') || '',
      flow: q.get('flow') || '',
      fp: q.get('fp') || '',
      pbk: q.get('pbk') || '',
      sid: q.get('sid') || '',
      host: q.get('host') || '',
      path: q.get('path') ? decodeURIComponent(q.get('path')) : '',
      serviceName: q.get('serviceName') || '',
    },
  };
}

function parseSS(uri) {
  // ss://BASE64(method:password)@host:port#name  OR  ss://BASE64(everything)#name
  let rest = uri.slice('ss://'.length);
  let name = '';
  const hashIdx = rest.indexOf('#');
  if (hashIdx >= 0) {
    name = decodeURIComponent(rest.slice(hashIdx + 1));
    rest = rest.slice(0, hashIdx);
  }
  let method, password, server, port;
  if (rest.includes('@')) {
    const [cred, hostpart] = rest.split('@');
    const decoded = b64decode(cred);
    [method, password] = decoded.includes(':') ? decoded.split(':') : cred.split(':');
    const hp = hostpart.split(':');
    server = hp[0];
    port = parseInt(hp[1], 10);
  } else {
    const decoded = b64decode(rest);
    const m = decoded.match(/^(.+?):(.+)@(.+):(\d+)$/);
    if (!m) return null;
    [, method, password, server, port] = m;
    port = parseInt(port, 10);
  }
  return {
    name: name || `${server}:${port}`,
    type: 'ss',
    server,
    port,
    uri,
    raw: { cipher: method, password },
  };
}

function parseHy2(uri) {
  const u = safeUrl(uri);
  if (!u) return null;
  const q = u.searchParams;
  return {
    name: decodeURIComponent(u.hash.slice(1)) || `${u.hostname}:${u.port}`,
    type: 'hysteria2',
    server: u.hostname,
    port: parseInt(u.port || '443', 10),
    uri,
    raw: {
      password: decodeURIComponent(u.username || ''),
      sni: q.get('sni') || '',
      insecure: q.get('insecure') === '1',
      obfs: q.get('obfs') || '',
      obfsPassword: q.get('obfs-password') || '',
    },
  };
}

function parseTuic(uri) {
  const u = safeUrl(uri);
  if (!u) return null;
  const q = u.searchParams;
  return {
    name: decodeURIComponent(u.hash.slice(1)) || `${u.hostname}:${u.port}`,
    type: 'tuic',
    server: u.hostname,
    port: parseInt(u.port || '443', 10),
    uri,
    raw: {
      uuid: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || ''),
      sni: q.get('sni') || '',
      congestion: q.get('congestion_control') || 'bbr',
      alpn: q.get('alpn') || 'h3',
    },
  };
}

export function parseUri(uri) {
  uri = uri.trim();
  if (uri.startsWith('vmess://')) return parseVmess(uri);
  if (uri.startsWith('vless://')) return parseVlessTrojan(uri, 'vless');
  if (uri.startsWith('trojan://')) return parseVlessTrojan(uri, 'trojan');
  if (uri.startsWith('ss://')) return parseSS(uri);
  if (uri.startsWith('hysteria2://') || uri.startsWith('hy2://')) return parseHy2(uri);
  if (uri.startsWith('tuic://')) return parseTuic(uri);
  return null;
}

// ---- Clash yaml proxies -> normalized ----
function fromClashProxy(p) {
  const base = { name: p.name, server: p.server, port: parseInt(p.port, 10), uri: '' };
  switch (p.type) {
    case 'vmess':
      return { ...base, type: 'vmess', raw: {
        uuid: p.uuid, alterId: p.alterId || 0, cipher: p.cipher || 'auto',
        network: p.network || 'tcp', tls: !!p.tls, sni: p.servername || '',
        host: p['ws-opts']?.headers?.Host || '', path: p['ws-opts']?.path || '',
      }};
    case 'vless':
      return { ...base, type: 'vless', raw: {
        uuid: p.uuid, network: p.network || 'tcp', tls: !!p.tls, sni: p.servername || '',
        flow: p.flow || '', path: p['ws-opts']?.path || '', host: p['ws-opts']?.headers?.Host || '',
      }};
    case 'trojan':
      return { ...base, type: 'trojan', raw: {
        password: p.password, sni: p.sni || '', network: p.network || 'tcp',
      }};
    case 'ss':
      return { ...base, type: 'ss', raw: { cipher: p.cipher, password: p.password }};
    case 'hysteria2':
      return { ...base, type: 'hysteria2', raw: { password: p.password, sni: p.sni || '' }};
    case 'tuic':
      return { ...base, type: 'tuic', raw: { uuid: p.uuid, password: p.password, sni: p.sni || '' }};
    default:
      return null;
  }
}

// ---- main entry: parse arbitrary subscription content ----
export function parseSubscription(content) {
  if (!content) return [];
  content = content.trim();

  // Try Clash / sing-box YAML/JSON
  if (content.includes('proxies:') || content.startsWith('proxies')) {
    try {
      const doc = yamlLoad(content);
      if (doc && Array.isArray(doc.proxies)) {
        return doc.proxies.map(fromClashProxy).filter(Boolean);
      }
    } catch { /* fall through */ }
  }

  // Try base64-encoded list of uris
  let text = content;
  const firstLine = content.split(/\r?\n/)[0];
  if (!/^\w+:\/\//.test(firstLine) && isBase64(content)) {
    const decoded = b64decode(content);
    if (decoded) text = decoded;
  }

  const nodes = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || !/^\w+:\/\//.test(t)) continue;
    const n = parseUri(t);
    if (n) nodes.push(n);
  }
  return nodes;
}

// parse "userinfo" header from airport subscription response for traffic/expiry
export function parseUserInfo(header) {
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const [k, v] = part.split('=').map((s) => s?.trim());
    if (!k) continue;
    if (k === 'upload') out.upload = parseInt(v, 10);
    if (k === 'download') out.download = parseInt(v, 10);
    if (k === 'total') out.total = parseInt(v, 10);
    if (k === 'expire') out.expire = parseInt(v, 10) * 1000;
  }
  if (out.upload != null || out.download != null) {
    out.used = (out.upload || 0) + (out.download || 0);
  }
  return out;
}
