import { db } from '../db.js';
import { resetAirportSubscription } from './airport/adapters.js';
import { fetchAirport } from './airport/fetch.js';
import { fmtBytes } from './util.js';
import { maybeSendUserAlert, maybeSendAirportAlert, maybeSendUserSecurityAlert } from './alerts.js';
import { pingDedupAndRecord } from './nodeHealth.js';

function createTask(type, refId) {
  const now = Date.now();
  const info = db.prepare('INSERT INTO tasks (type, ref_id, status, log, created_at) VALUES (?,?,?,?,?)')
    .run(type, refId, 'running', '', now);
  return info.lastInsertRowid;
}

function appendLog(taskId, line) {
  const row = db.prepare('SELECT log FROM tasks WHERE id = ?').get(taskId);
  const log = (row?.log || '') + `[${new Date().toISOString()}] ${line}\n`;
  db.prepare('UPDATE tasks SET log = ? WHERE id = ?').run(log, taskId);
}

function finishTask(taskId, status) {
  db.prepare('UPDATE tasks SET status = ?, finished_at = ? WHERE id = ?').run(status, Date.now(), taskId);
}

// Full "机场订阅自动化重置" pipeline:
// login -> reset -> write back new sub_url -> fetch/pull once.
export async function runAirportReset(airportId) {
  const taskId = createTask('airport_reset', airportId);
  try {
    const ap = db.prepare('SELECT * FROM airports WHERE id = ?').get(airportId);
    if (!ap) throw new Error('机场不存在');
    appendLog(taskId, `开始重置机场「${ap.name}」订阅 (${ap.panel_type}${ap.reset_mode === 'flaresolverr' ? ' · FlareSolverr' : ''})`);

    const { subUrl, detected, changed } = await resetAirportSubscription(ap, { log: (line) => appendLog(taskId, line) });
    if (detected) appendLog(taskId, `通用适配器识别面板类型：${detected}`);
    appendLog(taskId, `重置成功，新订阅链接：${subUrl}` +
      (changed === true ? '（已确认链接变化）' : changed === false ? '（⚠ 链接未变化）' : ''));

    db.prepare('UPDATE airports SET sub_url = ?, updated_at = ? WHERE id = ?')
      .run(subUrl, Date.now(), airportId);
    appendLog(taskId, '已回填订阅链接到面板');

    const { count, traffic } = await fetchAirport(airportId);
    appendLog(taskId, `拉取完成，解析 ${count} 个节点` +
      (traffic.expire ? `，账户到期 ${new Date(traffic.expire).toLocaleDateString('zh-CN')}` : ''));

    finishTask(taskId, 'success');
    return { taskId, subUrl, count };
  } catch (err) {
    appendLog(taskId, `失败：${err.message}`);
    finishTask(taskId, 'failed');
    throw Object.assign(err, { taskId });
  }
}

// "手动重置"（半自动兜底）：操作者在自己浏览器登录机场重置后，把新订阅链接粘回；
// 面板保存并拉取一次，全程记入任务日志（旧→新链接、节点数）。
export async function runManualReset(airportId, subUrl) {
  const taskId = createTask('airport_reset', airportId);
  try {
    const ap = db.prepare('SELECT * FROM airports WHERE id = ?').get(airportId);
    if (!ap) throw new Error('机场不存在');
    const next = (subUrl || '').trim();
    if (!/^https?:\/\//i.test(next)) throw new Error('请粘贴有效的新订阅链接（以 http/https 开头）');
    appendLog(taskId, `手动重置机场「${ap.name}」`);
    appendLog(taskId, `旧订阅链接：${ap.sub_url || '（无）'}`);
    appendLog(taskId, `新订阅链接：${next}`);
    db.prepare('UPDATE airports SET sub_url = ?, updated_at = ? WHERE id = ?').run(next, Date.now(), airportId);
    appendLog(taskId, '已保存新链接到面板，开始拉取…');
    const { count, traffic } = await fetchAirport(airportId);
    appendLog(taskId, `拉取完成，解析 ${count} 个节点` +
      (traffic.expire ? `，账户到期 ${new Date(traffic.expire).toLocaleDateString('zh-CN')}` : ''));
    finishTask(taskId, 'success');
    return { taskId, count };
  } catch (err) {
    appendLog(taskId, `失败：${err.message}`);
    finishTask(taskId, 'failed');
    throw Object.assign(err, { taskId });
  }
}

// Reset every airport that has a subscription link configured. Shared by the
// "全部机场" button and the scheduler. Never throws — collects per-airport results.
export async function runAllAirportResets() {
  const ids = db.prepare("SELECT id FROM airports WHERE sub_url IS NOT NULL AND sub_url != ''").all().map((a) => a.id);
  const results = [];
  for (const aid of ids) {
    try { results.push({ airportId: aid, ok: true, ...(await runAirportReset(aid)) }); }
    catch (err) { results.push({ airportId: aid, ok: false, error: err.message, taskId: err.taskId }); }
  }
  return results;
}

// "用户流量统计" automation.
// For each enabled user, the panel measures how much its airport account(s) have
// consumed since the user's baseline. traffic_used = current airport used - baseline(A).
// When a per-user traffic_limit is reached, subscriptions auto-cut (see build.js).
// Pass { refetch: true } to pull each airport first so the numbers are fresh.
export async function runTrafficStats({ refetch = true } = {}) {
  const taskId = createTask('traffic_stats', null);
  try {
    appendLog(taskId, `开始统计用户流量${refetch ? '（先刷新机场用量）' : ''}`);
    const airports = db.prepare('SELECT id, name, sub_url, used_traffic FROM airports').all();

    // optionally refresh each airport's used_traffic by pulling its subscription
    if (refetch) {
      for (const ap of airports) {
        if (!ap.sub_url) continue;
        try {
          await fetchAirport(ap.id);
        } catch (err) {
          appendLog(taskId, `机场「${ap.name}」刷新失败：${err.message}`);
        }
      }
    }

    // Measure on the monotonic cumulative counter (used_traffic_cum), not the raw
    // absolute used_traffic — the latter drops when an airport resets its billing
    // cycle and would corrupt every user's B - A. See accumulateUsed() / fetch.js.
    const usedByAirport = Object.fromEntries(
      db.prepare('SELECT id, used_traffic_cum, used_traffic FROM airports').all()
        .map((a) => [a.id, Number(a.used_traffic_cum ?? a.used_traffic ?? 0)])
    );

    const users = db.prepare('SELECT * FROM users WHERE enabled = 1').all();
    let cutoff = 0;
    const now = Date.now();
    for (const u of users) {
      let filter = {};
      try { filter = JSON.parse(u.node_filter || '{}'); } catch { /* noop */ }
      const airportIds = Array.isArray(filter.airports) && filter.airports.length
        ? filter.airports
        : airports.map((a) => a.id);
      const current = airportIds.reduce((sum, id) => sum + (usedByAirport[id] || 0), 0);

      let base = u.traffic_base;
      let used;
      if (base == null) {
        base = current; // first measurement establishes baseline A
        used = 0;
      } else {
        used = Math.max(0, current - base);
      }
      db.prepare('UPDATE users SET traffic_base = ?, traffic_used = ?, traffic_updated_at = ? WHERE id = ?')
        .run(base, used, now, u.id);

      const limit = Number(u.traffic_limit || 0);
      if (limit > 0 && used >= limit) {
        cutoff++;
        appendLog(taskId, `用户「${u.name}」流量已用完（${fmtBytes(used)}/${fmtBytes(limit)}），订阅已自动切断`);
        // event-driven: alert the moment exhaustion is measured (deduped)
        try {
          const r = await maybeSendUserAlert(u.id);
          if (r.sent) appendLog(taskId, `→ 已发送用户端告警（${r.channels.join('/') || '无渠道成功'}）`);
        } catch { /* notify never throws, but be safe */ }
      }
    }

    appendLog(taskId, `完成：统计 ${users.length} 个启用用户，其中 ${cutoff} 个已达上限被切断`);
    finishTask(taskId, 'success');
    return { taskId, users: users.length, cutoff };
  } catch (err) {
    appendLog(taskId, `失败：${err.message}`);
    finishTask(taskId, 'failed');
    throw Object.assign(err, { taskId });
  }
}

// "到期/超限告警" —— 周期全量扫描（时间驱动条件如到期/即将到期无事件可挂，只能定期看钟）。
// 事件驱动条件（流量超限、机场用量阈值）已在 runTrafficStats / fetchAirport 就地触发，
// 这里的扫描是它们的兜底 + 到期类的唯一触发。发送/去重逻辑统一走 services/alerts.js。
// recordEmpty=false（后台每小时扫描）时，若本次没发出任何告警就不落任务日志，避免刷屏；
// 手动运行走默认 true，总会留一条“已检查、0 条”的记录。
export async function runAlertCheck({ recordEmpty = true } = {}) {
  const userIds = db.prepare('SELECT id FROM users WHERE enabled = 1').all().map((r) => r.id);
  const airportIds = db.prepare('SELECT id FROM airports').all().map((r) => r.id);
  const lines = [];
  let userAlerts = 0, airportAlerts = 0, secAlerts = 0, failed = null;
  try {
    for (const id of userIds) {
      const r = await maybeSendUserAlert(id);
      if (r.sent) { userAlerts++; lines.push(`用户端告警 #${id}（${r.channels.join('/') || '无渠道成功'}）`); }
      const s = await maybeSendUserSecurityAlert(id);
      if (s.sent) { secAlerts++; lines.push(`订阅多IP安全告警 #${id}（${s.ips} 个IP，${s.channels.join('/') || '无渠道成功'}）`); }
    }
    for (const id of airportIds) {
      const r = await maybeSendAirportAlert(id);
      if (r.sent) { airportAlerts++; lines.push(`机场端告警 #${id} ${r.reasons.join('、')}（${r.channels.join('/') || '无渠道成功'}）`); }
    }
  } catch (err) { failed = err; }

  // silent background sweep with nothing to say → don't create a task row
  if (!recordEmpty && !failed && userAlerts === 0 && airportAlerts === 0 && secAlerts === 0) {
    return { taskId: null, userAlerts, airportAlerts, secAlerts };
  }

  const taskId = createTask('alerts', null);
  for (const line of lines) appendLog(taskId, line);
  if (failed) {
    appendLog(taskId, `失败：${failed.message}`);
    finishTask(taskId, 'failed');
    throw Object.assign(failed, { taskId });
  }
  appendLog(taskId, `完成：用户端 ${userAlerts} 条，机场端 ${airportAlerts} 条，安全 ${secAlerts} 条`);
  finishTask(taskId, 'success');
  return { taskId, userAlerts, airportAlerts, secAlerts };
}

// "延迟检测" automation. Measures real TCP-handshake RTT for the selected airports'
// nodes (empty = all nodes) and writes latency/latency_at back. Dedupes by physical
// endpoint so the same server pulled by several accounts is measured once, then the
// reading is fanned out to every duplicate. freshMinutes>0 reuses a recent reading
// instead of re-measuring. cleanup=true also deletes timed-out (dead) nodes; they
// re-appear on the airport's next pull if they come back.
export async function runLatencyCheck(airportIds = [], { cleanup = false, freshMinutes = 0 } = {}) {
  const taskId = createTask('latency', null);
  try {
    const ids = Array.isArray(airportIds) ? airportIds.map(Number).filter((n) => !Number.isNaN(n)) : [];
    const rows = ids.length
      ? db.prepare(`SELECT id, server, port, latency, latency_at FROM nodes WHERE airport_id IN (${ids.map(() => '?').join(',')})`).all(...ids)
      : db.prepare('SELECT id, server, port, latency, latency_at FROM nodes').all();
    appendLog(taskId, `开始延迟检测：${ids.length ? `机场 [${ids.join(', ')}]` : '全部机场'}，共 ${rows.length} 个节点${cleanup ? '（检测后清理死节点）' : ''}`);
    if (!rows.length) {
      appendLog(taskId, '没有可检测的节点');
      finishTask(taskId, 'success');
      return { taskId, total: 0, ok: 0, timeout: 0, deleted: 0 };
    }
    const { perNode, endpoints, measured, reused } = await pingDedupAndRecord(rows, { freshMinutes });
    appendLog(taskId, `去重：${rows.length} 个节点 → ${endpoints} 个唯一端点（实测 ${measured}，复用 ${reused}）`);
    const timeouts = perNode.filter((r) => r.latency < 0);
    const ok = perNode.length - timeouts.length;
    let deleted = 0;
    if (cleanup && timeouts.length) {
      const del = db.prepare('DELETE FROM nodes WHERE id = ?');
      db.transaction((list) => list.forEach((r) => del.run(r.id)))(timeouts);
      deleted = timeouts.length;
      appendLog(taskId, `已清理 ${deleted} 个超时(死)节点`);
    }
    appendLog(taskId, `完成：连通 ${ok} 个，超时 ${timeouts.length} 个${cleanup ? `，清理 ${deleted} 个` : ''}`);
    finishTask(taskId, 'success');
    return { taskId, total: perNode.length, endpoints, measured, reused, ok, timeout: timeouts.length, deleted };
  } catch (err) {
    appendLog(taskId, `失败：${err.message}`);
    finishTask(taskId, 'failed');
    throw Object.assign(err, { taskId });
  }
}

// "用户触发机场拉取" automation. When a downstream user pulls their panel
// subscription we opportunistically refresh the airport account(s) behind them so
// usage (B−A) and expiry stay fresh. Throttled to at most one pull per airport per
// rolling hour (via the airport's own last_fetch_at, which persists across
// restarts) plus an in-flight guard. Each real pull is task-logged with the
// triggering user and the airports pulled. `manual` bypasses the 1h window; `seen`
// dedupes airports across a run-for-all so shared airports pull once.
const PULL_WINDOW_MS = 3600000;
const pullInflight = new Set();

export async function runUserPull(userId, { manual = false, seen = null } = {}) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { pulled: 0 };
  let filter = {};
  try { filter = JSON.parse(user.node_filter || '{}'); } catch { /* noop */ }
  const ids = Array.isArray(filter.airports) && filter.airports.length
    ? filter.airports
    : db.prepare('SELECT id FROM airports').all().map((r) => r.id);
  const now = Date.now();
  const due = [];
  for (const id of ids) {
    if (pullInflight.has(id) || seen?.has(id)) continue;
    const ap = db.prepare('SELECT id, name, account, sub_url, last_fetch_at FROM airports WHERE id = ?').get(id);
    if (!ap || !ap.sub_url) continue;
    if (!manual && now - (Number(ap.last_fetch_at) || 0) < PULL_WINDOW_MS) continue; // rolling 1h window
    due.push(ap);
    pullInflight.add(id);
  }
  // auto trigger with nothing due → no task (avoid a row on every client poll)
  if (!due.length && !manual) return { pulled: 0 };

  const taskId = createTask('user_pull', userId);
  try {
    appendLog(taskId, `用户「${user.name}」拉取订阅 → 触发拉取机场（${manual ? '手动' : '自动 · 滚动1小时节流'}）`);
    if (!due.length) {
      appendLog(taskId, '没有需要拉取的机场（无订阅链接，或均已在本次/节流窗口内拉取）');
      finishTask(taskId, 'success');
      return { taskId, pulled: 0, total: 0 };
    }
    let pulled = 0;
    for (const ap of due) {
      const label = ap.account ? `${ap.name} / ${ap.account}` : ap.name;
      try {
        const r = await fetchAirport(ap.id);
        pulled++;
        seen?.add(ap.id);
        appendLog(taskId, `机场「${label}」拉取完成，解析 ${r.count} 个节点`);
      } catch (err) {
        appendLog(taskId, `机场「${label}」拉取失败：${err.message}`);
      }
    }
    appendLog(taskId, `完成：成功拉取 ${pulled}/${due.length} 个机场`);
    finishTask(taskId, 'success');
    return { taskId, pulled, total: due.length };
  } finally {
    for (const ap of due) pullInflight.delete(ap.id);
  }
}

// Manual "run for all enabled users" — bypasses the 1h window but dedupes shared
// airports across the whole run so each airport is pulled at most once.
export async function runUserPullAll() {
  const users = db.prepare('SELECT id FROM users WHERE enabled = 1').all();
  const seen = new Set();
  let tasks = 0, pulled = 0;
  for (const u of users) {
    const r = await runUserPull(u.id, { manual: true, seen });
    if (r.taskId) tasks++;
    pulled += r.pulled || 0;
  }
  return { users: users.length, tasks, pulled };
}

// Triggered when a user is reset or auto-expires: reset every airport the user pulls from.
export async function runUserTriggeredReset(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('用户不存在');
  let filter = {};
  try { filter = JSON.parse(user.node_filter || '{}'); } catch { /* noop */ }
  const airportIds = Array.isArray(filter.airports) && filter.airports.length
    ? filter.airports
    : db.prepare('SELECT id FROM airports').all().map((r) => r.id);

  const results = [];
  for (const id of airportIds) {
    try {
      const r = await runAirportReset(id);
      results.push({ airportId: id, ok: true, ...r });
    } catch (err) {
      results.push({ airportId: id, ok: false, error: err.message });
    }
  }
  return results;
}
