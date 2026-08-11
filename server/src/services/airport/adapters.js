import { ProxyAgent } from 'undici';

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
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

// ---------------- V2Board / Xboard ----------------
async function v2boardReset(ap) {
  const base = origin(ap.url);
  const dispatcher = agent(ap.proxy);
  const common = { 'Content-Type': 'application/json', 'User-Agent': 'ApRID/1.0' };

  // 1. login -> auth_data token
  const loginRes = await fetch(`${base}/api/v1/passport/auth/login`, {
    method: 'POST',
    headers: common,
    dispatcher,
    body: JSON.stringify({ email: ap.account, password: ap.password }),
  });
  const login = await loginRes.json().catch(() => ({}));
  const authData = login?.data?.auth_data || login?.data?.token;
  if (!authData) throw new Error('登录失败：账号或密码错误（V2Board）');
  const authHeaders = { ...common, Authorization: authData };

  // 2. reset subscribe url
  const resetRes = await fetch(`${base}/api/v1/user/resetSecurity`, {
    method: 'GET',
    headers: authHeaders,
    dispatcher,
  });
  const reset = await resetRes.json().catch(() => ({}));
  let subUrl = typeof reset?.data === 'string' ? reset.data : null;

  // 3. fetch subscribe info to confirm the new url if reset didn't return one
  if (!subUrl) {
    const infoRes = await fetch(`${base}/api/v1/user/getSubscribe`, {
      method: 'GET',
      headers: authHeaders,
      dispatcher,
    });
    const info = await infoRes.json().catch(() => ({}));
    subUrl = info?.data?.subscribe_url;
  }
  if (!subUrl) throw new Error('重置成功但未获取到新订阅链接（V2Board）');
  return { subUrl };
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

  // 1. form login
  const form = new URLSearchParams({ email: ap.account, passwd: ap.password, remember_me: 'on' });
  const loginRes = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'ApRID/1.0',
    },
    dispatcher,
    body: form.toString(),
    redirect: 'manual',
  });
  captureCookie(loginRes);
  const loginJson = await loginRes.json().catch(() => ({}));
  if (loginJson.ret !== undefined && loginJson.ret !== 1 && !cookie) {
    throw new Error(`登录失败：${loginJson.msg || '账号或密码错误'}（SSPanel）`);
  }

  const authHeaders = { 'User-Agent': 'ApRID/1.0', Cookie: cookie };

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

export async function resetAirportSubscription(ap) {
  if (!ap.url) throw new Error('机场未配置网址');
  if (!ap.account || !ap.password) throw new Error('机场未配置登录账号或密码');
  switch (ap.panel_type) {
    case 'v2board':
    case 'xboard':
      return v2boardReset(ap);
    case 'sspanel':
      return sspanelReset(ap);
    default:
      throw new Error(`不支持的面板类型：${ap.panel_type}（可选 v2board / xboard / sspanel）`);
  }
}
