import { useState } from 'react';
import { API } from '../api.js';
import { Modal, useConfirm, copyText, fmtBytes, fmtDate, daysLeft, toDatetimeLocal, fromDatetimeLocal } from '../ui.jsx';
import { useTable, SortTh } from '../hooks/useTable.jsx';
import { useCachedResource, invalidate } from '../store.js';
import { GroupSelect, GroupManagerModal, UAField, HeadersEditor, ProxyBuilder, NodeProcessingEditor } from '../components.jsx';

const PANEL_TYPES = [
  { v: 'generic', l: '通用 (自动识别)' },
  { v: 'sspanel', l: 'SSPanel-Uim' },
  { v: 'v2board', l: 'V2Board' },
  { v: 'xboard', l: 'Xboard' },
  { v: 'manual', l: '手动 (仅订阅链接)' },
];

function safeParse(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

export default function Airports({ toast }) {
  const { data: rows = [], loading, refresh } = useCachedResource('airports', () => API.airports());
  const { data: groups = [], refresh: refreshGroups } = useCachedResource('groups:airport', () => API.groups('airport'));
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState({});
  const [showGroups, setShowGroups] = useState(false);
  const [batchGroup, setBatchGroup] = useState('');
  const [confirm, confirmNode] = useConfirm();

  const load = () => refresh();
  const t = useTable(rows, { searchKeys: ['name', 'url', 'account', 'group_name', 'remark'], initialSort: { key: 'id', dir: 'desc' } });
  const setRowBusy = (id, v) => setBusy((b) => ({ ...b, [id]: v }));

  const doFetch = async (id) => {
    setRowBusy(id, 'fetch');
    try { const r = await API.fetchAirport(id); toast.success(`拉取成功，${r.count} 个节点`); invalidate('nodes:'); load(); }
    catch (e) { toast.error(e.message); }
    finally { setRowBusy(id, null); }
  };
  const doReset = async (id) => {
    if (!(await confirm('将自动登录机场重置订阅并回填，确认执行？进度见「自动化」页。'))) return;
    setRowBusy(id, 'reset');
    try { const r = await API.resetAirport(id); toast.success(`重置成功，新增 ${r.count} 节点`); invalidate('nodes:'); load(); }
    catch (e) { toast.error(e.message); }
    finally { setRowBusy(id, null); }
  };
  const doDelete = async (id) => {
    if (!(await confirm('确认删除该机场？其节点也会被删除。'))) return;
    await API.deleteAirport(id); toast.success('已删除'); invalidate('nodes:'); load();
  };
  const batchDelete = async () => {
    if (!(await confirm(`确认删除选中的 ${t.selected.size} 个机场？`))) return;
    await API.batchDeleteAirports([...t.selected]); t.clearSelection(); toast.success('已批量删除'); invalidate('nodes:'); load();
  };
  const batchFetch = async () => {
    toast.info('开始批量拉取…');
    await API.batchFetchAirports([...t.selected]); t.clearSelection(); toast.success('批量拉取完成'); invalidate('nodes:'); load();
  };
  return (
    <>
      <div className="page-head">
        <h1>机场管理</h1>
        <div className="btn-row">
          <button className="btn" onClick={() => setShowGroups(true)}>分组管理</button>
          <button className="btn primary" onClick={() => setEditing({})}>+ 新增机场</button>
        </div>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="搜索名称/网址/账户/备注" value={t.query} onChange={(e) => t.setQuery(e.target.value)} />
        <select style={{ width: 140 }} value={t.filters.group_name || ''} onChange={(e) => t.setFilters((f) => ({ ...f, group_name: e.target.value }))}>
          <option value="">全部分组</option>
          {groups.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
        </select>
        <select style={{ width: 150 }} value={t.filters.panel_type || ''} onChange={(e) => t.setFilters((f) => ({ ...f, panel_type: e.target.value }))}>
          <option value="">全部面板类型</option>
          {PANEL_TYPES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
        </select>
        <div className="spacer" />
        {t.selected.size > 0 && (
          <>
            <span className="muted small">已选 {t.selected.size}</span>
            <select style={{ width: 130 }} value={batchGroup} onChange={(e) => setBatchGroup(e.target.value)}>
              <option value="">设为分组…</option>
              <option value="__none__">无分组</option>
              {groups.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
            </select>
            <button className="btn sm" disabled={!batchGroup} onClick={() => { const v = batchGroup === '__none__' ? '' : batchGroup; API.batchGroupAirports([...t.selected], v || null).then(() => { t.clearSelection(); setBatchGroup(''); toast.success('已设置分组'); load(); }); }}>应用</button>
            <button className="btn sm" onClick={batchFetch}>批量拉取</button>
            <button className="btn sm danger" onClick={batchDelete}>批量删除</button>
          </>
        )}
      </div>

      {loading && rows.length === 0 ? <div className="empty"><span className="spin" /></div>
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
                    <td><UsageCell used={a.used_traffic} total={a.total_traffic} /></td>
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
            <div className="mrow"><span className="k">用量</span><UsageCell used={a.used_traffic} total={a.total_traffic} /></div>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => doFetch(a.id)}>拉取</button>
              <button className="btn sm" onClick={() => doReset(a.id)}>重置</button>
              <button className="btn sm" onClick={() => setEditing(a)}>编辑</button>
              <button className="btn sm danger" onClick={() => doDelete(a.id)}>删</button>
            </div>
          </div>
        ))}
      </div>

      {editing && <AirportModal airport={editing} groups={groups} toast={toast} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); refreshGroups(); }} />}
      {showGroups && <GroupManagerModal kind="airport" title="机场分组管理" toast={toast} onClose={() => setShowGroups(false)} onChanged={() => { refreshGroups(); load(); }} />}
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

function UsageCell({ used, total }) {
  if (used == null && total == null) return <span className="muted">-</span>;
  const u = Number(used || 0);
  const t = Number(total || 0);
  const pct = t > 0 ? Math.min(100, Math.round((u / t) * 100)) : 0;
  const remaining = t > 0 ? Math.max(0, t - u) : null;
  const cls = pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green';
  return (
    <div style={{ minWidth: 130 }}>
      <div className="usage-bar"><span className={`usage-fill ${cls}`} style={{ width: `${pct}%` }} /></div>
      <div className="small muted" style={{ marginTop: 3 }}>
        {fmtBytes(u)} / {t > 0 ? fmtBytes(t) : '不限'}
        {remaining != null && <span> · 余 {fmtBytes(remaining)}</span>}
      </div>
    </div>
  );
}

function AirportModal({ airport, groups, toast, onClose, onSaved }) {
  const isNew = !airport.id;
  const [f, setF] = useState({
    name: airport.name || '', url: airport.url || '', account: airport.account || '',
    password: airport.password || '', sub_url: airport.sub_url || '',
    panel_type: airport.panel_type || 'sspanel', group_name: airport.group_name || '',
    remark: airport.remark || '', proxy: airport.proxy || '',
    user_agent: airport.user_agent || '', cookie: airport.cookie || '',
    request_headers: safeParse(airport.request_headers),
    node_filter: safeParse(airport.node_filter),
    expire_at: toDatetimeLocal(airport.expire_at),
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) return toast.error('机场名称必填');
    setSaving(true);
    const body = {
      ...f,
      request_headers: JSON.stringify(f.request_headers || {}),
      node_filter: JSON.stringify(f.node_filter || {}),
      expire_at: fromDatetimeLocal(f.expire_at),
    };
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
        <div className="field"><label>分组</label><GroupSelect value={f.group_name} groups={groups} onChange={(v) => set('group_name', v)} /></div>
        <div className="field"><label>账户到期</label><input type="datetime-local" value={f.expire_at} onChange={(e) => set('expire_at', e.target.value)} /></div>
      </div>

      <div className="section-label">拉取设置</div>
      <div className="field"><label>User-Agent（订阅拉取标识）</label><UAField value={f.user_agent} onChange={(v) => set('user_agent', v)} /></div>
      <div className="field"><label>拉取代理</label><ProxyBuilder value={f.proxy} onChange={(v) => set('proxy', v)} /></div>
      <div className="field"><label>请求头</label><HeadersEditor value={f.request_headers} onChange={(v) => set('request_headers', v)} /></div>
      <div className="field">
        <label>Cookie（可选，用于绕过人机验证/防护）</label>
        <input value={f.cookie} onChange={(e) => set('cookie', e.target.value)} placeholder="在浏览器通过验证后从开发者工具复制粘贴" />
      </div>

      <div className="section-label">节点处理</div>
      <NodeProcessingEditor value={f.node_filter} onChange={(v) => set('node_filter', v)} />

      <div className="field" style={{ marginTop: 14 }}><label>备注</label><input value={f.remark} onChange={(e) => set('remark', e.target.value)} /></div>
    </Modal>
  );
}
