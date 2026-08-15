import { API } from '../api.js';
import { fmtDate, fmtDateTime, fmtBytes } from '../ui.jsx';
import { useCachedResource } from '../store.js';

export default function Dashboard() {
  const { data: stats, loading, error } = useCachedResource('stats', () => API.stats());

  if (error && !stats) return <div className="empty">加载失败：{error.message}</div>;
  if (loading && !stats) return <div className="empty"><span className="spin" /></div>;
  if (!stats) return <div className="empty"><span className="spin" /></div>;

  const s = stats.userStatus || {};
  const acc = stats.accounting || {};
  const board = stats.airportBoard || [];
  return (
    <>
      <div className="page-head"><h1>仪表盘</h1></div>
      <div className="stat-grid">
        <Stat n={stats.airports} l="机场数" />
        <Stat n={stats.nodes} l="节点总数" />
        <Stat n={stats.users} l="用户总数" />
        <Stat n={s.active || 0} l="正常用户" color="var(--green)" />
        <Stat n={s.expiring || 0} l="≤3天到期" color="var(--yellow)" />
        <Stat n={(s.expired || 0) + (s.exhausted || 0)} l="过期/超限" color="var(--red)" />
        <Stat n={s.disabled || 0} l="已停用" color="var(--gray)" />
      </div>

      {/* 成本 / 收益记账 */}
      <div className="stat-grid" style={{ marginTop: 16 }}>
        <Stat n={`¥${(acc.totalRevenue || 0).toFixed(2)}`} l="月收益(启用用户收费)" color="var(--green)" />
        <Stat n={`¥${(acc.totalCost || 0).toFixed(2)}`} l="月成本(机场合计)" color="var(--yellow)" />
        <Stat n={`¥${(acc.profit || 0).toFixed(2)}`} l="月毛利" color={acc.profit >= 0 ? 'var(--green)' : 'var(--red)'} />
      </div>

      {/* 机场集中看板 */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>机场看板</h3>
        {board.length === 0 ? <div className="muted small">暂无机场</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>机场</th><th>节点</th><th>用量</th><th>到期</th><th>最后拉取</th><th>状态</th></tr></thead>
              <tbody>
                {board.map((a) => <AirportRow key={a.id} a={a} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>最近任务</h3>
        {(!stats.recentTasks || !stats.recentTasks.length)
          ? <div className="muted small">暂无任务记录</div>
          : (
            <table>
              <thead><tr><th>类型</th><th>目标</th><th>状态</th><th>时间</th></tr></thead>
              <tbody>
                {stats.recentTasks.map((t) => (
                  <tr key={t.id}>
                    <td>{taskLabel(t.type)}</td>
                    <td className="small">{t.ref_name || <span className="muted">-</span>}</td>
                    <td><span className={`badge ${statusColor(t.status)}`}>{t.status}</span></td>
                    <td className="muted small">{fmtDateTime(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </>
  );
}

function Stat({ n, l, color }) {
  return <div className="stat"><div className="n" style={{ color }}>{n}</div><div className="l">{l}</div></div>;
}

const DAY = 86400000;
function AirportRow({ a }) {
  const now = Date.now();
  const pct = a.total_traffic > 0 ? Math.min(100, Math.round((a.used_traffic / a.total_traffic) * 100)) : null;
  const days = a.expire_at ? Math.ceil((a.expire_at - now) / DAY) : null;
  const expColor = days == null ? '' : days < 0 ? 'var(--red)' : days <= 1 ? 'var(--red)' : days <= 3 ? 'var(--yellow)' : '';
  const fails = Number(a.fetch_fail_count || 0);
  let badge;
  if (fails >= 3) badge = <span className="badge red">拉取失败×{fails}</span>;
  else if (days != null && days < 0) badge = <span className="badge red">已到期</span>;
  else if (days != null && days <= 1) badge = <span className="badge red">≤1天到期</span>;
  else if (pct != null && pct >= 97) badge = <span className="badge yellow">用量{pct}%</span>;
  else badge = <span className="badge green">正常</span>;
  return (
    <tr>
      <td><strong>{a.name}</strong>{a.account ? <div className="muted small">{a.account}</div> : null}</td>
      <td>{a.node_count}</td>
      <td className="small">
        {a.total_traffic > 0 ? `${fmtBytes(a.used_traffic)} / ${fmtBytes(a.total_traffic)}` : (a.used_traffic ? fmtBytes(a.used_traffic) : '-')}
        {pct != null && (
          <div style={{ height: 5, borderRadius: 4, background: 'var(--border)', marginTop: 3, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: pct >= 97 ? 'var(--red)' : 'var(--accent)' }} />
          </div>
        )}
      </td>
      <td className="small" style={{ color: expColor }}>{a.expire_at ? fmtDate(a.expire_at) : '-'}</td>
      <td className="muted small">{a.last_fetch_at ? fmtDateTime(a.last_fetch_at) : '从未'}</td>
      <td>{badge}</td>
    </tr>
  );
}
function taskLabel(t) {
  return { airport_reset: '机场订阅重置', traffic_stats: '用户流量统计', node_fetch: '节点拉取', latency: '延迟检测' }[t] || t;
}
function statusColor(s) {
  return { success: 'green', failed: 'red', running: 'blue', pending: 'gray' }[s] || 'gray';
}
