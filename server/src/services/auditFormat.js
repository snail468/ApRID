// Pure formatting helpers for the audit trail (no DB import) so they can be
// unit-tested standalone. Used by audit.js.
import { describeCron } from './cron.js';

// request-body keys whose values must never be stored (redacted to '***').
const SECRET_KEY = /pass|password|token|secret|otp|cookie|auth|hash|key/i;

// CN name for each top-level API resource.
const RESOURCE = {
  airports: '机场', nodes: '节点', users: '用户', templates: '模板',
  plans: '套餐', groups: '分组', settings: '设置', automation: '自动化',
  auth: '登录', audit: '审计',
};

// trailing action segment → CN verb (for POSTs that aren't plain creates).
const ACTION_WORD = {
  fetch: '拉取', reset: '重置', 'manual-reset': '手动重置', clone: '加账户', renew: '续费',
  latency: '延迟检测', restore: '恢复数据库', backup: '备份数据库',
  toggle: '切换启用', group: '分组', delete: '删除', login: '登录',
  'test-reset': '测试重置', 'airport-reset': '机场重置', 'traffic-stats': '流量统计',
  'reset-traffic': '重置流量', 'traffic-reset': '流量月度重置',
  alerts: '告警检查', 'user-pull': '用户拉取', account: '修改账户', test: '测试',
  'offsite-backup': '异地备份', run: '立即执行',
};

const VERB = { POST: '新增', PUT: '修改', DELETE: '删除', PATCH: '修改' };

// Build a 中文 summary from method + path. Pure.
// e.g. DELETE /api/users/5 -> "删除用户 #5"; POST /api/airports/3/fetch -> "机场 #3 · 拉取"
export function describeAction(method, path) {
  const segs = path.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  if (!segs.length) return `${method} ${path}`;
  const resource = RESOURCE[segs[0]] || segs[0];
  const rest = segs.slice(1);
  const id = rest.find((s) => /^\d+$/.test(s));
  const tail = rest[rest.length - 1];

  // batch/<op>
  if (rest[0] === 'batch' && rest[1]) {
    return `${resource} · 批量${ACTION_WORD[rest[1]] || rest[1]}`;
  }
  // trailing named action (non-numeric last segment)
  if (tail && !/^\d+$/.test(tail) && ACTION_WORD[tail]) {
    return id ? `${resource} #${id} · ${ACTION_WORD[tail]}` : `${resource} · ${ACTION_WORD[tail]}`;
  }
  // plain CRUD
  const verb = VERB[method] || method;
  return id ? `${verb}${resource} #${id}` : `${verb}${resource}`;
}

// ---- 自然语言解释：把 method+path+请求体 翻成一句人话，便于非技术人员看懂审计 ----
// 请求体字段 → 中文标签。未列出的字段回退为原始 key。
const FIELD_LABEL = {
  name: '名称', username: '用户名', enabled: '启用状态', expire_at: '到期时间',
  template_id: '模板', group_name: '分组', remark: '备注', token: '订阅令牌',
  traffic_limit: '流量上限', traffic_reset_day: '每月流量重置日', node_filter: '节点过滤',
  price: '价格', plan_name: '套餐', days: '时长', traffic_gb: '流量',
  url: '网址', account: '账号', account_label: '账户别名', sub_url: '订阅链接', panel_type: '面板类型',
  reset_mode: '重置方式', proxy: '代理', user_agent: 'User-Agent', cookie: 'Cookie',
  cost_amount: '成本金额', cost_cycle_days: '成本周期(天)', cost_type: '成本类型', note: '备注',
  client_type: '客户端类型', content: '模板内容', is_default: '默认模板', kind: '类型',
  value: '值', airportId: '机场', airports: '机场范围', ids: '目标', cleanup: '检测后清理死节点',
  disableDays: '到期停用阈值(天)', deleteDays: '到期删除阈值(天)', refetch: '先刷新用量',
  provider: '备份方式', method: 'HTTP 方法', keep: '保留份数', directory: '目录',
  cron: '定时', schedules: '定时任务配置', enabledOnly: '仅启用',
};

const pad2 = (n) => String(n).padStart(2, '0');
// 大于此值的数字才当作毫秒时间戳（约 2001 年后），避免把普通数字误判成日期。
const TS_MIN = 1e12;
function fmtTs(v) {
  const d = new Date(v);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtGB(bytes) {
  const gb = Number(bytes) / (1024 ** 3);
  return (gb >= 10 || Number.isInteger(gb) ? gb.toFixed(0) : gb.toFixed(2)) + ' GB';
}

// 把单个 (key,value) 渲染成 "标签→可读值"。返回 null 表示跳过（无信息量）。
function fmtPair(key, val) {
  const label = FIELD_LABEL[key] || key;
  if (val === '***') return `${label}（已更新，已脱敏）`;
  if (val == null || val === '') return null;
  if (key === 'enabled') return `${label}→${val ? '启用' : '停用'}`;
  if (typeof val === 'boolean') return `${label}→${val ? '是' : '否'}`;
  if (key === 'cron') return `${label}→${describeCron(val)}`;
  if ((key === 'expire_at' || key.endsWith('_at')) && typeof val === 'number' && val > TS_MIN) return `${label}→${fmtTs(val)}`;
  if (key === 'traffic_limit' && typeof val === 'number' && val > 0) return `${label}→${fmtGB(val)}`;
  if (key === 'ids' && Array.isArray(val)) return `${label}→${val.length} 项`;
  if (key === 'airports' && Array.isArray(val)) return `${label}→${val.length ? `${val.length} 个机场` : '全部'}`;
  if (Array.isArray(val)) return `${label}→${val.length} 项`;
  if (val && typeof val === 'object') return `${label}（已更新）`;
  const s = String(val);
  return `${label}→${s.length > 40 ? s.slice(0, 40) + '…' : s}`;
}

// Build a 中文 natural-language explanation from a stored audit row.
// row: { method, path, action, detail(JSON string|null), status }. Pure.
export function explainAudit(row = {}) {
  const { method, path = '', action, detail, status } = row;
  const base = action || describeAction(method, path);
  const failed = status != null && Number(status) >= 400;
  const suffix = failed ? '（操作失败）' : '';

  // 登录：detail 里只有用户名（密码已脱敏）
  if (path === '/api/auth/login') {
    const u = safeParse(detail)?.username;
    return `${u ? `使用账号「${u}」` : ''}尝试登录，${failed ? '登录失败（凭据错误或验证码不正确）' : '登录成功'}`;
  }

  let body = safeParse(detail);
  if (Array.isArray(body)) body = { ids: body };
  const pairs = [];
  if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body)) {
      // 跳过纯路由参数/无意义字段
      if (k === 'airportId' && (path.includes('/airport-reset') || path.includes('/test-reset'))) continue;
      const p = fmtPair(k, v);
      if (p) pairs.push(p);
      if (pairs.length >= 8) { pairs.push('…'); break; }
    }
  }
  return pairs.length ? `${base}：${pairs.join('，')}${suffix}` : `${base}${suffix}`;
}

function safeParse(s) {
  if (s == null) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}

// Redact secrets and truncate; returns a JSON string (or null). Pure.
export function sanitizeBody(body) {
  if (body == null || typeof body !== 'object' || Buffer.isBuffer(body)) return null;
  const walk = (v, depth = 0) => {
    if (depth > 4) return '…';
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = SECRET_KEY.test(k) ? '***' : walk(val, depth + 1);
      }
      return out;
    }
    if (typeof v === 'string' && v.length > 300) return v.slice(0, 300) + '…';
    return v;
  };
  try {
    const json = JSON.stringify(walk(body));
    if (!json || json === '{}' || json === '[]') return null;
    return json.length > 4000 ? json.slice(0, 4000) + '…' : json;
  } catch { return null; }
}
