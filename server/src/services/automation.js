import { db } from '../db.js';
import { resetAirportSubscription } from './airport/adapters.js';
import { fetchAirport } from './airport/fetch.js';
import { fmtBytes } from './util.js';

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

    const usedByAirport = Object.fromEntries(
      db.prepare('SELECT id, used_traffic FROM airports').all().map((a) => [a.id, Number(a.used_traffic || 0)])
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
