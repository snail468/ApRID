import { useState } from 'react';
import { API } from '../api.js';
import { useConfirm } from '../ui.jsx';
import { useTable, SortTh } from '../hooks/useTable.jsx';
import { useCachedResource } from '../store.js';

export default function Nodes({ toast }) {
  const { data: rows = [], loading, refresh } = useCachedResource('nodes:', () => API.nodes());
  const { data: airports = [] } = useCachedResource('airports', () => API.airports());
  const [pinging, setPinging] = useState(false);
  const [confirm, confirmNode] = useConfirm();

  const load = () => refresh();

  const t = useTable(rows, { searchKeys: ['name', 'server', 'airport_name'], initialSort: { key: 'airport_id', dir: 'asc' } });
  const protocols = [...new Set(rows.map((r) => r.type))];

  const pingAll = async () => {
    setPinging(true);
    try {
      const ids = t.selected.size ? [...t.selected] : undefined;
      await API.nodeLatency(ids);
      toast.success('延迟检测完成'); load(); t.clearSelection();
    } catch (e) { toast.error(e.message); }
    finally { setPinging(false); }
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
        <button className="btn sm" onClick={pingAll} disabled={pinging}>{pinging ? <span className="spin" /> : (t.selected.size ? `检测选中(${t.selected.size})` : '检测全部延迟')}</button>
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
                    <td>{latencyCell(n.latency)}</td>
                    <td className="actions"><button className="btn sm danger" onClick={() => del(n.id)}>删</button></td>
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
            <div className="mrow"><span className="k">延迟</span>{latencyCell(n.latency)}</div>
          </div>
        ))}
      </div>
      {confirmNode}
    </>
  );
}

function latencyCell(l) {
  if (l == null) return <span className="muted">-</span>;
  if (l < 0) return <span className="badge red">超时</span>;
  const cls = l < 200 ? 'green' : l < 500 ? 'yellow' : 'red';
  return <span className={`badge ${cls}`}>{l} ms</span>;
}
