import { ProxyAgent } from 'undici';
import { socksDispatcher } from 'fetch-socks';

// Build an undici dispatcher for an airport proxy string.
//
// undici's ProxyAgent only speaks HTTP(S) CONNECT proxies — handing it a
// `socks5://…` URL throws "Invalid URL protocol". Since the panel's proxy
// builder can emit socks5, route those through fetch-socks instead. Returns
// undefined when no proxy is set.
//
// Supported: http, https, socks5(h), socks4(a).
export function proxyDispatcher(proxy) {
  const raw = (proxy || '').trim();
  if (!raw) return undefined;

  let u;
  try { u = new URL(raw); } catch { throw new Error(`代理地址无效：${raw}（示例 http://host:port 或 socks5://host:port）`); }
  const scheme = u.protocol.replace(':', '').toLowerCase();

  if (scheme === 'http' || scheme === 'https') return new ProxyAgent(raw);

  if (scheme.startsWith('socks')) {
    return socksDispatcher({
      type: scheme.startsWith('socks4') ? 4 : 5,
      host: u.hostname,
      port: Number(u.port) || 1080,
      userId: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    });
  }

  throw new Error(`不支持的代理协议：${scheme}（支持 http/https/socks5/socks4）`);
}
