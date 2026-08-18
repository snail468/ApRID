// Pure formatting helpers for the audit trail (no DB import) so they can be
// unit-tested standalone. Used by audit.js.

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
  fetch: '拉取', reset: '重置', 'manual-reset': '手动重置', renew: '续费',
  latency: '延迟检测', restore: '恢复数据库', backup: '备份数据库',
  toggle: '切换启用', group: '分组', delete: '删除', login: '登录',
  'test-reset': '测试重置', 'airport-reset': '机场重置', 'traffic-stats': '流量统计',
  alerts: '告警检查', 'user-pull': '用户拉取', account: '修改账户', test: '测试',
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
