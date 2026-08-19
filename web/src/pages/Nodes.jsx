import { useState, useEffect } from 'react';
import { API } from '../api.js';
import { useConfirm, Modal, fmtDateTime } from '../ui.jsx';
import { useTable, SortTh } from '../hooks/useTable.jsx';
import { useCachedResource } from '../store.js';

export default function Nodes({ toast }) {
  const { data: rows = [], loading, refresh } = useCachedResource('nodes:', () => API.nodes());
  const { data: airports = [] } = useCachedResource('airports', () => API.airports());
  const [pinging, setPinging] = useState(false);
  const [probing, setProbing] = useState(false);
  const [trendNode, setTrendNode] = useState(null);
  const [confirm, confirmNode] = useConfirm();

  const load = () => refresh();

  const t = useTable(rows, { searchKeys: ['name', 'server', 'airport_name'], initialSort: { key: 'airport_id', dir: 'asc' } });
  const protocols = [...new Set(rows.map((r) => r.type))];

  const pingAll = async () => {
    setPinging(true);
    try {
      const ids = t.selected.size ? [...t.selected] : undefined;
      const r = await API.nodeLatency(ids);
      const msg = r && r.endpoints != null
        ? `延迟检测完成：${r.total} 节点 → ${r.endpoints} 个唯一端点${r.reused ? `（复用 ${r.reused}）` : ''}`
        : '延迟检测完成';
      toast.success(msg); load(); t.clearSelection();
    } catch (e) { toast.error(e.message); }
    finally { setPinging(false); }
  };
  const probeAll = async () => {
    setProbing(true);
    try {
      const ids = t.selected.size ? [...t.selected] : undefined;
      const r = await API.nodeProbe(ids);
      let msg = `可用性检测完成：连通 ${r.alive}，不通 ${r.dead}`;
      if (r.untestable) msg += `，${r.untestable} 个协议不支持`;
      toast.success(msg); load(); t.clearSelection();
    } catch (e) { toast.error(e.message); }
    finally { setProbing(false); }
  };
  const del = async (id) => { if (await confirm('删除该节点？')) { await API.deleteNode(id); load(); } };
  const batchDelete = async () => {
    if (!(await confirm(`删除选中的 ${t.selected.size} 个节点？`))) return;
    await API.batchDeleteNodes([...t.selected]); t.clearSelection(); load();
  };

  return (
    <>
      <div className="page-head"><h1>节点管理</h1></div>
      <div className="toolbar">
        <input className="search" placeholder="搜索节点名/服务器" value={t.query} onChange={(e) => t.setQuery(e.target.value)} />
        <select style={{ width: 160 }} value={t.filters.airport_id || ''} onChange={(e) => t.setFilters((f) => ({ ...f, airport_id: e.target.value }))}>
          <option value="">全部机场</option>
          {airports.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select style={{ width: 130 }} value={t.filters.type || ''} onChange={(e) => t.setFilters((f) => ({ ...f, type: e.target.value }))}>
          <option value="">全部协议</option>
          {protocols.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="spacer" />
        <button className="btn sm" onClick={pingAll} disabled={pinging || probing}>{pinging ? <span className="spin" /> : (t.selected.size ? `延迟(${t.selected.size})` : '检测全部延迟')}</button>
        <button className="btn sm" onClick={probeAll} disabled={pinging || probing} title="通过 sing-box 真实连接测试可用性（非仅端口连通）">
          {probing ? <span className="spin" /> : (t.selected.size ? `可用性(${t.selected.size})` : '可用性检测')}
        </button>
        {t.selected.size > 0 && <button className="btn sm danger" onClick={batchDelete}>批量删除</button>}
      </div>

      {loading && rows.length === 0 ? <div className="empty"><span className="spin" /></div>
        : rows.length === 0 ? <div className="empty">暂无节点，请到机场管理拉取订阅。</div>
        : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="nosort"><input type="checkbox" checked={t.allSelected} onChange={t.toggleSelectAll} /></th>
                  <SortTh label="节点名" k="name" table={t} />
                  <SortTh label="协议" k="type" table={t} />
                  <th className="nosort">服务器</th>
                  <SortTh label="端口" k="port" table={t} />
                  <SortTh label="所属机场" k="airport_name" table={t} />
                  <SortTh label="延迟" k="latency" table={t} />
                  <th className="nosort" title="通过 sing-box 真实连接的可用性">可用性</th>
                  <th className="nosort" title="近7天检测的连通率">可用率</th>
                  <th className="nosort">操作</th>
                </tr>
              </thead>
              <tbody>
                {t.filtered.map((n) => (
                  <tr key={n.id}>
                    <td><input type="checkbox" checked={t.selected.has(n.id)} onChange={() => t.toggleSelect(n.id)} /></td>
                    <td>{n.name}</td>
                    <td><span className="badge blue">{n.type}</span></td>
                    <td className="mono small">{n.server}</td>
                    <td>{n.port}</td>
                    <td className="small">{n.airport_name || '-'}{n.airport_account ? <span className="muted"> / {n.airport_account}</span> : ''}</td>
                    <td>{latencyCell(n.latency, n.latency_at)}</td>
                    <td>{aliveCell(n.alive, n.alive_ms, n.alive_at)}</td>
                    <td>{uptimeCell(n.check_ok, n.check_total)}</td>
                    <td className="actions">
                      <button className="btn sm" onClick={() => setTrendNode(n)}>趋势</button>
                      <button className="btn sm danger" onClick={() => del(n.id)}>删</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <div className="mobile-cards">
        {t.filtered.map((n) => (
          <div className="mcard" key={n.id}>
            <div className="mrow"><strong>{n.name}</strong><span className="badge blue">{n.type}</span></div>
            <div className="mrow"><span className="k">服务器</span><span className="mono small">{n.server}:{n.port}</span></div>
            <div className="mrow"><span className="k">机场</span><span>{n.airport_name}</span></div>
            <div className="mrow"><span className="k">延迟</span>{latencyCell(n.latency, n.latency_at)}</div>
            <div className="mrow"><span className="k">可用性</span>{aliveCell(n.alive, n.alive_ms, n.alive_at)}</div>
            <div className="mrow"><span className="k">可用率</span>{uptimeCell(n.check_ok, n.check_total)}</div>
            <div className="mrow"><span className="k" /><button className="btn sm" onClick={() => setTrendNode(n)}>延迟趋势</button></div>
          </div>
        ))}
      </div>
      {trendNode && <LatencyTrendModal node={trendNode} toast={toast} onClose={() => setTrendNode(null)} />}
      {confirmNode}
    </>
  );
}

function latencyCell(l, at) {
  if (l == null) return <span className="muted">-</span>;
  const title = at ? `检测于 ${fmtDateTime(at)}` : undefined;
  if (l < 0) return <span className="badge red" title={title}>超时</span>;
  const cls = l < 200 ? 'green' : l < 500 ? 'yellow' : 'red';
  return <span className={`badge ${cls}`} title={title}>{l} ms</span>;
}

function uptimeCell(ok, total) {
  if (!total) return <span className="muted">-</span>;
  const pct = Math.round((ok / total) * 100);
  const cls = pct >= 95 ? 'green' : pct >= 80 ? 'yellow' : 'red';
  return <span className={`badge ${cls}`} title={`近7天 ${ok}/${total} 次连通`}>{pct}%</span>;
}

// real through-proxy availability (from the sing-box probe)
function aliveCell(alive, ms, at) {
  if (alive == null) return <span className="muted">-</span>;
  const title = at ? `实连检测于 ${fmtDateTime(at)}` : undefined;
  if (!alive) return <span className="badge red" title={title}>不通</span>;
  const label = ms != null && ms >= 0 ? `可用 ${ms}ms` : '可用';
  const cls = ms != null && ms >= 0 && ms < 800 ? 'green' : 'yellow';
  return <span className={`badge ${cls}`} title={title}>{label}</span>;
}

/* ---------------- 延迟趋势 ---------------- */
function LatencyTrendModal({ node, toast, onClose }) {
  const [history, setHistory] = useState(null);
  useEffect(() => {
    API.nodeHistory(node.id, 7).then(setHistory).catch((e) => { toast.error(e.message); setHistory([]); });
  }, [node.id]);

  const ok = (history || []).filter((h) => h.latency >= 0);
  const avg = ok.length ? Math.round(ok.reduce((s, h) => s + h.latency, 0) / ok.length) : null;
  const uptime = history && history.length ? Math.round((ok.length / history.length) * 100) : null;

  return (
    <Modal title={`延迟趋势 · ${node.name}`} onClose={onClose} wide>
      <div className="muted small" style={{ marginBottom: 10 }}>
        {node.server}:{node.port}　近7天检测 {history ? history.length : '—'} 次
        {avg != null && <>　平均 {avg} ms</>}
        {uptime != null && <>　可用率 {uptime}%</>}
      </div>
      {!history ? <div className="muted small"><span className="spin" /></div>
        : history.length === 0 ? <div className="muted small">暂无检测记录。到节点管理点「检测全部延迟」，或开启延迟检测自动化后会逐渐积累。</div>
        : <LatencyChart samples={history} />}
    </Modal>
  );
}

function LatencyChart({ samples }) {
  const W = 560, H = 160, pad = 26;
  const okVals = samples.filter((s) => s.latency >= 0).map((s) => s.latency);
  const max = Math.max(50, ...okVals);
  const t0 = samples[0].ts, t1 = samples[samples.length - 1].ts;
  const span = Math.max(1, t1 - t0);
  const x = (ts) => pad + ((ts - t0) / span) * (W - pad * 2);
  const y = (l) => H - pad - (l / max) * (H - pad * 2);

  // build the line only over successful readings; timeouts are drawn as red marks
  const pts = samples.filter((s) => s.latency >= 0).map((s) => `${x(s.ts).toFixed(1)},${y(s.latency).toFixed(1)}`).join(' ');
  const timeouts = samples.filter((s) => s.latency < 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--border)" />
      <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="var(--border)" />
      <text x={pad - 4} y={pad + 4} textAnchor="end" fontSize="10" fill="var(--text-dim)">{max}ms</text>
      <text x={pad - 4} y={H - pad} textAnchor="end" fontSize="10" fill="var(--text-dim)">0</text>
      {pts && <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" />}
      {samples.filter((s) => s.latency >= 0).map((s, i) => (
        <circle key={`o${i}`} cx={x(s.ts)} cy={y(s.latency)} r="2" fill="var(--accent)">
          <title>{`${fmtDateTime(s.ts)}：${s.latency} ms`}</title>
        </circle>
      ))}
      {timeouts.map((s, i) => (
        <circle key={`t${i}`} cx={x(s.ts)} cy={H - pad} r="3" fill="var(--red)">
          <title>{`${fmtDateTime(s.ts)}：超时`}</title>
        </circle>
      ))}
    </svg>
  );
}
