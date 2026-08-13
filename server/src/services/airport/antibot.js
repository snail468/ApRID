// Detect anti-bot / human-verification challenge pages (Cloudflare, WAFs, etc.)
//
// Many airport panels sit behind services that block automated clients and only
// let a request through after a browser-based "prove you're human" check. We
// cannot solve those headlessly here; instead we detect them and surface a clear,
// actionable error so the operator can supply a Cookie captured from a real
// browser session (see the airport "Cookie" field) or update the sub link manually.

const CHALLENGE_MARKERS = [
  'just a moment',
  'cf-chl',
  'cf_chl',
  'challenge-platform',
  'attention required',
  '_cf_chl_opt',
  'checking your browser',
  'enable javascript and cookies to continue',
  'ddos-guard',
  'ddosguard',
  'px-captcha',
  'captcha-delivery',
  'verifying you are human',
];

// Returns a human-readable reason string when the response looks like a
// challenge page, otherwise null.
export function detectChallenge(status, text = '', headers = null) {
  const server = (headers?.get?.('server') || '').toLowerCase();
  const low = (text || '').toLowerCase().slice(0, 4000);
  const hit = CHALLENGE_MARKERS.find((m) => low.includes(m));
  if (hit) return `疑似人机验证/防护拦截（匹配特征：${hit}）`;
  // Cloudflare typically answers challenges with 403/503 + a tiny HTML body
  if ((status === 403 || status === 503) && server.includes('cloudflare')) {
    return `疑似 Cloudflare 拦截（HTTP ${status}）`;
  }
  return null;
}

export const ANTIBOT_HINT =
  '该机场疑似启用了人机验证/安全防护，自动程序被拦截。处理建议：' +
  '① 换用 FlareSolverr 重置方式，并给机场配一个干净/住宅代理（FlareSolverr 与重置走同一代理）；' +
  '② 在浏览器登录后从任意接口请求头复制 Authorization，填入机场「登录令牌」跳过登录；' +
  '③ 从浏览器复制 Cookie（含 cf_clearance）填入「Cookie」字段；' +
  '④【推荐兜底】若该站按 TLS/客户端指纹识别（如魔戒等大站），以上都可能仍被拦——' +
  '把机场「自动重置方式」改为「手动重置」：自己浏览器登录重置后粘贴新链接，面板自动保存+拉取+下发，只有点一下重置是手动的。';
