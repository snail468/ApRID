import { ProxyAgent, fetch as undiciFetch } from 'undici';
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

// undici's fetch rejects network failures with a generic "fetch failed" and hides
// the real reason in error.cause. Turn it into an actionable message.
export function describeFetchError(e, url) {
  let host = url;
  try { host = new URL(url).host; } catch { /* keep raw */ }
  const c = e && e.cause;
  const bits = [];
  if (c?.code) bits.push(c.code);
  if (c?.message) bits.push(c.message);
  else if (e?.message && e.message !== 'fetch failed') bits.push(e.message);
  const detail = bits.join(' ').trim() || (e?.message || '未知错误');
  let hint = '';
  if (/ECONNREFUSED/.test(detail)) hint = '（代理/目标拒绝连接：确认代理地址端口，容器内 127.0.0.1 指容器自身而非宿主机）';
  else if (/ETIMEDOUT|ETIMEOUT|timeout/i.test(detail)) hint = '（连接超时：代理不可达或目标被墙）';
  else if (/ENOTFOUND|EAI_AGAIN/.test(detail)) hint = '（DNS 解析失败：检查代理/网址域名）';
  else if (/CERT|TLS|SSL|ALTNAME/i.test(detail)) hint = '（TLS 握手失败）';
  else if (/socks/i.test(detail)) hint = '（SOCKS 代理握手/认证失败：检查账号密码与类型）';
  return `网络请求失败（${host}）：${detail}${hint}`;
}

// fetch wrapper that surfaces the underlying cause on network failure.
//
// Uses undici's OWN fetch (not Node's global fetch). A dispatcher — especially
// the fetch-socks socks Agent — must come from the same undici instance as the
// fetch consuming it; mixing Node's built-in undici with the npm one throws
// "UND_ERR_INVALID_ARG invalid onRequestStart method". Importing fetch here from
// the same undici that builds the dispatchers keeps them compatible.
export async function xfetch(url, opts) {
  try {
    return await undiciFetch(url, opts);
  } catch (e) {
    throw new Error(describeFetchError(e, url));
  }
}
