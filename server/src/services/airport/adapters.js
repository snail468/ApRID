import { ProxyAgent } from 'undici';
import { detectChallenge, ANTIBOT_HINT } from './antibot.js';

const UA = (ap) => ap.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Airport subscription-reset adapters.
//
// Each adapter logs into an airport panel with the stored account/password,
// triggers a "reset subscription URL" action, and returns the new sub link.
//
// Two dominant panel families cover the vast majority of机场:
//   - V2Board / Xboard : JSON REST API under /api/v1/passport + /api/v1/user
//   - SSPanel-Uim      : form login /auth/login + /user/reset_URL (token)
//
// panel_type: 'v2board' | 'xboard' | 'sspanel'

function agent(proxy) {
  return proxy ? new ProxyAgent(proxy) : undefined;
}

function origin(url) {
  let raw = (url || '').trim();
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw; // tolerate bare host input
  const u = new URL(raw);
  return `${u.protocol}//${u.host}`;
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---------------- V2Board / Xboard ----------------
// Log in via the JSON API (usually captcha-free even when the web SPA is not)
// and return the Authorization token.
async function v2boardLogin(ap, base, dispatcher, common) {
  if (!ap.account || !ap.password) throw new Error('未配置登录账号或密码（V2Board/Xboard）');
  const loginRes = await fetch(`${base}/api/v1/passport/auth/login`, {
    method: 'POST',
    headers: common,
    dispatcher,
    body: JSON.stringify({ email: ap.account, password: ap.password }),
  });
  const loginText = await loginRes.text();
  const challenge = detectChallenge(loginRes.status, loginText, loginRes.headers);
  if (challenge) throw new Error(`${challenge}。${ANTIBOT_HINT}`);
  let login = {};
  try { login = JSON.parse(loginText); } catch { /* noop */ }
  const authData = login?.data?.auth_data || login?.data?.token;
  if (!authData) throw new Error(`登录失败：账号或密码错误（V2Board/Xboard）${login?.message ? '：' + login.message : ''}`);
  return authData;
}

// Read the current subscribe_url for an authenticated session.
async function v2boardGetSubscribe(base, authHeaders, dispatcher) {
  const infoRes = await fetch(`${base}/api/v1/user/getSubscribe`, { method: 'GET', headers: authHeaders, dispatcher });
  if (infoRes.status === 401 || infoRes.status === 403) return { unauthorized: true };
  const info = await infoRes.json().catch(() => ({}));
  return { subUrl: info?.data?.subscribe_url || null };
}

// Trigger the reset action, then confirm the new subscribe_url. Returns
// { unauthorized } when the token/session was rejected so the caller can re-login.
async function v2boardDoReset(base, auth, common, dispatcher) {
  const authHeaders = { ...common, Authorization: auth };
  delete authHeaders['Content-Type'];

  // resetSecurity is GET on stock V2Board; some forks expose it as POST.
  let res = await fetch(`${base}/api/v1/user/resetSecurity`, { method: 'GET', headers: authHeaders, dispatcher });
  if (res.status === 405) {
    res = await fetch(`${base}/api/v1/user/resetSecurity`, { method: 'POST', headers: authHeaders, dispatcher });
  }
  if (res.status === 401 || res.status === 403) return { unauthorized: true };
  const reset = await res.json().catch(() => ({}));
  let subUrl = typeof reset?.data === 'string' ? reset.data : null;

  if (!subUrl) {
    const info = await v2boardGetSubscribe(base, authHeaders, dispatcher);
    if (info.unauthorized) return { unauthorized: true };
    subUrl = info.subUrl;
  }
  return { subUrl };
}

async function v2boardReset(ap) {
  const base = origin(ap.url);
  const dispatcher = agent(ap.proxy);
  const common = { 'Content-Type': 'application/json', 'User-Agent': UA(ap) };
  if (ap.cookie) common.Cookie = ap.cookie;

  // Token-first: a browser-captured Authorization skips the login step, which is
  // where anti-bot/captcha usually blocks.
  const haveCreds = !!(ap.account && ap.password);
  let authData = (ap.auth_token || '').trim() || null;
  let usedToken = !!authData;
  if (!authData) authData = await v2boardLogin(ap, base, dispatcher, common);

  let r = await v2boardDoReset(base, authData, common, dispatcher);

  // Stored token expired? Fall back to a fresh login (once) and retry.
  if (r.unauthorized && usedToken && haveCreds) {
    authData = await v2boardLogin(ap, base, dispatcher, common);
    usedToken = false;
    r = await v2boardDoReset(base, authData, common, dispatcher);
  }
  if (r.unauthorized) {
    throw new Error(usedToken
      ? '登录令牌无效或已过期（V2Board/Xboard），请在浏览器重新复制 Authorization，或填写账号密码以便自动登录'
      : '会话被拒绝（V2Board/Xboard）');
  }
  if (!r.subUrl) throw new Error('重置成功但未获取到新订阅链接（V2Board/Xboard）');
  return { subUrl: r.subUrl };
}

// ---------------- SSPanel-Uim ----------------
async function sspanelReset(ap) {
  const base = origin(ap.url);
  const dispatcher = agent(ap.proxy);
  let cookie = '';

  const captureCookie = (res) => {
    const sc = res.headers.getSetCookie?.() || [];
    const parsed = sc.map((c) => c.split(';')[0]).join('; ');
    if (parsed) cookie = cookie ? `${cookie}; ${parsed}` : parsed;
  };

  if (ap.cookie) cookie = ap.cookie;

  // 1. form login
  const form = new URLSearchParams({ email: ap.account, passwd: ap.password, remember_me: 'on' });
  const loginHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': UA(ap),
  };
  if (ap.cookie) loginHeaders.Cookie = ap.cookie;
  const loginRes = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: loginHeaders,
    dispatcher,
    body: form.toString(),
    redirect: 'manual',
  });
  captureCookie(loginRes);
  const loginText = await loginRes.text();
  const challenge = detectChallenge(loginRes.status, loginText, loginRes.headers);
  if (challenge) throw new Error(`${challenge}。${ANTIBOT_HINT}`);
  let loginJson = {};
  try { loginJson = JSON.parse(loginText); } catch { /* html response */ }
  if (loginJson.ret !== undefined && loginJson.ret !== 1 && !cookie) {
    throw new Error(`登录失败：${loginJson.msg || '账号或密码错误'}（SSPanel）`);
  }

  const authHeaders = { 'User-Agent': UA(ap), Cookie: cookie };

  // 2. reset subscription token
  const resetRes = await fetch(`${base}/user/reset_URL`, {
    method: 'GET',
    headers: authHeaders,
    dispatcher,
  }).catch(() => null);
  // some SSPanel forks use POST /user/subscribe/reset — best-effort fallback
  if (!resetRes || resetRes.status >= 400) {
    await fetch(`${base}/user/subscribe/reset`, { method: 'POST', headers: authHeaders, dispatcher }).catch(() => null);
  }

  // 3. read profile page to extract the new subscription link
  const profRes = await fetch(`${base}/user`, { headers: authHeaders, dispatcher });
  const html = await profRes.text();
  const m =
    html.match(/https?:\/\/[^\s"'<>]+\/(?:link|sub|s)\/[A-Za-z0-9]+/) ||
    html.match(/(https?:\/\/[^\s"'<>]+subscribe[^\s"'<>]*)/i);
  const subUrl = m ? m[0].replace(/&amp;/g, '&') : null;
  if (!subUrl) throw new Error('重置成功但未能从用户中心解析到订阅链接（SSPanel），请手动更新');
  return { subUrl };
}

// ---------------- Generic (auto-detect) ----------------
// Best-effort universal reset: probe the two dominant panel families in turn
// and use whichever login succeeds. Suitable when the panel type is unknown or
// a lightly-modified fork. Collects each attempt's error for diagnostics.
async function genericReset(ap) {
  const attempts = [
    ['V2Board/Xboard', v2boardReset],
    ['SSPanel', sspanelReset],
  ];
  const errors = [];
  for (const [label, fn] of attempts) {
    try {
      const r = await fn(ap);
      if (r?.subUrl) return { ...r, detected: label };
    } catch (err) {
      errors.push(`${label}: ${err.message}`);
    }
  }
  throw new Error(`通用适配器未能识别面板类型，尝试记录：\n${errors.join('\n')}`);
}

// ---------------- Panel type auto-detection ----------------
// Best-effort: probe the airport site to guess which panel family it runs, so
// the operator doesn't have to know it up front. Returns { panel_type, detail }.
export async function detectPanelType(rawUrl, { proxy, cookie, userAgent } = {}) {
  if (!rawUrl || !rawUrl.trim()) throw new Error('请先填写机场网址');
  const base = origin(rawUrl);
  const dispatcher = agent(proxy);
  const headers = { 'User-Agent': userAgent || BROWSER_UA };
  if (cookie) headers.Cookie = cookie;

  // 1) V2Board / Xboard expose a guest config JSON endpoint
  try {
    const res = await fetch(`${base}/api/v1/guest/comm/config`, { headers, dispatcher });
    if (res.ok) {
      const txt = await res.text();
      try {
        const j = JSON.parse(txt);
        if (j && j.data !== undefined) {
          const isX = JSON.stringify(j).toLowerCase().includes('xboard');
          return { panel_type: isX ? 'xboard' : 'v2board', detail: '匹配 V2Board/Xboard API（/api/v1/guest/comm/config）' };
        }
      } catch { /* not json */ }
    }
  } catch { /* ignore, fall through */ }

  // 2) Fetch homepage and scan for fingerprints
  let html = '';
  let res;
  try {
    res = await fetch(base, { headers, dispatcher, redirect: 'follow' });
    html = (await res.text()).slice(0, 20000);
  } catch (e) {
    throw new Error(`无法访问机场网址：${e.message}`);
  }
  const challenge = detectChallenge(res.status, html, res.headers);
  if (challenge) throw new Error(`${challenge}。${ANTIBOT_HINT}`);

  const low = html.toLowerCase();
  if (low.includes('sspanel')) return { panel_type: 'sspanel', detail: '页面特征匹配 SSPanel-Uim' };
  if (low.includes('xboard')) return { panel_type: 'xboard', detail: '页面特征匹配 Xboard' };
  if (low.includes('v2board')) return { panel_type: 'v2board', detail: '页面特征匹配 V2Board' };
  // SSPanel classic login form uses a `passwd` field
  if (low.includes('name="passwd"') || low.includes("name='passwd'")) {
    return { panel_type: 'sspanel', detail: '登录表单含 passwd 字段，疑似 SSPanel' };
  }
  // V2Board/Xboard SPA shell
  if (/id=["']app["']/.test(low) && (low.includes('window.settings') || low.includes('/assets/') || low.includes('/theme/'))) {
    return { panel_type: 'v2board', detail: '页面结构疑似 V2Board/Xboard 单页应用' };
  }
  return { panel_type: 'generic', detail: '未能确定面板类型，已回退为「通用（自动识别）」' };
}

// ---------------- Connection test (dry run, no reset) ----------------
// Verifies we can authenticate against the panel and read the current
// subscription link, WITHOUT invalidating anything. Lets operators confirm the
// airport's account / token / cookie / proxy are usable before relying on the
// automated reset. Returns { ok, subUrl, via, note }.
async function v2boardTest(ap) {
  const base = origin(ap.url);
  const dispatcher = agent(ap.proxy);
  const common = { 'Content-Type': 'application/json', 'User-Agent': UA(ap) };
  if (ap.cookie) common.Cookie = ap.cookie;

  let authData = (ap.auth_token || '').trim() || null;
  let via = authData ? '登录令牌' : '账号密码登录';
  if (!authData) authData = await v2boardLogin(ap, base, dispatcher, common);
  const authHeaders = { ...common, Authorization: authData };
  delete authHeaders['Content-Type'];

  let info = await v2boardGetSubscribe(base, authHeaders, dispatcher);
  if (info.unauthorized && ap.account && ap.password) {
    authData = await v2boardLogin(ap, base, dispatcher, common);
    via = '账号密码登录（令牌已失效）';
    info = await v2boardGetSubscribe(base, { ...common, Authorization: authData }, dispatcher);
  }
  if (info.unauthorized) throw new Error('鉴权失败：登录令牌无效/过期，且无可用账号密码');
  return { ok: true, via, subUrl: info.subUrl || null, note: info.subUrl ? '鉴权成功，可读取订阅链接' : '鉴权成功，但未读取到订阅链接' };
}

async function sspanelTest(ap) {
  const base = origin(ap.url);
  const dispatcher = agent(ap.proxy);
  const form = new URLSearchParams({ email: ap.account, passwd: ap.password, remember_me: 'on' });
  const loginHeaders = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA(ap) };
  if (ap.cookie) loginHeaders.Cookie = ap.cookie;
  const loginRes = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: loginHeaders, dispatcher, body: form.toString(), redirect: 'manual',
  });
  const loginText = await loginRes.text();
  const challenge = detectChallenge(loginRes.status, loginText, loginRes.headers);
  if (challenge) throw new Error(`${challenge}。${ANTIBOT_HINT}`);
  let loginJson = {};
  try { loginJson = JSON.parse(loginText); } catch { /* html */ }
  const cookieSet = (loginRes.headers.getSetCookie?.() || []).length > 0 || !!ap.cookie;
  if (loginJson.ret !== undefined && loginJson.ret !== 1 && !cookieSet) {
    throw new Error(`登录失败：${loginJson.msg || '账号或密码错误'}（SSPanel）`);
  }
  return { ok: true, via: '账号密码登录', subUrl: null, note: '登录成功（SSPanel）；重置链接需实际运行才能确认' };
}

export async function testAirportConnection(ap) {
  if (!ap.url) throw new Error('机场未配置网址');
  if (!ap.auth_token && (!ap.account || !ap.password)) {
    throw new Error('机场未配置登录账号或密码（或改用「登录令牌」直连）');
  }
  switch (ap.panel_type) {
    case 'v2board':
    case 'xboard':
      return v2boardTest(ap);
    case 'sspanel':
      return sspanelTest(ap);
    case 'generic': {
      const errors = [];
      for (const [label, fn] of [['V2Board/Xboard', v2boardTest], ['SSPanel', sspanelTest]]) {
        try { const r = await fn(ap); if (r?.ok) return { ...r, detected: label }; }
        catch (err) { errors.push(`${label}: ${err.message}`); }
      }
      throw new Error(`通用适配器测试均失败：\n${errors.join('\n')}`);
    }
    default:
      throw new Error(`不支持的面板类型：${ap.panel_type}`);
  }
}

export async function resetAirportSubscription(ap) {
  if (!ap.url) throw new Error('机场未配置网址');
  if (!ap.auth_token && (!ap.account || !ap.password)) {
    throw new Error('机场未配置登录账号或密码（或改用「登录令牌」直连）');
  }
  switch (ap.panel_type) {
    case 'v2board':
    case 'xboard':
      return v2boardReset(ap);
    case 'sspanel':
      return sspanelReset(ap);
    case 'generic':
      return genericReset(ap);
    default:
      throw new Error(`不支持的面板类型：${ap.panel_type}（可选 generic / v2board / xboard / sspanel）`);
  }
}
