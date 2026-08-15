import express from 'express';
import qrcode from 'qrcode';
import { db } from '../db.js';
import { userStatus } from '../services/subscription/build.js';
import { FORMATS } from '../services/subscription/converters.js';
import { fmtBytes } from '../services/util.js';
import { resolveBaseUrl } from '../config.js';

// Public, login-free self-service page for end users: they open /portal/<token>
// (the same token as their subscription) and see their expiry, traffic and the
// subscription links / QR — no admin panel access. Nothing here mutates state.
const router = express.Router();

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const STATUS = {
  active: { t: '正常', c: '#34d399' }, expiring: { t: '即将到期', c: '#fbbf24' },
  expired: { t: '已过期', c: '#f87171' }, exhausted: { t: '流量用尽', c: '#f87171' },
  disabled: { t: '已停用', c: '#8b929c' },
};

function page(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
  :root{color-scheme:light dark}*{box-sizing:border-box}
  body{margin:0;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:#0f1115;color:#e6e8eb;padding:24px 14px}
  @media(prefers-color-scheme:light){body{background:#f4f5f7;color:#1a1c1f}}
  .wrap{max-width:560px;margin:0 auto}
  .card{background:#181b21;border:1px solid #2a2f37;border-radius:14px;padding:20px 18px;margin-bottom:16px}
  @media(prefers-color-scheme:light){.card{background:#fff;border-color:#e3e5e9}}
  h1{font-size:20px;margin:0 0 10px}
  .badge{display:inline-block;padding:2px 10px;border-radius:20px;color:#fff;font-size:13px}
  .kv{display:flex;justify-content:space-between;gap:8px;margin:8px 0;border-bottom:1px dashed #2a2f37;padding-bottom:8px}
  @media(prefers-color-scheme:light){.kv{border-color:#e3e5e9}}
  .kv b{color:#8b929c;font-weight:500}
  .bar{height:8px;border-radius:6px;background:#2a2f37;overflow:hidden;margin-top:6px}
  .bar>i{display:block;height:100%;background:#3b82f6}
  .muted{color:#8b929c;font-size:13px}
  .sub{display:flex;gap:8px;align-items:center;margin:8px 0}
  .sub input{flex:1;min-width:0;padding:9px 10px;border-radius:8px;border:1px solid #2a2f37;background:#0f1115;color:inherit;font-size:12px}
  @media(prefers-color-scheme:light){.sub input{background:#fff;border-color:#cfd3da}}
  .sub button{border:0;border-radius:8px;background:#3b82f6;color:#fff;padding:9px 12px;font-size:13px;cursor:pointer}
  img.qr{background:#fff;padding:10px;border-radius:10px;display:block;margin:8px auto 0}
</style></head><body><div class="wrap">${body}
<p class="muted" style="text-align:center;margin-top:20px">ApRID 订阅自助</p></div>
<script>function cp(b){var i=b.previousElementSibling;i.select();document.execCommand('copy');b.textContent='已复制';setTimeout(function(){b.textContent='复制'},1200);}</script>
</body></html>`;
}

router.get('/:token', async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE token = ?').get(req.params.token);
  if (!u) return res.status(404).send(page('订阅无效', `<div class="card"><h1>订阅无效</h1><p class="muted">链接可能已重置或失效，请联系管理员。</p></div>`));

  const st = STATUS[userStatus(u)] || STATUS.active;
  const base = resolveBaseUrl(req);
  const frag = `#${encodeURIComponent(u.name || 'ApRID')}`;
  const autoUrl = `${base}/sub/${u.token}${frag}`;
  const limit = Number(u.traffic_limit || 0);
  const used = Number(u.traffic_used || 0);
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const expire = u.expire_at ? new Date(u.expire_at).toLocaleString('zh-CN') : '永久';

  const qr = await qrcode.toDataURL(autoUrl, { width: 200, margin: 1 }).catch(() => '');
  const clientRows = Object.entries(FORMATS).map(([k, fmt]) =>
    `<div class="sub"><span class="muted" style="width:78px">${esc(fmt.name)}</span><input readonly value="${esc(`${base}/sub/${u.token}?target=${k}${frag}`)}"><button onclick="cp(this)">复制</button></div>`
  ).join('');

  res.send(page(`订阅 · ${u.name}`, `
    <div class="card">
      <h1>${esc(u.name)} <span class="badge" style="background:${st.c}">${st.t}</span></h1>
      <div class="kv"><b>到期时间</b><span>${esc(expire)}（北京时间）</span></div>
      <div class="kv"><b>已用流量</b><span>${limit > 0 ? `${fmtBytes(used)} / ${fmtBytes(limit)}` : `${fmtBytes(used)} / 不限`}</span></div>
      ${limit > 0 ? `<div class="bar"><i style="width:${pct}%;background:${pct >= 90 ? '#f87171' : '#3b82f6'}"></i></div>` : ''}
    </div>
    <div class="card">
      <h1 style="font-size:16px">扫码导入（通用）</h1>
      ${qr ? `<img class="qr" src="${qr}" width="200" height="200" alt="qr">` : ''}
      <div class="sub"><span class="muted" style="width:78px">自动</span><input readonly value="${esc(autoUrl)}"><button onclick="cp(this)">复制</button></div>
      <h1 style="font-size:16px;margin-top:14px">各客户端链接</h1>
      ${clientRows}
    </div>`));
});

export default router;
