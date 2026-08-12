import { API } from '../api.js';
import { fmtDate } from '../ui.jsx';
import { useCachedResource } from '../store.js';

export default function Dashboard() {
  const { data: stats, loading, error } = useCachedResource('stats', () => API.stats());

  if (error && !stats) return <div className="empty">加载失败：{error.message}</div>;
  if (loading && !stats) return <div className="empty"><span className="spin" /></div>;
  if (!stats) return <div className="empty"><span className="spin" /></div>;

  const s = stats.userStatus || {};
  return (
    <>
      <div className="page-head"><h1>仪表盘</h1></div>
      <div className="stat-grid">
        <Stat n={stats.airports} l="机场数" />
        <Stat n={stats.nodes} l="节点总数" />
        <Stat n={stats.users} l="用户总数" />
        <Stat n={s.active || 0} l="正常用户" color="var(--green)" />
        <Stat n={s.expiring || 0} l="≤3天到期" color="var(--yellow)" />
        <Stat n={s.expired || 0} l="已过期" color="var(--red)" />
        <Stat n={s.disabled || 0} l="已停用" color="var(--gray)" />
      </div>

      <div className="card">
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
function taskLabel(t) {
  return { airport_reset: '机场订阅重置', traffic_stats: '用户流量统计', node_fetch: '节点拉取', latency: '延迟检测' }[t] || t;
}
function statusColor(s) {
  return { success: 'green', failed: 'red', running: 'blue', pending: 'gray' }[s] || 'gray';
}
function fmtDateTime(ms) {
  if (!ms) return '-';
  return new Date(Number(ms)).toLocaleString('zh-CN');
}
