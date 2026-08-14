import express from 'express';
import { db } from '../db.js';
import { verifyAction } from '../services/actionToken.js';
import { runManualReset } from '../services/automation.js';
import { fetchAirport } from '../services/airport/fetch.js';
import { fmtBytes } from '../services/util.js';

// Public, login-free action pages reached from alert emails / Telegram messages.
// The signed token (see actionToken.js) is the only credential — it authorises
// exactly one action on one airport. No session, no admin API.
const router = express.Router();

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Minimal self-contained page (no external assets, works in any browser / theme).
function page(title, bodyHtml) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · ApRID</title>
<style>
  :root{color-scheme:light dark}
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif;
       background:#0f1115;color:#e6e8eb;padding:24px 14px}
  @media (prefers-color-scheme:light){body{background:#f4f5f7;color:#1a1c1f}}
  .wrap{max-width:560px;margin:0 auto}
  .card{background:#181b21;border:1px solid #2a2f37;border-radius:14px;padding:20px 18px;margin-bottom:16px}
  @media (prefers-color-scheme:light){.card{background:#fff;border-color:#e3e5e9}}
  h1{font-size:19px;margin:0 0 4px} h2{font-size:15px;margin:18px 0 8px}
  .muted{color:#8b929c;font-size:13px}
  .kv{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0}
  .kv b{min-width:64px;color:#8b929c;font-weight:500}
  code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
       background:#0f1115;border:1px solid #2a2f37;border-radius:6px;padding:2px 7px;word-break:break-all}
  @media (prefers-color-scheme:light){code,.mono{background:#f0f1f4;border-color:#e3e5e9}}
  ol{padding-left:20px;margin:8px 0} li{margin:6px 0}
  input[type=text]{width:100%;padding:11px 12px;border-radius:9px;border:1px solid #2a2f37;
       background:#0f1115;color:inherit;font-size:14px}
  @media (prefers-color-scheme:light){input[type=text]{background:#fff;border-color:#cfd3da}}
  button{cursor:pointer;border:0;border-radius:9px;padding:11px 18px;font-size:15px;font-weight:600;
       background:#3b82f6;color:#fff;margin-top:12px}
  button.gray{background:#454b55}
  a{color:#60a5fa}
  .ok{color:#34d399} .err{color:#f87171}
  .pill{display:inline-block;background:#0f1115;border:1px solid #2a2f37;border-radius:6px;padding:2px 8px;font-size:13px}
</style></head><body><div class="wrap">${bodyHtml}
<p class="muted" style="text-align:center;margin-top:22px">ApRID · 此页面通过签名链接免登录操作，请勿转发</p>
</div></body></html>`;
}

function loadAirport(res, ap) {
  if (!ap) { res.status(404).send(page('机场不存在', `<div class="card"><h1>机场不存在</h1><p class="muted">该机场可能已被删除。</p></div>`)); return null; }
  return ap;
}

function airportInfoBlock(ap) {
  const used = ap.used_traffic != null ? fmtBytes(ap.used_traffic) : '-';
  const total = ap.total_traffic != null ? fmtBytes(ap.total_traffic) : '-';
  const expire = ap.expire_at ? new Date(ap.expire_at).toLocaleString('zh-CN') : '-';
  return `
    <div class="kv"><b>机场</b><span>${esc(ap.name)}</span></div>
    ${ap.url ? `<div class="kv"><b>网址</b><a href="${esc(ap.url)}" target="_blank" rel="noreferrer">${esc(ap.url)} ↗</a></div>` : ''}
    ${ap.account ? `<div class="kv"><b>账号</b><code>${esc(ap.account)}</code></div>` : ''}
    ${ap.password ? `<div class="kv"><b>密码</b><code>${esc(ap.password)}</code></div>` : ''}
    <div class="kv"><b>用量</b><span class="pill">${used} / ${total}</span></div>
    <div class="kv"><b>到期</b><span class="pill">${expire}</span></div>`;
}

// wrap a token-gated handler: verify, load airport, then delegate
function withToken(kind, handler) {
  return async (req, res) => {
    const token = req.method === 'GET' ? req.query.token : (req.body?.token);
    let payload;
    try { payload = verifyAction(token); } catch (err) {
      return res.status(400).send(page('链接无效', `<div class="card"><h1 class="err">链接无效</h1><p class="muted">${esc(err.message)}</p></div>`));
    }
    if (payload.t !== kind) {
      return res.status(400).send(page('链接无效', `<div class="card"><h1 class="err">链接无效</h1><p class="muted">链接动作不匹配。</p></div>`));
    }
    const ap = db.prepare('SELECT * FROM airports WHERE id = ?').get(payload.ap);
    if (!loadAirport(res, ap)) return;
    return handler(req, res, ap, token);
  };
}

// ---- refill: paste a fresh subscription link (manual reset without login) ----
router.get('/refill', withToken('refill', (req, res, ap, token) => {
  res.send(page('回填订阅链接', `
    <div class="card">
      <h1>🔄 回填新订阅链接</h1>
      <p class="muted">机场反爬导致自动重置失败时，按以下步骤手动重置后把新链接粘回，面板会保存并立即拉取——全程无需登录面板。</p>
      ${airportInfoBlock(ap)}
      <h2>操作步骤</h2>
      <ol>
        <li>打开机场网址并用上面的账号密码登录。</li>
        <li>在用户中心「重置订阅 / 重置安全链接」，复制生成的<strong>新订阅链接</strong>。</li>
        <li>粘贴到下方，点「保存并拉取」。</li>
      </ol>
      ${ap.sub_url ? `<div class="kv"><b>当前链接</b><code>${esc(ap.sub_url)}</code></div>` : ''}
      <form method="post" action="/action/refill">
        <input type="hidden" name="token" value="${esc(token)}">
        <h2>新订阅链接</h2>
        <input type="text" name="sub_url" placeholder="https://机场域名/api/v1/client/subscribe?token=..." autocomplete="off" required>
        <button type="submit">保存并拉取</button>
      </form>
    </div>`));
}));

router.post('/refill', withToken('refill', async (req, res, ap) => {
  const subUrl = (req.body?.sub_url || '').trim();
  try {
    const r = await runManualReset(ap.id, subUrl);
    res.send(page('回填成功', `
      <div class="card">
        <h1 class="ok">✓ 已保存并拉取</h1>
        <p>机场「${esc(ap.name)}」新订阅链接已回填，解析 <strong>${r.count}</strong> 个节点。</p>
        <div class="kv"><b>新链接</b><code>${esc(subUrl)}</code></div>
        <p class="muted">可以关闭本页面了。</p>
      </div>`));
  } catch (err) {
    res.status(400).send(page('回填失败', `
      <div class="card">
        <h1 class="err">✗ 回填失败</h1>
        <p class="muted">${esc(err.message)}</p>
        <a href="/action/refill?token=${encodeURIComponent(req.body?.token || '')}">← 返回重试</a>
      </div>`));
  }
}));

// ---- pull: re-pull the airport subscription to refresh usage / expiry ----
router.get('/pull', withToken('pull', (req, res, ap, token) => {
  res.send(page('拉取更新机场', `
    <div class="card">
      <h1>📡 更新机场用量 / 到期</h1>
      <p class="muted">点击下方按钮，面板会向机场重新拉取一次订阅，刷新用量与到期时间——无需登录面板。</p>
      ${airportInfoBlock(ap)}
      <p class="muted">上次拉取：${ap.last_fetch_at ? new Date(ap.last_fetch_at).toLocaleString('zh-CN') : '从未'}</p>
      <form method="post" action="/action/pull">
        <input type="hidden" name="token" value="${esc(token)}">
        <button type="submit">🔄 立即拉取更新</button>
      </form>
    </div>`));
}));

router.post('/pull', withToken('pull', async (req, res, ap, token) => {
  try {
    const r = await fetchAirport(ap.id);
    const fresh = db.prepare('SELECT * FROM airports WHERE id = ?').get(ap.id);
    res.send(page('已更新', `
      <div class="card">
        <h1 class="ok">✓ 已更新</h1>
        <p>机场「${esc(ap.name)}」已重新拉取，解析 <strong>${r.count}</strong> 个节点。</p>
        ${airportInfoBlock(fresh)}
        <form method="post" action="/action/pull" style="margin-top:8px">
          <input type="hidden" name="token" value="${esc(token)}">
          <button type="submit" class="gray">再次拉取</button>
        </form>
      </div>`));
  } catch (err) {
    res.status(400).send(page('拉取失败', `
      <div class="card">
        <h1 class="err">✗ 拉取失败</h1>
        <p class="muted">${esc(err.message)}</p>
        <a href="/action/pull?token=${encodeURIComponent(token)}">← 返回重试</a>
      </div>`));
  }
}));

export default router;
