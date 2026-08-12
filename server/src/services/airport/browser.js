import { chromium } from 'playwright-core';
import { config } from '../../config.js';

// Browser-mode airport reset.
//
// Instead of replaying HTTP requests ourselves (which breaks on Cloudflare, JS
// request-signing, or panel UI changes), we drive a *real* Chromium via CDP —
// the optional `browserless` side-car in docker-compose — and run the login +
// reset **inside the page's own JavaScript context** (`page.evaluate` → `fetch`).
//
// Why this is robust:
//   - The request is issued by the real browser at the panel's own origin, so it
//     automatically carries cf_clearance and every other cookie → passes CF.
//   - It uses the page's real fingerprint/UA, not a scripted client.
//   - It reuses whatever request-signing the panel's front-end applies, so we
//     never have to reverse-engineer X-Signature / RSA params.
//
// Only `playwright-core` ships in the image (a few MB, no bundled Chromium); the
// browser itself lives in the side-car, keeping the main image small.

function origin(url) {
  let raw = (url || '').trim();
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  const u = new URL(raw);
  return `${u.protocol}//${u.host}`;
}

function cookiesFor(cookieStr, url) {
  if (!cookieStr) return [];
  const host = new URL(url).hostname;
  return cookieStr.split(';').map((s) => s.trim()).filter(Boolean).map((pair) => {
    const i = pair.indexOf('=');
    if (i < 0) return null;
    return { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim(), domain: host, path: '/' };
  }).filter((c) => c && c.name);
}

// Reserved captcha-solver hook. Wired to config but intentionally a no-op for
// now — non-interactive CF/Turnstile is usually cleared just by loading the page
// in a real browser. To enable hard-captcha solving later, detect the sitekey
// here, call the provider API (config.captchaProvider / captchaApiKey), and
// inject the returned token into the page.
async function maybeSolveCaptcha(page, ap, log) {
  if (!config.captchaProvider || !config.captchaApiKey) return;
  log?.('（预留）已配置打码服务，但当前版本尚未启用硬验证码求解');
}

async function withBrowserPage(ap, log, fn) {
  const endpoint = (ap.cdp_endpoint || '').trim() || config.browserCdpEndpoint;
  if (!endpoint) throw new Error('未配置浏览器 CDP 端点（BROWSER_CDP_ENDPOINT 或机场「CDP 端点」）');
  log?.(`连接浏览器 CDP：${endpoint}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 30000 });
  } catch (err) {
    const hint = /ENOTFOUND|ECONNREFUSED/.test(err.message)
      ? '请用含 browserless 服务的 docker-compose.yml 一起启动（docker compose up -d），确认 `docker compose ps` 里 browserless 在运行，且 token 与端点里的 ?token= 一致'
      : '请检查 CDP 端点是否正确、browserless token 是否匹配';
    throw new Error(`无法连接浏览器服务（${endpoint}）：${err.message}。${hint}`);
  }

  const base = origin(ap.url);
  let context;
  let ownContext = false;
  try {
    // Look like a normal desktop Chrome, not headless — the default browserless
    // UA contains "HeadlessChrome", an instant Cloudflare tell.
    const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    context = await browser.newContext({
      userAgent: ap.user_agent || DESKTOP_UA,
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
      ignoreHTTPSErrors: true,
    });
    ownContext = true;
    const cookies = cookiesFor(ap.cookie, base);
    if (cookies.length) await context.addCookies(cookies);

    const page = await context.newPage();
    log?.(`打开机场首页：${base}`);
    await page.goto(base + '/', { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await waitForCloudflare(page, log);
    await maybeSolveCaptcha(page, ap, log);
    return await fn(page, base);
  } finally {
    if (ownContext && context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// After navigation, wait for Cloudflare's non-interactive challenge (「Just a
// moment…」) to auto-solve so the page picks up the cf_clearance cookie before we
// issue any API request. Reloads once mid-way in case the challenge stalls.
async function waitForCloudflare(page, log) {
  const onChallenge = async () => {
    try {
      return await page.evaluate(() => {
        const t = (document.title || '').toLowerCase();
        const b = (document.body ? document.body.innerText : '').toLowerCase().slice(0, 600);
        return t.includes('just a moment') || t.includes('attention required') ||
          b.includes('checking your browser') || b.includes('verify you are human') ||
          !!document.querySelector('#challenge-form, #cf-challenge-running, .cf-browser-verification, #turnstile-wrapper');
      });
    } catch { return false; }
  };
  if (!(await onChallenge())) return true;
  log?.('检测到 Cloudflare 挑战，等待自动通过…');
  const deadline = Date.now() + 30000;
  let reloaded = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    if (!(await onChallenge())) { log?.('✓ Cloudflare 挑战已通过'); return true; }
    if (!reloaded && Date.now() > deadline - 18000) {
      reloaded = true;
      await page.reload({ waitUntil: 'load', timeout: 45000 }).catch(() => {});
    }
  }
  log?.('⚠ Cloudflare 挑战在超时内未通过（无头浏览器可能被识别）');
  return false;
}

// The login + (optional) reset flow, executed entirely inside the page context.
// Returns a *structured* result — never throws inside the page — so the Node side
// can log every step's real HTTP status/body and give an accurate error:
//   { ok: true,  subUrl, via, changed, steps }
//   { ok: false, error, steps }
// `dryRun` = true skips the reset (used by the connection test).
function panelScript() {
  // NOTE: this function is serialized and executed *inside the browser page*.
  return async ({ mode, email, password, authToken, dryRun }) => {
    const steps = [];
    const clip = (s) => (s || '').replace(/\s+/g, ' ').slice(0, 140);
    const jreq = async (url, opts) => {
      let status = 0; let text = ''; let json = null;
      try {
        const r = await fetch(url, { credentials: 'include', ...opts });
        status = r.status; text = await r.text();
        try { json = JSON.parse(text); } catch { /* html/plain */ }
      } catch (e) { text = 'fetch error: ' + e.message; }
      return { status, text, json };
    };
    // subscribe_url can live at data.subscribe_url, or data itself may be the url
    const readSub = (j) => {
      if (j && j.data && typeof j.data === 'object' && j.data.subscribe_url) return j.data.subscribe_url;
      if (j && typeof j.data === 'string' && /^https?:/i.test(j.data)) return j.data;
      return null;
    };
    const fail = (error) => ({ ok: false, error, steps });
    const isChal = (t) => /just a moment|cf-chl|challenge-platform|attention required|checking your browser|verify you are human|enable javascript and cookies/i.test(t || '');
    const CF_HINT = '被 Cloudflare 人机验证拦截（无头浏览器未通过）。可尝试：① 换用支持反检测/有头的浏览器镜像作为 CDP 侧车；② 用与侧车「同出口IP + 同UA」抓取的 cf_clearance 填到机场 Cookie 字段；③ 为该机场配 FlareSolverr/打码服务。详见 README「浏览器模式」。';

    const v2board = async () => {
      let auth = (authToken || '').trim();
      if (auth) steps.push('鉴权：使用登录令牌');
      if (!auth) {
        const lr = await jreq('/api/v1/passport/auth/login', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        steps.push('登录 /passport/auth/login → HTTP ' + lr.status);
        if (isChal(lr.text)) return fail(CF_HINT);
        auth = (lr.json && lr.json.data && (lr.json.data.auth_data || lr.json.data.token)) || '';
        if (!auth) return fail('登录失败：' + ((lr.json && lr.json.message) || ('HTTP ' + lr.status + ' ' + clip(lr.text))) + '（V2Board/Xboard）');
      }
      const h = { authorization: auth };

      const before = await jreq('/api/v1/user/getSubscribe', { headers: h });
      const beforeUrl = readSub(before.json);
      steps.push('读取订阅(重置前) /user/getSubscribe → HTTP ' + before.status + (beforeUrl ? '，已读到链接' : '，未读到 subscribe_url'));
      if (before.status === 401 || before.status === 403) return fail('鉴权被拒 HTTP ' + before.status + '：登录令牌可能已失效');

      if (dryRun) {
        if (before.status >= 400) return fail('鉴权失败 HTTP ' + before.status);
        return { ok: true, subUrl: beforeUrl, via: 'browser/v2board', steps };
      }

      let rr = await jreq('/api/v1/user/resetSecurity', { headers: h });
      if (rr.status === 404 || rr.status === 405) rr = await jreq('/api/v1/user/resetSecurity', { method: 'POST', headers: h });
      steps.push('重置 /user/resetSecurity → HTTP ' + rr.status + ' ' + clip(rr.text));
      // business failure: JSON with a message/errors but no data
      const bizFail = rr.json && rr.json.data === undefined && (rr.json.message || rr.json.errors);
      if (rr.status < 200 || rr.status >= 300 || bizFail) {
        return fail('重置接口失败 HTTP ' + rr.status + '：' + ((rr.json && rr.json.message) || clip(rr.text) || '无响应体'));
      }
      // some builds return the url directly, most just return data:true
      let sub = (rr.json && typeof rr.json.data === 'string' && /^https?:/i.test(rr.json.data)) ? rr.json.data : null;

      const after = await jreq('/api/v1/user/getSubscribe', { headers: h });
      const afterUrl = sub || readSub(after.json);
      steps.push('读取订阅(重置后) /user/getSubscribe → HTTP ' + after.status + (afterUrl ? '，已读到链接' : '，未读到 subscribe_url'));
      if (!afterUrl) {
        return fail('重置请求已发出（HTTP ' + rr.status + '），但未能取得新订阅链接。getSubscribe.data=' +
          clip(JSON.stringify(after.json && after.json.data)) + '。可能该面板订阅端点/字段不同，请把本日志反馈以便适配');
      }
      const changed = beforeUrl != null ? (afterUrl !== beforeUrl) : null;
      return { ok: true, subUrl: afterUrl, via: 'browser/v2board', changed, steps };
    };

    const sspanel = async () => {
      const form = new URLSearchParams({ email, passwd: password, remember_me: 'on' });
      const lr = await jreq('/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(),
      });
      steps.push('登录 /auth/login → HTTP ' + lr.status);
      if (isChal(lr.text)) return fail(CF_HINT);
      if (lr.json && lr.json.ret !== undefined && lr.json.ret !== 1) {
        return fail('登录失败：' + ((lr.json && lr.json.msg) || '账号或密码错误') + '（SSPanel）');
      }
      const findSub = (t) => {
        const m = t.match(/https?:\/\/[^\s"'<>]+\/(?:link|sub|s)\/[A-Za-z0-9]+/) ||
          t.match(/(https?:\/\/[^\s"'<>]+subscribe[^\s"'<>]*)/i);
        return m ? m[0].replace(/&amp;/g, '&') : null;
      };
      if (dryRun) return { ok: true, subUrl: null, via: 'browser/sspanel', steps };

      const beforeProf = await jreq('/user');
      const beforeUrl = findSub(beforeProf.text);
      let rr = await jreq('/user/reset_URL');
      if (rr.status >= 400) rr = await jreq('/user/subscribe/reset', { method: 'POST' });
      steps.push('重置 /user/reset_URL → HTTP ' + rr.status);
      const afterProf = await jreq('/user');
      const afterUrl = findSub(afterProf.text);
      if (!afterUrl) return fail('重置请求已发出，但未能从用户中心解析到订阅链接（SSPanel）');
      const changed = beforeUrl != null ? (afterUrl !== beforeUrl) : null;
      return { ok: true, subUrl: afterUrl, via: 'browser/sspanel', changed, steps };
    };

    if (mode === 'sspanel') return sspanel();
    if (mode === 'v2board' || mode === 'xboard') return v2board();
    // generic: try v2board then sspanel
    const r1 = await v2board();
    if (r1.ok) return r1;
    steps.push('— V2Board 尝试失败，改试 SSPanel —');
    const r2 = await sspanel();
    if (r2.ok) return r2;
    return fail('通用浏览器重置失败：' + r1.error + ' ｜ ' + r2.error);
  };
}

async function runPanelScript(ap, log, dryRun) {
  return withBrowserPage(ap, log, async (page) => {
    const r = await page.evaluate(panelScript(), {
      mode: ap.panel_type,
      email: ap.account || '',
      password: ap.password || '',
      authToken: (ap.auth_token || '').trim(),
      dryRun,
    });
    for (const s of r.steps || []) log?.('· ' + s);
    if (!r.ok) throw new Error(r.error || '浏览器操作失败');
    if (!dryRun) {
      if (r.changed === false) log?.('⚠ 订阅链接与重置前一致——该面板可能重置后 URL 不变，或本次未真正生效，请留意');
      else if (r.changed === true) log?.('✓ 订阅链接已变化，重置生效');
    }
    return r;
  });
}

export async function browserReset(ap, log) {
  if (!ap.url) throw new Error('机场未配置网址');
  if (!ap.auth_token && (!ap.account || !ap.password)) {
    throw new Error('机场未配置登录账号或密码（或改用「登录令牌」直连）');
  }
  const r = await runPanelScript(ap, log, false);
  return { subUrl: r.subUrl, via: r.via };
}

// Dry-run test for browser mode: authenticate + read current subscribe_url without
// resetting. Surfaces whether the panel actually returns a subscription link.
export async function browserTest(ap) {
  if (!ap.url) throw new Error('机场未配置网址');
  const r = await runPanelScript(ap, null, true);
  return {
    ok: true, via: r.via, subUrl: r.subUrl,
    note: r.subUrl ? '浏览器鉴权成功，可读取订阅链接' : '浏览器鉴权成功，但未读到订阅链接（重置时可能无法自动回填，请留意）',
  };
}
