import nodemailer from 'nodemailer';
import { getSetting, setSetting } from '../db.js';
import { config } from '../config.js';
import { actionUrl } from './actionToken.js';
import { fmtBytes } from './util.js';

// ---- config (stored as one JSON blob in the settings table) ----
const KEY = 'notify_config';

const DEFAULTS = {
  email: { enabled: false, host: '', port: 465, secure: true, user: '', pass: '', from: '', to: '' },
  telegram: { enabled: false, botToken: '', chatId: '' },
  panelBaseUrl: '',      // absolute URL used to build magic links from the scheduler (no req)
  userAlerts: true,      // 用户到期/超限 告警开关
  airportAlerts: true,   // 机场用量≥99%/即将到期 告警开关
  cooldownHours: 24,     // resend the same alert key at most once per this window
};

export function getNotifyConfig() {
  let stored = {};
  try { stored = JSON.parse(getSetting(KEY, '{}')) || {}; } catch { stored = {}; }
  return {
    ...DEFAULTS,
    ...stored,
    email: { ...DEFAULTS.email, ...(stored.email || {}) },
    telegram: { ...DEFAULTS.telegram, ...(stored.telegram || {}) },
  };
}

// Save a partial patch. A blank password/token means "keep the existing secret"
// (the GET endpoint never returns real secrets, only a placeholder).
export function saveNotifyConfig(patch = {}) {
  const cur = getNotifyConfig();
  const next = {
    ...cur,
    ...patch,
    email: { ...cur.email, ...(patch.email || {}) },
    telegram: { ...cur.telegram, ...(patch.telegram || {}) },
  };
  if (patch.email && (patch.email.pass === '' || patch.email.pass == null)) next.email.pass = cur.email.pass;
  if (patch.telegram && (patch.telegram.botToken === '' || patch.telegram.botToken == null)) {
    next.telegram.botToken = cur.telegram.botToken;
  }
  setSetting(KEY, JSON.stringify(next));
  return getNotifyConfig();
}

// The config safe to hand to the frontend: secrets masked to a placeholder so the
// UI can show "已配置" without leaking the value.
const MASK = '••••••••';
export function getNotifyConfigMasked() {
  const c = getNotifyConfig();
  return {
    ...c,
    email: { ...c.email, pass: c.email.pass ? MASK : '' },
    telegram: { ...c.telegram, botToken: c.telegram.botToken ? MASK : '' },
  };
}
// Strip the mask placeholder back to blank before saving so it means "unchanged".
export function unmaskPatch(patch = {}) {
  const p = { ...patch, email: { ...(patch.email || {}) }, telegram: { ...(patch.telegram || {}) } };
  if (p.email.pass === MASK) delete p.email.pass;
  if (p.telegram.botToken === MASK) delete p.telegram.botToken;
  return p;
}

export function panelBaseUrl() {
  return (getNotifyConfig().panelBaseUrl || config.publicBaseUrl || '').replace(/\/$/, '');
}

// ---- channel senders ----
async function sendEmail(cfg, subject, html) {
  const e = cfg.email;
  if (!e.enabled) return { channel: 'email', skipped: true };
  if (!e.host || !e.to) throw new Error('邮件未配置完整（缺少 SMTP 主机或收件人）');
  const transport = nodemailer.createTransport({
    host: e.host,
    port: Number(e.port) || 465,
    secure: e.secure !== false,
    auth: e.user ? { user: e.user, pass: e.pass } : undefined,
  });
  await transport.sendMail({ from: e.from || e.user, to: e.to, subject, html });
  return { channel: 'email', ok: true };
}

async function sendTelegram(cfg, text, buttons) {
  const t = cfg.telegram;
  if (!t.enabled) return { channel: 'telegram', skipped: true };
  if (!t.botToken || !t.chatId) throw new Error('Telegram 未配置完整（缺少 Bot Token 或 Chat ID）');
  const body = {
    chat_id: t.chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (buttons?.length) body.reply_markup = { inline_keyboard: buttons.map((b) => [{ text: b.text, url: b.url }]) };
  const res = await fetch(`https://api.telegram.org/bot${t.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`Telegram 发送失败：${data.description || res.status}`);
  return { channel: 'telegram', ok: true };
}

// Send to every enabled channel. Never throws — returns per-channel results so
// the alert loop keeps going even if one channel is down.
export async function notify({ subject, html, text, buttons }) {
  const cfg = getNotifyConfig();
  const out = [];
  for (const fn of [
    () => sendEmail(cfg, subject, html),
    () => sendTelegram(cfg, text, buttons),
  ]) {
    try { out.push(await fn()); }
    catch (err) { out.push({ ok: false, error: err.message }); }
  }
  return out;
}

// Used by the "发送测试" button — surfaces errors so the operator can fix config.
export async function sendTestNotification() {
  const cfg = getNotifyConfig();
  const subject = 'ApRID 测试通知';
  const html = '<p>这是一条来自 ApRID 的测试通知。若你收到它，说明告警渠道配置正确。 ✅</p>';
  const text = 'ApRID 测试通知：若你收到它，说明告警渠道配置正确。 ✅';
  const results = [];
  const active = [];
  if (cfg.email.enabled) active.push('email');
  if (cfg.telegram.enabled) active.push('telegram');
  if (!active.length) throw new Error('没有启用任何通知渠道');
  if (cfg.email.enabled) { try { results.push(await sendEmail(cfg, subject, html)); } catch (e) { throw new Error(`邮件：${e.message}`); } }
  if (cfg.telegram.enabled) { try { results.push(await sendTelegram(cfg, text)); } catch (e) { throw new Error(`Telegram：${e.message}`); } }
  return results;
}

// ---- alert content builders ----
function airportUsageLine(ap) {
  const used = ap.used_traffic != null ? fmtBytes(ap.used_traffic) : '-';
  const total = ap.total_traffic != null ? fmtBytes(ap.total_traffic) : '-';
  const expire = ap.expire_at ? new Date(ap.expire_at).toLocaleDateString('zh-CN') : '-';
  return { used, total, expire };
}

// User about to expire (≤ 1 day) → just remind the operator to nudge the user to
// renew. No airport reset involved, so no manual-reset steps / refill links.
export function buildUserExpiringAlert(user) {
  const expireAt = Number(user.expire_at);
  const left = Math.max(0, expireAt - Date.now());
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const remain = h > 0 ? `约 ${h} 小时${m ? ` ${m} 分` : ''}` : `约 ${m} 分钟`;
  const expireStr = new Date(expireAt).toLocaleString('zh-CN');
  const subject = `⚠ 用户「${user.name}」即将到期（≤1天）`;
  const html = `
    <div style="font-family:sans-serif;max-width:600px">
      <h2>⚠ 用户「${escapeHtml(user.name)}」即将到期</h2>
      <p>该用户订阅将在 <b>${escapeHtml(remain)}</b> 后到期，请提醒其<strong>续费</strong>。</p>
      <div><b>到期时间：</b>${escapeHtml(expireStr)}</div>
      ${user.remark ? `<div><b>备注：</b>${escapeHtml(user.remark)}</div>` : ''}
    </div>`;
  const text = `⚠ 用户「${user.name}」即将到期（≤1天）\n将在${remain}后到期，请提醒其续费。\n到期时间：${expireStr}` +
    (user.remark ? `\n备注：${user.remark}` : '');
  return { subject, html, text, buttons: [] };
}

// User expired / traffic exhausted → operator needs to (manually) reset the
// airports this user pulls from, then refill the fresh link. One refill link per
// airport, opening the login-free page.
export function buildUserAlert(user, airports, base = panelBaseUrl()) {
  if (user.__reason === 'expiring') return buildUserExpiringAlert(user);
  const reason = user.__reason === 'expired' ? '已到期' : '流量已用完';
  const subject = `⚠ 用户「${user.name}」${reason}`;
  const buttons = [];
  const blocksHtml = airports.map((ap) => {
    const link = base ? actionUrl(base, { t: 'refill', ap: ap.id }) : '';
    if (link) buttons.push({ text: `回填「${ap.name}」`, url: link });
    return `
      <div style="border:1px solid #ddd;border-radius:8px;padding:12px;margin:10px 0">
        <div><b>机场：</b>${escapeHtml(ap.name)}</div>
        ${ap.url ? `<div><b>网址：</b><a href="${escapeHtml(ap.url)}">${escapeHtml(ap.url)}</a></div>` : ''}
        ${ap.account ? `<div><b>账号：</b>${escapeHtml(ap.account)}</div>` : ''}
        ${ap.password ? `<div><b>密码：</b>${escapeHtml(ap.password)}</div>` : ''}
        ${link ? `<div style="margin-top:8px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#3b82f6;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">🔄 回填新订阅链接（免登录）</a></div>` : ''}
      </div>`;
  }).join('');
  const html = `
    <div style="font-family:sans-serif;max-width:600px">
      <h2>⚠ 用户「${escapeHtml(user.name)}」${reason}</h2>
      <p>请手动重置以下机场并回填新订阅链接（点按钮即可，无需登录面板）：</p>
      <ol><li>用下面的账号密码登录机场</li><li>在机场用户中心「重置订阅」，复制新链接</li><li>点「回填新订阅链接」粘贴保存</li></ol>
      ${blocksHtml || '<p>（该用户未绑定任何机场）</p>'}
    </div>`;
  const text = `⚠ 用户「${user.name}」${reason}\n请手动重置其下机场并回填新订阅链接：\n` +
    airports.map((ap) => {
      const link = base ? actionUrl(base, { t: 'refill', ap: ap.id }) : '（未配置面板地址，无法生成免登录链接）';
      return `\n机场：${ap.name}\n网址：${ap.url || '-'}\n账号：${ap.account || '-'}  密码：${ap.password || '-'}\n回填链接：${link}`;
    }).join('\n');
  return { subject, html, text, buttons };
}

// Airport near-full / near-expiry → operator should pull it to refresh the
// numbers (and, if the airport reset, refill the fresh link).
export function buildAirportAlert(airport, reasons, base = panelBaseUrl()) {
  const { used, total, expire } = airportUsageLine(airport);
  const reasonText = reasons.join('、');
  const subject = `⚠ 机场「${airport.name}」${reasonText}`;
  const pull = base ? actionUrl(base, { t: 'pull', ap: airport.id }) : '';
  const refill = base ? actionUrl(base, { t: 'refill', ap: airport.id }) : '';
  const buttons = [];
  if (pull) buttons.push({ text: '🔄 拉取更新用量/到期', url: pull });
  if (refill) buttons.push({ text: '↻ 回填新订阅链接', url: refill });
  const html = `
    <div style="font-family:sans-serif;max-width:600px">
      <h2>⚠ 机场「${escapeHtml(airport.name)}」${escapeHtml(reasonText)}</h2>
      ${airport.url ? `<div><b>网址：</b><a href="${escapeHtml(airport.url)}">${escapeHtml(airport.url)}</a></div>` : ''}
      ${airport.account ? `<div><b>账号：</b>${escapeHtml(airport.account)}</div>` : ''}
      ${airport.password ? `<div><b>密码：</b>${escapeHtml(airport.password)}</div>` : ''}
      <div><b>用量：</b>${used} / ${total}　<b>到期：</b>${expire}</div>
      ${pull ? `<div style="margin-top:12px"><a href="${escapeHtml(pull)}" style="display:inline-block;background:#3b82f6;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">🔄 拉取更新用量/到期（免登录）</a></div>` : ''}
      ${refill ? `<div style="margin-top:8px"><a href="${escapeHtml(refill)}" style="display:inline-block;background:#454b55;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">↻ 回填新订阅链接</a></div>` : ''}
    </div>`;
  const text = `⚠ 机场「${airport.name}」${reasonText}\n网址：${airport.url || '-'}\n账号：${airport.account || '-'}  密码：${airport.password || '-'}\n用量：${used} / ${total}　到期：${expire}\n` +
    (pull ? `\n拉取更新：${pull}` : '') + (refill ? `\n回填链接：${refill}` : '');
  return { subject, html, text, buttons };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
