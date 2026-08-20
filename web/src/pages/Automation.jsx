import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API } from '../api.js';
import { fmtDate, fmtDateTime } from '../ui.jsx';
import { invalidate } from '../store.js';

const TASK_LABEL = {
  airport_reset: '机场订阅重置', traffic_stats: '用户流量统计', alerts: '告警检查',
  latency: '延迟检测', node_fetch: '节点拉取', user_pull: '用户触发拉取', traffic_reset: '流量月度重置',
  probe: '可用性检测', zombie_cleanup: '僵尸用户清理',
};
const STATUS_BADGE = { success: 'green', failed: 'red', running: 'blue', pending: 'gray' };

const TABS = [
  { key: 'airport_reset', label: '🔄 机场订阅重置' },
  { key: 'traffic_stats', label: '📊 用户流量统计' },
  { key: 'traffic_reset', label: '📅 用户流量月度重置' },
  { key: 'alerts', label: '🔔 到期/超限告警' },
  { key: 'latency', label: '📡 节点延迟检测' },
  { key: 'probe', label: '🛰️ 真实可用性检测' },
  { key: 'zombie_cleanup', label: '🧟 僵尸用户清理' },
  { key: 'user_pull', label: '📥 用户触发机场拉取' },
];

export default function Automation({ toast }) {
  // keep the active tab in the URL (?tab=) so a page refresh stays on it
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'airport_reset';
  const setTab = (key) => setSearchParams({ tab: key });
  const [overview, setOverview] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [running, setRunning] = useState('');
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState({});
  const [latAirports, setLatAirports] = useState(null); // selected airport ids for latency scope
  const [latCleanup, setLatCleanup] = useState(null);   // delete dead nodes after检测
  const [probeAirports, setProbeAirports] = useState(null); // scope for availability probe
  const [zombieDisable, setZombieDisable] = useState(null); // days after expiry → disable
  const [zombieDelete, setZombieDelete] = useState(null);   // days after expiry → delete
  const timer = useRef(null);

  const loadTasks = useCallback(() => API.tasks().then(setTasks).catch(() => {}), []);
  const loadOverview = useCallback(() => API.automationOverview().then((o) => {
    setOverview(o);
    const latSched = o.automations.find((x) => x.key === 'latency')?.schedule;
    setLatAirports((cur) => cur ?? (latSched?.airports || []));
    setLatCleanup((cur) => cur ?? !!latSched?.cleanup);
    const probeSched = o.automations.find((x) => x.key === 'probe')?.schedule;
    setProbeAirports((cur) => cur ?? (probeSched?.airports || []));
    const zSched = o.automations.find((x) => x.key === 'zombie_cleanup')?.schedule;
    setZombieDisable((cur) => cur ?? (zSched?.disableDays ?? 0));
    setZombieDelete((cur) => cur ?? (zSched?.deleteDays ?? 0));
  }).catch((e) => toast.error(e.message)), [toast]);

  useEffect(() => { loadOverview(); loadTasks(); }, [loadOverview, loadTasks]);

  useEffect(() => {
    const anyRunning = tasks.some((t) => t.status === 'running') || running;
    clearInterval(timer.current);
    if (anyRunning) timer.current = setInterval(() => { loadTasks(); loadOverview(); }, 1500);
    return () => clearInterval(timer.current);
  }, [tasks, running, loadTasks, loadOverview]);

  const runAirportReset = async (airportId) => {
    setRunning('airport_reset');
    try {
      const r = await API.runAirportReset(airportId);
      if (airportId) toast.success(`重置完成，新增 ${r.count ?? 0} 节点`);
      else toast.success('全部机场重置任务已完成');
      invalidate('airports'); invalidate('nodes:');
    } catch (e) { toast.error(e.message); }
    finally { setRunning(''); loadTasks(); loadOverview(); }
  };
  const runTraffic = async () => {
    setRunning('traffic_stats');
    try {
      const r = await API.runTrafficStats();
      toast.success(`流量统计完成：${r.users} 用户，${r.cutoff} 个被切断`);
      invalidate('users');
    } catch (e) { toast.error(e.message); }
    finally { setRunning(''); loadTasks(); loadOverview(); }
  };
  const runAlerts = async () => {
    setRunning('alerts');
    try {
      const r = await API.runAlerts();
      toast.success(`告警检查完成：用户端 ${r.userAlerts} 条，机场端 ${r.airportAlerts} 条`);
    } catch (e) { toast.error(e.message); }
    finally { setRunning(''); loadTasks(); loadOverview(); }
  };
  const runLatency = async () => {
    setRunning('latency');
    try {
      const r = await API.runLatency(latAirports || [], !!latCleanup);
      toast.success(`延迟检测完成：连通 ${r.ok}，超时 ${r.timeout}${latCleanup ? `，清理 ${r.deleted}` : ''}（共 ${r.total}）`);
      invalidate('nodes:');
    } catch (e) { toast.error(e.message); }
    finally { setRunning(''); loadTasks(); loadOverview(); }
  };
  const runProbe = async () => {
    setRunning('probe');
    try {
      const r = await API.runProbeAuto(probeAirports || []);
      toast.success(`可用性检测完成：连通 ${r.alive}，不通 ${r.dead}${r.untestable ? `，${r.untestable} 不支持` : ''}`);
      invalidate('nodes:');
    } catch (e) { toast.error(e.message); }
    finally { setRunning(''); loadTasks(); loadOverview(); }
  };
  const runZombie = async () => {
    setRunning('zombie_cleanup');
    try {
      const r = await API.runZombieCleanup();
      toast.success(`僵尸清理完成：停用 ${r.disabled}，删除 ${r.deleted}`);
      invalidate('users');
    } catch (e) { toast.error(e.message); }
    finally { setRunning(''); loadTasks(); loadOverview(); }
  };
  const runTrafficReset = async () => {
    setRunning('traffic_reset');
    try {
      const r = await API.runTrafficReset();
      toast.success(`月度重置完成：今天到期 ${r.reset} 个用户已重置（候选 ${r.candidates}）`);
      invalidate('users');
    } catch (e) { toast.error(e.message); }
    finally { setRunning(''); loadTasks(); loadOverview(); }
  };
  const runUserPull = async () => {
    setRunning('user_pull');
    try {
      const r = await API.runUserPull();
      toast.success(`已为 ${r.users} 个用户触发，拉取 ${r.pulled} 个机场`);
      invalidate('airports'); invalidate('nodes:');
    } catch (e) { toast.error(e.message); }
    finally { setRunning(''); loadTasks(); loadOverview(); }
  };

  const clearTasks = async () => { await API.clearTasks(); loadTasks(); };

  const saveSchedule = async (key, cfg) => {
    try {
      await API.saveSchedules({ [key]: cfg });
      toast.success('定时设置已保存');
      loadOverview();
    } catch (e) { toast.error(e.message); }
  };

  const testAirport = async (id) => {
    setTesting(id);
    setTestResult((r) => ({ ...r, [id]: null }));
    try {
      const r = await API.testAirportReset(id);
      setTestResult((res) => ({ ...res, [id]: { ok: true, msg: `✓ ${r.note}（${r.via}）` } }));
    } catch (e) {
      setTestResult((res) => ({ ...res, [id]: { ok: false, msg: `✗ ${e.message}` } }));
    } finally { setTesting(null); }
  };

  const airports = overview?.airports || [];
  const metaOf = (key) => overview?.automations?.find((x) => x.key === key);

  return (
    <>
      <div className="page-head"><h1>自动化</h1></div>
      <p className="muted small" style={{ marginTop: -8 }}>
        每个自动化一个标签页；触发条件与定时（交互式 Cron，北京时间）见各页，运行过程与报错见对应任务日志。
      </p>

      <div className="tabs">
        {TABS.map((t) => (
          <div key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</div>
        ))}
      </div>

      {tab === 'airport_reset' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>🔄 机场订阅自动重置</h3>
          <p className="muted small">后台登录机场 → 重置订阅 → 回填链接 → 拉取一次。</p>
          <TriggerInfo meta={metaOf('airport_reset')} />
          <CronEditor schedule={metaOf('airport_reset')?.schedule} onSave={(cfg) => saveSchedule('airport_reset', cfg)} />
          <div className="btn-row" style={{ margin: '12px 0' }}>
            <button className="btn primary" disabled={running === 'airport_reset'} onClick={() => runAirportReset()}>
              {running === 'airport_reset' ? <span className="spin" /> : '▶ 全部机场'}
            </button>
          </div>
          <div className="auto-airport-list">
            {airports.length === 0 ? <div className="muted small">暂无机场</div> : airports.map((a) => (
              <div className="auto-airport-row" key={a.id}>
                <div>
                  <strong>{a.name}</strong>
                  {a.account ? <span className="muted small"> / {a.account}</span> : ''}
                  {a.group_name ? <span className="badge blue" style={{ marginLeft: 6 }}>{a.group_name}</span> : ''}
                  <div className="muted small">上次拉取：{a.last_fetch_at ? fmtDate(a.last_fetch_at) : '从未'}</div>
                  {testResult[a.id] && (
                    <div className={`small ${testResult[a.id].ok ? 'ok-text' : 'err-text'}`} style={{ marginTop: 2 }}>
                      {testResult[a.id].msg}
                    </div>
                  )}
                </div>
                <div className="btn-row">
                  <button className="btn sm" disabled={testing === a.id} onClick={() => testAirport(a.id)} title="仅验证账号/令牌可用，不重置">
                    {testing === a.id ? <span className="spin" /> : '测试'}
                  </button>
                  <button className="btn sm" disabled={!!running} onClick={() => runAirportReset(a.id)}>运行</button>
                </div>
              </div>
            ))}
          </div>
          <TaskLog tasks={tasks} type="airport_reset" onClear={clearTasks} />
        </div>
      )}

      {tab === 'traffic_stats' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>📊 用户流量统计</h3>
          <p className="muted small">
            按机场账户用量估算每个用户已用流量（B−A，机场重置不失真），达到「流量上限」的用户订阅将自动切断。
            首次运行仅建立基线（A）。
          </p>
          <TriggerInfo meta={metaOf('traffic_stats')} />
          <CronEditor schedule={metaOf('traffic_stats')?.schedule} onSave={(cfg) => saveSchedule('traffic_stats', cfg)} />
          <div style={{ margin: '12px 0' }}>
            <button className="btn primary" disabled={running === 'traffic_stats'} onClick={runTraffic}>
              {running === 'traffic_stats' ? <span className="spin" /> : '▶ 立即统计'}
            </button>
          </div>
          <TaskLog tasks={tasks} type="traffic_stats" onClear={clearTasks} />
        </div>
      )}

      {tab === 'probe' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>🛰️ 真实可用性检测</h3>
          <p className="muted small">
            通过内置 <strong>sing-box</strong> 实际连接每个节点并请求测试 URL，验证节点是否<strong>真能代理</strong>（区别于「延迟检测」只测端口连通）。
            结果显示在节点管理的「可用性」列。需要镜像内含 sing-box；缺失时任务会记录清晰原因。
          </p>
          <div className="field">
            <label>检测范围（按机场，不勾=全部）</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 4px' }}>
              {airports.length === 0 ? <span className="muted small">暂无机场</span> : airports.map((a) => {
                const checked = (probeAirports || []).includes(a.id);
                return (
                  <label key={a.id} className="checkbox-inline" style={{ marginRight: 14 }}>
                    <input type="checkbox" checked={checked} onChange={(e) => {
                      setProbeAirports((cur) => {
                        const set = new Set(cur || []);
                        if (e.target.checked) set.add(a.id); else set.delete(a.id);
                        return [...set];
                      });
                    }} />
                    <span>{a.name}{a.account ? ` / ${a.account}` : ''}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <TriggerInfo meta={metaOf('probe')} />
          <CronEditor schedule={metaOf('probe')?.schedule}
            onSave={(cfg) => saveSchedule('probe', { ...cfg, airports: probeAirports || [] })} />
          <div style={{ margin: '12px 0' }}>
            <button className="btn primary" disabled={running === 'probe'} onClick={runProbe}>
              {running === 'probe' ? <span className="spin" /> : '▶ 立即检测'}
            </button>
            <span className="muted small" style={{ marginLeft: 8 }}>
              {(probeAirports || []).length ? `范围：${probeAirports.length} 个机场` : '范围：全部节点'}
            </span>
          </div>
          <TaskLog tasks={tasks} type="probe" onClear={clearTasks} />
        </div>
      )}

      {tab === 'zombie_cleanup' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>🧟 僵尸用户清理</h3>
          <p className="muted small">
            到期用户虽已拿不到节点，但仍占着机场账户槽位、仍被流量统计/拉取处理。这里在到期后按阈值自动清理：
            先<strong>停用</strong>（释放槽位、停止后台处理），再<strong>删除</strong>（回收 token、清理其订阅日志/续费记录）。
            阈值填 <strong>0 表示关闭</strong>该动作。删除不可恢复，请谨慎设置。
          </p>
          <div className="field-row">
            <div className="field">
              <label>到期 N 天后自动停用（0=不停用）</label>
              <input type="number" min="0" step="1" value={zombieDisable ?? 0}
                onChange={(e) => setZombieDisable(Number(e.target.value))} placeholder="如 7" />
            </div>
            <div className="field">
              <label>到期 M 天后自动删除（0=不删除）</label>
              <input type="number" min="0" step="1" value={zombieDelete ?? 0}
                onChange={(e) => setZombieDelete(Number(e.target.value))} placeholder="如 30" />
            </div>
          </div>
          <TriggerInfo meta={metaOf('zombie_cleanup')} />
          <CronEditor schedule={metaOf('zombie_cleanup')?.schedule}
            onSave={(cfg) => saveSchedule('zombie_cleanup', { ...cfg, disableDays: Number(zombieDisable) || 0, deleteDays: Number(zombieDelete) || 0 })} />
          <div style={{ margin: '12px 0' }}>
            <button className="btn primary" disabled={running === 'zombie_cleanup'} onClick={runZombie}>
              {running === 'zombie_cleanup' ? <span className="spin" /> : '▶ 立即清理'}
            </button>
            <span className="muted small" style={{ marginLeft: 8 }}>先保存定时以持久化阈值；立即清理使用已保存的阈值</span>
          </div>
          <TaskLog tasks={tasks} type="zombie_cleanup" onClear={clearTasks} />
        </div>
      )}

      {tab === 'traffic_reset' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>📅 用户流量月度重置</h3>
          <p className="muted small">
            每天清扫一次：把「每月重置日 = 今天」的用户已用流量清零（B−A 重新计）。月末自动裁剪——
            如设 31 号，在只有 28 天的 2 月会在 28 号触发。每个用户的重置日在<strong>「用户 · 编辑」</strong>里设置，
            也可在用户列表对单个用户点<strong>「重置流量」</strong>立即清零。
          </p>
          <TriggerInfo meta={metaOf('traffic_reset')} />
          <CronEditor schedule={metaOf('traffic_reset')?.schedule} onSave={(cfg) => saveSchedule('traffic_reset', cfg)} />
          <div style={{ margin: '12px 0' }}>
            <button className="btn primary" disabled={running === 'traffic_reset'} onClick={runTrafficReset}>
              {running === 'traffic_reset' ? <span className="spin" /> : '▶ 立即清扫（仅重置今天到期的用户）'}
            </button>
          </div>
          <TaskLog tasks={tasks} type="traffic_reset" onClear={clearTasks} />
        </div>
      )}

      {tab === 'alerts' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>🔔 到期/超限告警</h3>
          <p className="muted small">
            用户到期/即将到期(≤1天,提醒续费)/流量超限、机场用量≥97% 或到期≤1天时，发送邮件/Telegram 提醒。
            通知内含免登录魔法链接：用户端可直接回填新订阅链接，机场端可一键拉取更新用量/到期。
            渠道在<strong>「设置 · 告警通知」</strong>配置。
          </p>
          <TriggerInfo meta={metaOf('alerts')} />
          <p className="muted small" style={{ marginTop: 4 }}>
            💡 超限/机场用量为<strong>事件即时触发</strong>；到期类（用户到期/即将到期、机场到期）由下方 <strong>Cron 定时</strong>扫描发送。
          </p>
          <CronEditor schedule={metaOf('alerts')?.schedule} onSave={(cfg) => saveSchedule('alerts', cfg)} />
          <div style={{ margin: '12px 0' }}>
            <button className="btn primary" disabled={running === 'alerts'} onClick={runAlerts}>
              {running === 'alerts' ? <span className="spin" /> : '▶ 立即检查并通知'}
            </button>
          </div>
          <TaskLog tasks={tasks} type="alerts" onClear={clearTasks} />
        </div>
      )}

      {tab === 'user_pull' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>📥 用户触发机场拉取</h3>
          <p className="muted small">
            用户拉取面板订阅时，面板顺带拉取其下发机场的订阅，刷新用量/到期（每机场滚动 1 小时最多一次）。
            任务日志记录触发用户与所拉取的机场。下方按钮可手动为<strong>全部启用用户</strong>立即拉取一次（忽略节流、跨用户去重）。
          </p>
          <TriggerInfo meta={metaOf('user_pull')} />
          <div style={{ margin: '12px 0' }}>
            <button className="btn primary" disabled={running === 'user_pull'} onClick={runUserPull}>
              {running === 'user_pull' ? <span className="spin" /> : '▶ 为全部用户立即拉取'}
            </button>
          </div>
          <TaskLog tasks={tasks} type="user_pull" onClear={clearTasks} />
        </div>
      )}

      {tab === 'latency' && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>📡 节点延迟检测</h3>
          <p className="muted small">对所选机场的节点做真实 TCP 握手测速（best-of-2），回写节点延迟。不选机场=检测全部节点。</p>
          <div className="field">
            <label>检测范围（按机场，不勾=全部）</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 4px' }}>
              {airports.length === 0 ? <span className="muted small">暂无机场</span> : airports.map((a) => {
                const checked = (latAirports || []).includes(a.id);
                return (
                  <label key={a.id} className="checkbox-inline" style={{ marginRight: 14 }}>
                    <input type="checkbox" checked={checked} onChange={(e) => {
                      setLatAirports((cur) => {
                        const set = new Set(cur || []);
                        if (e.target.checked) set.add(a.id); else set.delete(a.id);
                        return [...set];
                      });
                    }} />
                    <span>{a.name}{a.account ? ` / ${a.account}` : ''}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <label className="checkbox-inline" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={!!latCleanup} onChange={(e) => setLatCleanup(e.target.checked)} />
            <span>检测后删除超时(死)节点</span>
          </label>
          <TriggerInfo meta={metaOf('latency')} />
          <CronEditor schedule={metaOf('latency')?.schedule}
            onSave={(cfg) => saveSchedule('latency', { ...cfg, airports: latAirports || [], cleanup: !!latCleanup })} />
          <div style={{ margin: '12px 0' }}>
            <button className="btn primary" disabled={running === 'latency'} onClick={runLatency}>
              {running === 'latency' ? <span className="spin" /> : '▶ 立即检测'}
            </button>
            <span className="muted small" style={{ marginLeft: 8 }}>
              {(latAirports || []).length ? `范围：${latAirports.length} 个机场` : '范围：全部节点'}
            </span>
          </div>
          <TaskLog tasks={tasks} type="latency" onClear={clearTasks} />
        </div>
      )}
    </>
  );
}

function TriggerInfo({ meta }) {
  if (!meta) return null;
  const hasTriggers = meta.autoTriggers && meta.autoTriggers.length > 0;
  return (
    <div className="trigger-info">
      {hasTriggers && (
        <>
          <div className="small"><strong>自动触发条件</strong></div>
          <ul className="trigger-list">
            {meta.autoTriggers.map((line, i) => <li key={i} className="muted small">{line}</li>)}
          </ul>
        </>
      )}
      {meta.scheduleText && <div className="muted small" style={{ marginTop: 2 }}>⏱ 定时：{meta.scheduleText}</div>}
    </div>
  );
}

/* ---------------- 交互式 Cron 编辑器 ---------------- */
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// best-effort parse of a cron string back into the builder's structured state
function parseCronToState(cron) {
  const parts = String(cron || '').trim().split(/\s+/);
  const base = { mode: 'daily', minute: 0, hour: 3, everyN: 2, weekday: 1, monthday: 1, custom: cron || '0 3 * * *' };
  if (parts.length !== 5) return { ...base, mode: 'custom' };
  const [mi, h, dom, mon, dow] = parts;
  const num = (s) => /^\d+$/.test(s);
  if (h === '*' && dom === '*' && mon === '*' && dow === '*' && num(mi)) return { ...base, mode: 'hourly', minute: +mi };
  if (dom === '*' && mon === '*' && dow === '*' && mi === '0' && /^\*\/\d+$/.test(h)) return { ...base, mode: 'everyN', everyN: +h.slice(2) };
  if (dom === '*' && mon === '*' && dow === '*' && num(mi) && num(h)) return { ...base, mode: 'daily', minute: +mi, hour: +h };
  if (dom === '*' && mon === '*' && num(mi) && num(h) && num(dow)) return { ...base, mode: 'weekly', minute: +mi, hour: +h, weekday: +dow };
  if (mon === '*' && dow === '*' && num(mi) && num(h) && num(dom)) return { ...base, mode: 'monthly', minute: +mi, hour: +h, monthday: +dom };
  return { ...base, mode: 'custom' };
}

function buildCron(s) {
  const mi = clamp(s.minute, 0, 59), h = clamp(s.hour, 0, 23);
  switch (s.mode) {
    case 'hourly': return `${mi} * * * *`;
    case 'everyN': return `0 */${clamp(s.everyN, 1, 23)} * * *`;
    case 'daily': return `${mi} ${h} * * *`;
    case 'weekly': return `${mi} ${h} * * ${clamp(s.weekday, 0, 6)}`;
    case 'monthly': return `${mi} ${h} ${clamp(s.monthday, 1, 31)} * *`;
    default: return (s.custom || '').trim();
  }
}
function clamp(v, lo, hi) { const n = Math.round(Number(v)); return Number.isNaN(n) ? lo : Math.min(hi, Math.max(lo, n)); }
const pad = (n) => String(n).padStart(2, '0');

function describe(s) {
  const mi = clamp(s.minute, 0, 59), h = clamp(s.hour, 0, 23);
  switch (s.mode) {
    case 'hourly': return `每小时第 ${mi} 分`;
    case 'everyN': return `每 ${clamp(s.everyN, 1, 23)} 小时`;
    case 'daily': return `每天 ${pad(h)}:${pad(mi)}`;
    case 'weekly': return `每${WEEK[clamp(s.weekday, 0, 6)]} ${pad(h)}:${pad(mi)}`;
    case 'monthly': return `每月 ${clamp(s.monthday, 1, 31)} 日 ${pad(h)}:${pad(mi)}`;
    default: return `自定义：${(s.custom || '').trim() || '（空）'}`;
  }
}

function CronEditor({ schedule, onSave }) {
  const [enabled, setEnabled] = useState(false);
  const [st, setSt] = useState(null);

  useEffect(() => {
    if (!schedule) return;
    setEnabled(!!schedule.enabled);
    setSt(parseCronToState(schedule.cron));
  }, [schedule?.enabled, schedule?.cron]);

  if (!st) return null;
  const set = (k, v) => setSt((c) => ({ ...c, [k]: v }));
  const cron = buildCron(st);

  return (
    <div className="schedule-editor">
      <label className="checkbox-inline">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>开启定时任务（北京时间）</span>
      </label>
      {enabled && (
        <>
          <div className="schedule-row">
            <select value={st.mode} onChange={(e) => set('mode', e.target.value)}>
              <option value="hourly">每小时</option>
              <option value="everyN">每 N 小时</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
              <option value="custom">自定义 Cron</option>
            </select>

            {st.mode === 'hourly' && (
              <span className="schedule-inline">第 <input type="number" min="0" max="59" value={st.minute} onChange={(e) => set('minute', e.target.value)} /> 分</span>
            )}
            {st.mode === 'everyN' && (
              <span className="schedule-inline">每 <input type="number" min="1" max="23" value={st.everyN} onChange={(e) => set('everyN', e.target.value)} /> 小时</span>
            )}
            {(st.mode === 'daily' || st.mode === 'weekly' || st.mode === 'monthly') && (
              <span className="schedule-inline">
                {st.mode === 'weekly' && (
                  <select value={st.weekday} onChange={(e) => set('weekday', e.target.value)}>
                    {WEEK.map((w, i) => <option key={i} value={i}>{w}</option>)}
                  </select>
                )}
                {st.mode === 'monthly' && (
                  <><input type="number" min="1" max="31" value={st.monthday} onChange={(e) => set('monthday', e.target.value)} /> 日</>
                )}
                <input type="number" min="0" max="23" value={st.hour} onChange={(e) => set('hour', e.target.value)} />
                <span>:</span>
                <input type="number" min="0" max="59" value={st.minute} onChange={(e) => set('minute', e.target.value)} />
              </span>
            )}
            {st.mode === 'custom' && (
              <input style={{ width: 180 }} className="mono" value={st.custom} placeholder="分 时 日 月 周"
                onChange={(e) => set('custom', e.target.value)} />
            )}
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>{describe(st)} · <code>{cron || '（空）'}</code></div>
        </>
      )}
      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => onSave({ enabled, cron })}>保存定时</button>
    </div>
  );
}

/* ---------------- 任务日志（按类型过滤，随 Tab） ---------------- */
function TaskLog({ tasks, type, onClear }) {
  const [openLog, setOpenLog] = useState(null);
  const rows = useMemo(() => (tasks || []).filter((t) => t.type === type), [tasks, type]);
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>任务日志</h3>
        <button className="btn sm" onClick={onClear}>清空已完成</button>
      </div>
      {rows.length === 0 ? <div className="muted small" style={{ marginTop: 10 }}>暂无任务记录</div> : (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead><tr><th>#</th><th>目标</th><th>状态</th><th>开始</th><th>结束</th><th>日志</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <Fragment key={t.id}>
                  <tr>
                    <td>{t.id}</td>
                    <td className="small">{t.ref_name || <span className="muted">-</span>}</td>
                    <td><span className={`badge ${STATUS_BADGE[t.status] || 'gray'}`}>{t.status === 'running' ? <><span className="spin" /> 运行中</> : t.status}</span></td>
                    <td className="muted small">{fmtDateTime(t.created_at)}</td>
                    <td className="muted small">{t.finished_at ? fmtDateTime(t.finished_at) : '-'}</td>
                    <td><button className="btn sm" onClick={() => setOpenLog(openLog === t.id ? null : t.id)}>{openLog === t.id ? '收起' : '查看'}</button></td>
                  </tr>
                  {openLog === t.id && (
                    <tr><td colSpan={6}><pre className="task-log">{t.log || '（无日志）'}</pre></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
