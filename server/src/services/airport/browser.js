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
    context = await browser.newContext({ userAgent: ap.user_agent || undefined, ignoreHTTPSErrors: true });
    ownContext = true;
    const cookies = cookiesFor(ap.cookie, base);
    if (cookies.length) await context.addCookies(cookies);

    const page = await context.newPage();
    log?.(`打开机场首页：${base}`);
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await maybeSolveCaptcha(page, ap, log);
    return await fn(page, base);
  } finally {
    if (ownContext && context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// Runs login + reset entirely inside the page context. Returns { subUrl, via }.
// `mode` selects which panel family's endpoints to try.
function inPageResetScript() {
  // NOTE: this function is serialized and executed *inside the browser page*.
  return async ({ mode, email, password, authToken }) => {
    const jget = async (url, opts) => {
      const r = await fetch(url, { credentials: 'include', ...opts });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch { /* html */ }
      return { status: r.status, text, json };
    };

    const v2board = async () => {
      let auth = (authToken || '').trim();
      if (!auth) {
        const lr = await jget('/api/v1/passport/auth/login', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        auth = lr.json?.data?.auth_data || lr.json?.data?.token || '';
        if (!auth) throw new Error('登录失败：账号或密码错误（V2Board/Xboard）');
      }
      // reset then confirm
      let rr = await jget('/api/v1/user/resetSecurity', { headers: { authorization: auth } });
      if (rr.status === 405) rr = await jget('/api/v1/user/resetSecurity', { method: 'POST', headers: { authorization: auth } });
      let sub = typeof rr.json?.data === 'string' ? rr.json.data : null;
      if (!sub) {
        const info = await jget('/api/v1/user/getSubscribe', { headers: { authorization: auth } });
        sub = info.json?.data?.subscribe_url || null;
      }
      if (!sub) throw new Error('重置成功但未取得订阅链接（V2Board/Xboard）');
      return { subUrl: sub, via: 'browser/v2board' };
    };

    const sspanel = async () => {
      const form = new URLSearchParams({ email, passwd: password, remember_me: 'on' });
      const lr = await jget('/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(),
      });
      if (lr.json && lr.json.ret !== undefined && lr.json.ret !== 1) {
        throw new Error('登录失败：' + (lr.json.msg || '账号或密码错误') + '（SSPanel）');
      }
      await jget('/user/reset_URL').catch(() => {});
      await jget('/user/subscribe/reset', { method: 'POST' }).catch(() => {});
      const prof = await jget('/user');
      const m = prof.text.match(/https?:\/\/[^\s"'<>]+\/(?:link|sub|s)\/[A-Za-z0-9]+/) ||
        prof.text.match(/(https?:\/\/[^\s"'<>]+subscribe[^\s"'<>]*)/i);
      const sub = m ? m[0].replace(/&amp;/g, '&') : null;
      if (!sub) throw new Error('重置成功但未能解析订阅链接（SSPanel）');
      return { subUrl: sub, via: 'browser/sspanel' };
    };

    if (mode === 'sspanel') return sspanel();
    if (mode === 'v2board' || mode === 'xboard') return v2board();
    // generic: try both
    const errs = [];
    for (const fn of [v2board, sspanel]) {
      try { return await fn(); } catch (e) { errs.push(e.message); }
    }
    throw new Error('通用浏览器重置失败：' + errs.join(' | '));
  };
}

export async function browserReset(ap, log) {
  if (!ap.url) throw new Error('机场未配置网址');
  if (!ap.auth_token && (!ap.account || !ap.password)) {
    throw new Error('机场未配置登录账号或密码（或改用「登录令牌」直连）');
  }
  return withBrowserPage(ap, log, async (page) => {
    const r = await page.evaluate(inPageResetScript(), {
      mode: ap.panel_type,
      email: ap.account || '',
      password: ap.password || '',
      authToken: (ap.auth_token || '').trim(),
    });
    log?.(`浏览器上下文重置完成（${r.via}）`);
    return { subUrl: r.subUrl, via: r.via };
  });
}

// Dry-run test for browser mode: log in + read the current subscribe_url without
// resetting.
export async function browserTest(ap) {
  if (!ap.url) throw new Error('机场未配置网址');
  return withBrowserPage(ap, null, async (page) => {
    const r = await page.evaluate(async ({ mode, email, password, authToken }) => {
      const jget = async (url, opts) => {
        const res = await fetch(url, { credentials: 'include', ...opts });
        const text = await res.text();
        let json = null; try { json = JSON.parse(text); } catch { /* html */ }
        return { status: res.status, text, json };
      };
      const v2 = async () => {
        let auth = (authToken || '').trim();
        if (!auth) {
          const lr = await jget('/api/v1/passport/auth/login', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
          });
          auth = lr.json?.data?.auth_data || lr.json?.data?.token || '';
          if (!auth) throw new Error('登录失败（V2Board/Xboard）');
        }
        const info = await jget('/api/v1/user/getSubscribe', { headers: { authorization: auth } });
        return { subUrl: info.json?.data?.subscribe_url || null, via: 'browser/v2board' };
      };
      const ss = async () => {
        const form = new URLSearchParams({ email, passwd: password, remember_me: 'on' });
        const lr = await jget('/auth/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
        if (lr.json && lr.json.ret !== undefined && lr.json.ret !== 1) throw new Error('登录失败（SSPanel）');
        return { subUrl: null, via: 'browser/sspanel' };
      };
      if (mode === 'sspanel') return ss();
      if (mode === 'v2board' || mode === 'xboard') return v2();
      const errs = [];
      for (const fn of [v2, ss]) { try { return await fn(); } catch (e) { errs.push(e.message); } }
      throw new Error('通用浏览器测试失败：' + errs.join(' | '));
    }, { mode: ap.panel_type, email: ap.account || '', password: ap.password || '', authToken: (ap.auth_token || '').trim() });
    return { ok: true, via: r.via, subUrl: r.subUrl, note: r.subUrl ? '浏览器鉴权成功，可读取订阅链接' : '浏览器鉴权成功' };
  });
}
