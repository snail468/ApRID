import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { API } from '../api.js';
import { fmtDate } from '../ui.jsx';
import { invalidate } from '../store.js';

const TASK_LABEL = {
  airport_reset: '机场订阅重置', traffic_stats: '用户流量统计',
  node_fetch: '节点拉取', latency: '延迟检测',
};
const STATUS_BADGE = { success: 'green', failed: 'red', running: 'blue', pending: 'gray' };

export default function Automation({ toast }) {
  const [overview, setOverview] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [running, setRunning] = useState('');   // which automation is running
  const [openLog, setOpenLog] = useState(null); // task id whose log is expanded
  const [testing, setTesting] = useState(null);  // airport id being tested
  const [testResult, setTestResult] = useState({}); // airportId -> {ok,msg}
  const timer = useRef(null);

  const loadTasks = useCallback(() => API.tasks().then(setTasks).catch(() => {}), []);
  const loadOverview = useCallback(() => API.automationOverview().then(setOverview).catch((e) => toast.error(e.message)), [toast]);

  useEffect(() => { loadOverview(); loadTasks(); }, [loadOverview, loadTasks]);

  // poll while any task is running so progress/logs update live
  useEffect(() => {
    const anyRunning = tasks.some((t) => t.status === 'running') || running;
    clearInterval(timer.current);
    if (anyRunning) {
      timer.current = setInterval(() => { loadTasks(); loadOverview(); }, 1500);
    }
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
        所有自动化任务均需在此显式运行；每个任务的自动触发条件见下方卡片，运行过程与报错见任务日志。
      </p>

      <div className="auto-grid">
        {/* 机场订阅自动重置 */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>🔄 机场订阅自动重置</h3>
          <p className="muted small">后台登录机场 → 重置订阅 → 回填链接 → 拉取一次。</p>
          <TriggerInfo meta={metaOf('airport_reset')} />
          <ScheduleEditor meta={metaOf('airport_reset')} onSave={(cfg) => saveSchedule('airport_reset', cfg)} />
          <div className="btn-row" style={{ marginBottom: 12 }}>
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
        </div>

        {/* 用户流量统计 */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>📊 用户流量统计</h3>
          <p className="muted small">
            按机场账户用量估算每个用户已用流量（B−A），达到「流量上限」的用户订阅将自动切断。
            首次运行仅建立基线（A）。
          </p>
          <TriggerInfo meta={metaOf('traffic_stats')} />
          <ScheduleEditor meta={metaOf('traffic_stats')} onSave={(cfg) => saveSchedule('traffic_stats', cfg)} />
          <button className="btn primary" disabled={running === 'traffic_stats'} onClick={runTraffic}>
            {running === 'traffic_stats' ? <span className="spin" /> : '▶ 立即统计'}
          </button>
          <LastRun task={overview?.automations?.find((x) => x.key === 'traffic_stats')?.last} />
        </div>
      </div>

      {/* task log history */}
      <div className="card" style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>任务日志</h3>
          <button className="btn sm" onClick={clearTasks}>清空已完成</button>
        </div>
        {tasks.length === 0 ? <div className="muted small" style={{ marginTop: 12 }}>暂无任务记录</div> : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>#</th><th>类型</th><th>目标</th><th>状态</th><th>开始</th><th>结束</th><th>日志</th></tr></thead>
              <tbody>
                {tasks.map((t) => (
                  <Fragment key={t.id}>
                    <tr>
                      <td>{t.id}</td>
                      <td>{TASK_LABEL[t.type] || t.type}</td>
                      <td className="small">{t.ref_name || <span className="muted">-</span>}</td>
                      <td><span className={`badge ${STATUS_BADGE[t.status] || 'gray'}`}>{t.status === 'running' ? <><span className="spin" /> 运行中</> : t.status}</span></td>
                      <td className="muted small">{fmtDateTime(t.created_at)}</td>
                      <td className="muted small">{t.finished_at ? fmtDateTime(t.finished_at) : '-'}</td>
                      <td><button className="btn sm" onClick={() => setOpenLog(openLog === t.id ? null : t.id)}>{openLog === t.id ? '收起' : '查看'}</button></td>
                    </tr>
                    {openLog === t.id && (
                      <tr>
                        <td colSpan={7}><pre className="task-log">{t.log || '（无日志）'}</pre></td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function TriggerInfo({ meta }) {
  if (!meta) return null;
  return (
    <div className="trigger-info">
      <div className="small"><strong>自动触发条件</strong></div>
      {meta.autoTriggers && meta.autoTriggers.length > 0 ? (
        <ul className="trigger-list">
          {meta.autoTriggers.map((line, i) => <li key={i} className="muted small">{line}</li>)}
        </ul>
      ) : (
        <div className="muted small">无自动触发条件</div>
      )}
      {meta.scheduleText && <div className="muted small" style={{ marginTop: 2 }}>⏱ 定时：{meta.scheduleText}</div>}
    </div>
  );
}

function ScheduleEditor({ meta, onSave }) {
  const s = meta?.schedule;
  const [cfg, setCfg] = useState(null);
  useEffect(() => {
    if (s) setCfg({ enabled: !!s.enabled, type: s.type || 'daily', hour: s.hour ?? 4, minute: s.minute ?? 0, intervalHours: s.intervalHours ?? 24 });
  }, [s?.enabled, s?.type, s?.hour, s?.minute, s?.intervalHours]);
  if (!cfg) return null;
  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  return (
    <div className="schedule-editor">
      <label className="checkbox-inline">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        <span>开启定时任务</span>
      </label>
      {cfg.enabled && (
        <div className="schedule-row">
          <select value={cfg.type} onChange={(e) => set('type', e.target.value)}>
            <option value="daily">每天定点</option>
            <option value="interval">按小时间隔</option>
          </select>
          {cfg.type === 'daily' ? (
            <span className="schedule-inline">
              <input type="number" min="0" max="23" value={cfg.hour} onChange={(e) => set('hour', e.target.value)} />
              <span>:</span>
              <input type="number" min="0" max="59" value={cfg.minute} onChange={(e) => set('minute', e.target.value)} />
            </span>
          ) : (
            <span className="schedule-inline">
              每 <input type="number" min="1" max="168" value={cfg.intervalHours} onChange={(e) => set('intervalHours', e.target.value)} /> 小时
            </span>
          )}
        </div>
      )}
      <button className="btn sm" onClick={() => onSave(cfg)}>保存定时</button>
    </div>
  );
}

function LastRun({ task }) {
  if (!task) return <div className="muted small" style={{ marginTop: 10 }}>尚未运行</div>;
  return (
    <div className="muted small" style={{ marginTop: 10 }}>
      上次：<span className={`badge ${STATUS_BADGE[task.status] || 'gray'}`}>{task.status}</span> · {fmtDateTime(task.created_at)}
    </div>
  );
}

function fmtDateTime(ms) {
  if (!ms) return '-';
  return new Date(Number(ms)).toLocaleString('zh-CN');
}
