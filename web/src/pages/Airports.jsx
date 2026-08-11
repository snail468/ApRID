import { useState, useEffect, useCallback } from 'react';
import { API } from '../api.js';
import { Modal, useConfirm, copyText, fmtBytes, fmtDate, daysLeft, toDatetimeLocal, fromDatetimeLocal } from '../ui.jsx';
import { useTable, SortTh } from '../hooks/useTable.jsx';

const PANEL_TYPES = [
  { v: 'sspanel', l: 'SSPanel-Uim' },
  { v: 'v2board', l: 'V2Board' },
  { v: 'xboard', l: 'Xboard' },
  { v: 'manual', l: '手动 (仅订阅链接)' },
];

export default function Airports({ toast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // airport or {} for new
  const [busy, setBusy] = useState({});
  const [confirm, confirmNode] = useConfirm();

  const load = useCallback(() => {
    setLoading(true);
    API.airports().then(setRows).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [toast]);
  useEffect(load, [load]);

  const t = useTable(rows, { searchKeys: ['name', 'url', 'account', 'group_name', 'remark'], initialSort: { key: 'id', dir: 'desc' } });

  const setRowBusy = (id, v) => setBusy((b) => ({ ...b, [id]: v }));

  const doFetch = async (id) => {
    setRowBusy(id, 'fetch');
    try { const r = await API.fetchAirport(id); toast.success(`拉取成功，${r.count} 个节点`); load(); }
    catch (e) { toast.error(e.message); }
    finally { setRowBusy(id, null); }
  };
  const doReset = async (id) => {
    if (!(await confirm('将自动登录机场重置订阅并回填，确认执行？'))) return;
    setRowBusy(id, 'reset');
    try { const r = await API.resetAirport(id); toast.success(`重置成功，新增 ${r.count} 节点`); load(); }
    catch (e) { toast.error(e.message); }
    finally { setRowBusy(id, null); }
  };
  const doDelete = async (id) => {
    if (!(await confirm('确认删除该机场？其节点也会被删除。'))) return;
    await API.deleteAirport(id); toast.success('已删除'); load();
  };
  const batchDelete = async () => {
    if (!(await confirm(`确认删除选中的 ${t.selected.size} 个机场？`))) return;
    await API.batchDeleteAirports([...t.selected]); t.clearSelection(); toast.success('已批量删除'); load();
  };
  const batchFetch = async () => {
    toast.info('开始批量拉取…');
    await API.batchFetchAirports([...t.selected]); t.clearSelection(); toast.success('批量拉取完成'); load();
  };

  const groups = [...new Set(rows.map((r) => r.group_name).filter(Boolean))];

  return (
    <>
      <div className="page-head">
        <h1>机场管理</h1>
        <button className="btn primary" onClick={() => setEditing({})}>+ 新增机场</button>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="搜索名称/网址/账户/备注" value={t.query} onChange={(e) => t.setQuery(e.target.value)} />
        <select style={{ width: 140 }} value={t.filters.group_name || ''} onChange={(e) => t.setFilters((f) => ({ ...f, group_name: e.target.value }))}>
          <option value="">全部分组</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select style={{ width: 150 }} value={t.filters.panel_type || ''} onChange={(e) => t.setFilters((f) => ({ ...f, panel_type: e.target.value }))}>
          <option value="">全部面板类型</option>
          {PANEL_TYPES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
        </select>
        <div className="spacer" />
        {t.selected.size > 0 && (
          <>
            <span className="muted small">已选 {t.selected.size}</span>
            <button className="btn sm" onClick={batchFetch}>批量拉取</button>
            <button className="btn sm danger" onClick={batchDelete}>批量删除</button>
          </>
        )}
      </div>

      {loading ? <div className="empty"><span className="spin" /></div>
        : rows.length === 0 ? <div className="empty">还没有机场，点击右上角新增。</div>
        : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="nosort"><input type="checkbox" checked={t.allSelected} onChange={t.toggleSelectAll} /></th>
                  <SortTh label="名称" k="name" table={t} />
                  <th className="nosort">网址</th>
                  <th className="nosort">账户</th>
                  <th className="nosort">面板</th>
                  <SortTh label="节点" k="node_count" table={t} />
                  <SortTh label="到期" k="expire_at" table={t} />
                  <th className="nosort">用量</th>
                  <SortTh label="分组" k="group_name" table={t} />
                  <th className="nosort">操作</th>
                </tr>
              </thead>
              <tbody>
                {t.filtered.map((a) => (
                  <tr key={a.id}>
                    <td><input type="checkbox" checked={t.selected.has(a.id)} onChange={() => t.toggleSelect(a.id)} /></td>
                    <td><strong>{a.name}</strong>{a.remark && <div className="muted small">{a.remark}</div>}</td>
                    <td>{a.url ? <a href={a.url} target="_blank" rel="noreferrer">跳转 ↗</a> : '-'}</td>
                    <td>
                      {a.account ? (
                        <span className="pill-copy mono" title="点击复制账号" onClick={() => copyText(a.account, toast)}>{a.account}</span>
                      ) : '-'}
                      {a.password && <span className="pill-copy small muted" title="点击复制密码" onClick={() => copyText(a.password, toast)}> 🔑</span>}
                    </td>
                    <td><span className="badge blue">{a.panel_type}</span></td>
                    <td>{a.node_count}</td>
                    <td>{expireCell(a.expire_at)}</td>
                    <td className="small muted">{a.used_traffic != null ? `${fmtBytes(a.used_traffic)}/${fmtBytes(a.total_traffic)}` : '-'}</td>
                    <td>{a.group_name || '-'}</td>
                    <td className="actions">
                      <button className="btn sm" disabled={busy[a.id]} onClick={() => doFetch(a.id)}>{busy[a.id] === 'fetch' ? <span className="spin" /> : '拉取'}</button>
                      <button className="btn sm" disabled={busy[a.id]} onClick={() => doReset(a.id)} title="自动重置订阅">{busy[a.id] === 'reset' ? <span className="spin" /> : '重置'}</button>
                      <button className="btn sm" onClick={() => setEditing(a)}>编辑</button>
                      <button className="btn sm danger" onClick={() => doDelete(a.id)}>删</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {/* mobile cards */}
      <div className="mobile-cards">
        {t.filtered.map((a) => (
          <div className="mcard" key={a.id}>
            <div className="mrow"><strong>{a.name}</strong><span className="badge blue">{a.panel_type}</span></div>
            <div className="mrow"><span className="k">账户</span><span className="mono">{a.account || '-'}</span></div>
            <div className="mrow"><span className="k">节点</span><span>{a.node_count}</span></div>
            <div className="mrow"><span className="k">到期</span>{expireCell(a.expire_at)}</div>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => doFetch(a.id)}>拉取</button>
              <button className="btn sm" onClick={() => doReset(a.id)}>重置</button>
              <button className="btn sm" onClick={() => setEditing(a)}>编辑</button>
              <button className="btn sm danger" onClick={() => doDelete(a.id)}>删</button>
            </div>
          </div>
        ))}
      </div>

      {editing && <AirportModal airport={editing} toast={toast} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {confirmNode}
    </>
  );
}

function expireCell(ms) {
  if (!ms) return <span className="muted">-</span>;
  const d = daysLeft(ms);
  const cls = d < 0 ? 'red' : d <= 3 ? 'yellow' : 'green';
  return <span className={`badge ${cls}`}>{fmtDate(ms)}{d >= 0 ? ` (${d}天)` : ' 已过期'}</span>;
}

function AirportModal({ airport, toast, onClose, onSaved }) {
  const isNew = !airport.id;
  const [f, setF] = useState({
    name: airport.name || '', url: airport.url || '', account: airport.account || '',
    password: airport.password || '', sub_url: airport.sub_url || '',
    panel_type: airport.panel_type || 'sspanel', group_name: airport.group_name || '',
    remark: airport.remark || '', proxy: airport.proxy || '',
    request_headers: airport.request_headers || '{}',
    node_filter: airport.node_filter || '{}',
    expire_at: toDatetimeLocal(airport.expire_at),
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) return toast.error('机场名称必填');
    // validate JSON fields
    for (const k of ['request_headers', 'node_filter']) {
      try { JSON.parse(f[k] || '{}'); } catch { return toast.error(`${k} 不是合法 JSON`); }
    }
    setSaving(true);
    const body = { ...f, expire_at: fromDatetimeLocal(f.expire_at) };
    try {
      if (isNew) await API.createAirport(body);
      else await API.updateAirport(airport.id, body);
      toast.success('已保存'); onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal wide title={isNew ? '新增机场' : `编辑机场 · ${airport.name}`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? <span className="spin" /> : '保存'}</button>
      </>}>
      <div className="field-row">
        <div className="field"><label>机场名称 *</label><input value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="field"><label>面板类型</label>
          <select value={f.panel_type} onChange={(e) => set('panel_type', e.target.value)}>
            {PANEL_TYPES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label>机场网址</label><input value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://example.com" /></div>
      <div className="field-row">
        <div className="field"><label>机场账号</label><input value={f.account} onChange={(e) => set('account', e.target.value)} /></div>
        <div className="field"><label>机场密码</label><input value={f.password} onChange={(e) => set('password', e.target.value)} /></div>
      </div>
      <div className="field"><label>订阅链接</label><input value={f.sub_url} onChange={(e) => set('sub_url', e.target.value)} placeholder="https://example.com/link/xxxx" /></div>
      <div className="field-row">
        <div className="field"><label>分组</label><input value={f.group_name} onChange={(e) => set('group_name', e.target.value)} /></div>
        <div className="field"><label>账户到期</label><input type="datetime-local" value={f.expire_at} onChange={(e) => set('expire_at', e.target.value)} /></div>
      </div>
      <div className="field"><label>拉取代理（可选，http/socks5://…）</label><input value={f.proxy} onChange={(e) => set('proxy', e.target.value)} /></div>
      <div className="field"><label>请求头 (JSON)</label><textarea value={f.request_headers} onChange={(e) => set('request_headers', e.target.value)} placeholder='{"User-Agent":"clash"}' /></div>
      <div className="field">
        <label>节点处理 (JSON)：include/exclude 正则、protocols 数组、prefix 前缀、rename 规则、globalPrefix 跨机场唯一前缀</label>
        <textarea value={f.node_filter} onChange={(e) => set('node_filter', e.target.value)}
          placeholder='{"exclude":"官网|流量|过期","prefix":"🇭🇰","protocols":["vmess","trojan"],"rename":[{"from":"HK","to":"香港"}],"globalPrefix":"A-"}' />
      </div>
      <div className="field"><label>备注</label><input value={f.remark} onChange={(e) => set('remark', e.target.value)} /></div>
    </Modal>
  );
}
