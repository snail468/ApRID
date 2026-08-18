import { useState, useEffect, useMemo } from 'react';
import QRCode from 'qrcode';
import { API } from '../api.js';
import { Modal, useConfirm, copyText, fmtBytes, fmtDate, fmtDateTime, daysLeft, toDatetimeLocal, fromDatetimeLocal, ActionMenu } from '../ui.jsx';
import { useTable, SortTh } from '../hooks/useTable.jsx';
import { useCachedResource, invalidate } from '../store.js';
import { GroupSelect, GroupManagerModal, ProtocolPicker, RulePreview } from '../components.jsx';

const STATUS_LABEL = { active: '正常', expiring: '即将到期', expired: '已过期', exhausted: '流量用完', disabled: '已停用' };
const STATUS_BADGE = { active: 'green', expiring: 'yellow', expired: 'red', exhausted: 'red', disabled: 'gray' };
const GB = 1024 * 1024 * 1024;

function safeParse(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

export default function Users({ toast }) {
  const { data: rows = [], loading, refresh } = useCachedResource('users', () => API.users());
  const { data: templates = [] } = useCachedResource('templates', () => API.templates());
  const { data: airports = [] } = useCachedResource('airports', () => API.airports());
  const { data: groups = [], refresh: refreshGroups } = useCachedResource('groups:user', () => API.groups('user'));
  const [editing, setEditing] = useState(null);
  const [subUser, setSubUser] = useState(null);
  const [previewUser, setPreviewUser] = useState(null);
  const [renewUser, setRenewUser] = useState(null);
  const [showGroups, setShowGroups] = useState(false);
  const [batchGroup, setBatchGroup] = useState('');
  const [airportFilter, setAirportFilter] = useState('');
  const [confirm, confirmNode] = useConfirm();

  const load = () => refresh();

  // airportId -> [{id,name}] of users that explicitly受下发 this airport.
  // Used both by the airport filter and by the "隐藏已下发机场" toggle.
  const assignedByAirport = useMemo(() => {
    const m = new Map();
    for (const u of rows) {
      const aps = safeParse(u.node_filter).airports;
      if (!Array.isArray(aps)) continue;
      for (const id of aps) {
        if (!m.has(id)) m.set(id, []);
        m.get(id).push({ id: u.id, name: u.name });
      }
    }
    return m;
  }, [rows]);

  // rows narrowed by the "按关联机场筛选" dropdown before search/sort.
  // A user with an empty airport list receives *all* airports, so they match any.
  const viewRows = useMemo(() => {
    if (!airportFilter) return rows;
    const id = Number(airportFilter);
    return rows.filter((u) => {
      const aps = safeParse(u.node_filter).airports;
      return !Array.isArray(aps) || aps.length === 0 || aps.includes(id);
    });
  }, [rows, airportFilter]);

  const t = useTable(viewRows, { searchKeys: ['name', 'group_name', 'remark'], initialSort: { key: 'id', dir: 'desc' } });

  const del = async (id) => { if (await confirm('删除该用户？其订阅将立即失效。')) { await API.deleteUser(id); load(); } };
  const reset = async (u) => {
    if (!(await confirm('重置订阅：旧链接立即失效，并触发机场自动重置。确认？'))) return;
    try { await API.resetUser(u.id, { triggerAutomation: true }); toast.success('已重置订阅'); load(); }
    catch (e) { toast.error(e.message); }
  };
  const batchDelete = async () => {
    if (!(await confirm(`删除选中的 ${t.selected.size} 个用户？`))) return;
    await API.batchDeleteUsers([...t.selected]); t.clearSelection(); load();
  };
  const batchToggle = async (enabled) => {
    await API.batchToggleUsers([...t.selected], enabled); t.clearSelection(); toast.success('已更新'); load();
  };
  const applyBatchGroup = () => {
    const v = batchGroup === '__none__' ? '' : batchGroup;
    API.batchGroupUsers([...t.selected], v || null).then(() => {
      t.clearSelection(); setBatchGroup(''); toast.success('已设置分组'); load();
    });
  };

  return (
    <>
      <div className="page-head">
        <h1>用户</h1>
        <div className="btn-row">
          <button className="btn" onClick={() => setShowGroups(true)}>分组管理</button>
          <button className="btn primary" onClick={() => setEditing({})}>+ 新增用户</button>
        </div>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="搜索用户名/备注" value={t.query} onChange={(e) => t.setQuery(e.target.value)} />
        <select style={{ width: 130 }} value={t.filters.status || ''} onChange={(e) => t.setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select style={{ width: 130 }} value={t.filters.group_name || ''} onChange={(e) => t.setFilters((f) => ({ ...f, group_name: e.target.value }))}>
          <option value="">全部分组</option>
          {groups.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
        </select>
        <select style={{ width: 160 }} value={airportFilter} onChange={(e) => setAirportFilter(e.target.value)} title="按关联机场筛选">
          <option value="">全部关联机场</option>
          {airports.map((a) => <option key={a.id} value={a.id}>{a.name}{a.account ? ` / ${a.account}` : ''}</option>)}
        </select>
        <div className="spacer" />
        {t.selected.size > 0 && (
          <>
            <select style={{ width: 120 }} value={batchGroup} onChange={(e) => setBatchGroup(e.target.value)}>
              <option value="">设为分组…</option>
              <option value="__none__">无分组</option>
              {groups.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
            </select>
            <button className="btn sm" disabled={!batchGroup} onClick={applyBatchGroup}>应用</button>
            <button className="btn sm" onClick={() => batchToggle(true)}>批量启用</button>
            <button className="btn sm" onClick={() => batchToggle(false)}>批量停用</button>
            <button className="btn sm danger" onClick={batchDelete}>批量删除</button>
          </>
        )}
      </div>

      {loading && rows.length === 0 ? <div className="empty"><span className="spin" /></div>
        : rows.length === 0 ? <div className="empty">还没有用户，点击右上角新增。</div>
        : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="nosort"><input type="checkbox" checked={t.allSelected} onChange={t.toggleSelectAll} /></th>
                  <SortTh label="用户名" k="name" table={t} />
                  <th className="nosort">状态</th>
                  <SortTh label="到期时间" k="expire_at" table={t} />
                  <th className="nosort">流量</th>
                  <SortTh label="最后订阅" k="last_sub_at" table={t} />
                  <SortTh label="分组" k="group_name" table={t} />
                  <th className="nosort">备注</th>
                  <th className="nosort">操作</th>
                </tr>
              </thead>
              <tbody>
                {t.filtered.map((u) => (
                  <tr key={u.id} className={`row-${u.status}`}>
                    <td><input type="checkbox" checked={t.selected.has(u.id)} onChange={() => t.toggleSelect(u.id)} /></td>
                    <td><strong>{u.name}</strong></td>
                    <td><span className={`badge ${STATUS_BADGE[u.status]}`}>{STATUS_LABEL[u.status]}</span></td>
                    <td>{expireCell(u.expire_at, u.status)}</td>
                    <td><TrafficCell used={u.traffic_used} limit={u.traffic_limit} /></td>
                    <td className="small muted">{u.last_sub_at ? fmtDateTime(u.last_sub_at) : '从未'}</td>
                    <td>{u.group_name || '-'}</td>
                    <td className="small muted">{u.remark || '-'}</td>
                    <td className="actions">
                      <ActionMenu items={[
                        { label: '订阅管理', onClick: () => setSubUser(u) },
                        { label: '续费', title: '延长到期 / 重置本期流量', onClick: () => setRenewUser(u) },
                        { label: '节点预览', title: '预览客户端可拉取的节点', onClick: () => setPreviewUser(u) },
                        { label: '编辑', onClick: () => setEditing(u) },
                        { label: '重置订阅', title: '旧链接失效并触发机场重置', onClick: () => reset(u) },
                        { label: '删除', danger: true, onClick: () => del(u.id) },
                      ]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <div className="mobile-cards">
        {t.filtered.map((u) => (
          <div className={`mcard row-${u.status}`} key={u.id}>
            <div className="mrow"><strong>{u.name}</strong><span className={`badge ${STATUS_BADGE[u.status]}`}>{STATUS_LABEL[u.status]}</span></div>
            <div className="mrow"><span className="k">到期</span>{expireCell(u.expire_at, u.status)}</div>
            <div className="mrow"><span className="k">流量</span><TrafficCell used={u.traffic_used} limit={u.traffic_limit} /></div>
            <div className="mrow"><span className="k">最后订阅</span><span className="small muted">{u.last_sub_at ? fmtDateTime(u.last_sub_at) : '从未'}</span></div>
            <div className="mrow"><span className="k">分组</span><span>{u.group_name || '-'}</span></div>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn sm primary" onClick={() => setSubUser(u)}>订阅</button>
              <button className="btn sm" onClick={() => setPreviewUser(u)}>节点预览</button>
              <button className="btn sm" onClick={() => setEditing(u)}>编辑</button>
              <button className="btn sm" onClick={() => reset(u)}>重置</button>
              <button className="btn sm danger" onClick={() => del(u.id)}>删</button>
            </div>
          </div>
        ))}
      </div>

      {editing && <UserModal user={editing} templates={templates} airports={airports} groups={groups} toast={toast}
        assignedByAirport={assignedByAirport}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); refreshGroups(); }} />}
      {subUser && <SubModal user={subUser} toast={toast} onClose={() => setSubUser(null)} />}
      {previewUser && <PreviewModal user={previewUser} toast={toast} onClose={() => setPreviewUser(null)} />}
      {renewUser && <RenewModal user={renewUser} toast={toast} onClose={() => setRenewUser(null)} onDone={() => { setRenewUser(null); load(); }} />}
      {showGroups && <GroupManagerModal kind="user" title="用户分组管理" toast={toast} onClose={() => setShowGroups(false)} onChanged={() => { refreshGroups(); load(); }} />}
      {confirmNode}
    </>
  );
}

function expireCell(ms, status) {
  if (!ms) return <span className="muted">永久</span>;
  const d = daysLeft(ms);
  return <span>{fmtDate(ms)} {status === 'expired' ? <span className="muted">已过期</span> : <span className="muted">({d}天)</span>}</span>;
}

function TrafficCell({ used, limit }) {
  const u = Number(used || 0);
  const lim = Number(limit || 0);
  if (!lim && !u) return <span className="muted">-</span>;
  const pct = lim > 0 ? Math.min(100, Math.round((u / lim) * 100)) : 0;
  const cls = pct >= 100 ? 'red' : pct >= 80 ? 'yellow' : 'green';
  return (
    <div className="usage-inline">
      {lim > 0 && <div className="usage-bar"><span className={`usage-fill ${cls}`} style={{ width: `${pct}%` }} /></div>}
      <div className="small muted" style={{ marginTop: lim > 0 ? 3 : 0 }}>{fmtBytes(u)} / {lim > 0 ? fmtBytes(lim) : '不限'}</div>
    </div>
  );
}

/* ---------------- User edit modal ---------------- */
function UserModal({ user, templates, airports, groups, toast, assignedByAirport, onClose, onSaved }) {
  const isNew = !user.id;
  const uf = safeParse(user.node_filter);
  const [f, setF] = useState({
    name: user.name || '', enabled: user.enabled === undefined ? true : !!user.enabled,
    expire_at: toDatetimeLocal(user.expire_at), template_id: user.template_id || '',
    group_name: user.group_name || '', remark: user.remark || '',
    traffic_limit_gb: user.traffic_limit ? (user.traffic_limit / GB) : '',
    price: user.price ?? '',
    airports: uf.airports || [], include: uf.include || '', exclude: uf.exclude || '', prefix: uf.prefix || '',
    protocols: uf.protocols || [], excludeProtocols: uf.excludeProtocols || [],
    maxLatency: uf.maxLatency ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [hideAssigned, setHideAssigned] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const toggleAirport = (id) => setF((s) => ({
    ...s, airports: s.airports.includes(id) ? s.airports.filter((x) => x !== id) : [...s.airports, id],
  }));

  const save = async () => {
    if (!f.name.trim()) return toast.error('用户名称必填');
    setSaving(true);
    const node_filter = JSON.stringify({
      airports: f.airports,
      include: f.include || undefined, exclude: f.exclude || undefined, prefix: f.prefix || undefined,
      protocols: f.protocols.length ? f.protocols : undefined,
      excludeProtocols: f.excludeProtocols.length ? f.excludeProtocols : undefined,
      maxLatency: f.maxLatency === '' ? undefined : Number(f.maxLatency),
    });
    const body = {
      name: f.name, enabled: f.enabled, expire_at: fromDatetimeLocal(f.expire_at),
      template_id: f.template_id || null, group_name: f.group_name, remark: f.remark, node_filter,
      traffic_limit: f.traffic_limit_gb ? Math.round(Number(f.traffic_limit_gb) * GB) : null,
      price: f.price === '' ? null : Number(f.price),
    };
    try {
      if (isNew) await API.createUser(body); else await API.updateUser(user.id, body);
      toast.success('已保存'); invalidate('users'); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  // "隐藏已下发机场" hides airports that have already been下发给过*任一其他用户*
  // (so the same机场账户 isn't double-dispatched) — NOT the airports this user
  // currently has selected. The current user's own picks stay visible & checked.
  const assignedToOthers = (airportId) =>
    (assignedByAirport?.get(airportId) || []).some((u) => u.id !== user.id);
  const visibleAirports = hideAssigned ? airports.filter((a) => !assignedToOthers(a.id)) : airports;

  return (
    <Modal wide title={isNew ? '新增用户' : `编辑用户 · ${user.name}`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? <span className="spin" /> : '保存'}</button>
      </>}>
      <div className="field-row">
        <div className="field"><label>用户名称 *</label><input value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="field"><label>到期时间（留空=永久）</label><input type="datetime-local" value={f.expire_at} onChange={(e) => set('expire_at', e.target.value)} /></div>
      </div>
      <div className="field-row">
        <div className="field"><label>订阅模板</label>
          <select value={f.template_id} onChange={(e) => set('template_id', e.target.value)}>
            <option value="">默认（按客户端自动）</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="field"><label>分组</label><GroupSelect value={f.group_name} groups={groups} onChange={(v) => set('group_name', v)} /></div>
      </div>
      <div className="field-row">
        <div className="field"><label>流量上限 (GB，留空=不限)</label>
          <input type="number" min="0" step="0.1" value={f.traffic_limit_gb} onChange={(e) => set('traffic_limit_gb', e.target.value)} placeholder="如 100" />
        </div>
        <div className="field"><label>收费 (用于收益记账)</label>
          <input type="number" min="0" step="0.01" value={f.price} onChange={(e) => set('price', e.target.value)} placeholder="如 15" />
        </div>
        <div className="field checkbox-inline" style={{ alignSelf: 'end', marginBottom: 14 }}>
          <input type="checkbox" id="enabled" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          <label htmlFor="enabled" style={{ margin: 0 }}>启用该用户</label>
        </div>
      </div>

      <div className="field">
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>下发机场（不选=全部；同机场不同账户视为不同项）</span>
          <button type="button" className="btn sm" onClick={() => setHideAssigned((v) => !v)} title="隐藏此前已下发给其他任一用户的机场">
            {hideAssigned ? '显示全部' : '隐藏已下发机场'}
          </button>
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {visibleAirports.map((a) => {
            const others = (assignedByAirport?.get(a.id) || []).filter((u) => u.id !== user.id);
            return (
              <label key={a.id} className="chip-check" title={others.length ? `已下发给：${others.map((u) => u.name).join('、')}` : ''}>
                <input type="checkbox" checked={f.airports.includes(a.id)} onChange={() => toggleAirport(a.id)} />
                {a.name}{a.account ? <span className="muted"> / {a.account}</span> : ''}
                {others.length > 0 && <span className="badge gray" style={{ marginLeft: 4 }}>已下发{others.length}</span>}
              </label>
            );
          })}
          {visibleAirports.length === 0 && <span className="muted small">{hideAssigned ? '所有机场都已下发给其他用户' : '暂无机场'}</span>}
        </div>
      </div>

      <div className="field-row">
        <div className="field"><label>包含节点（名称正则）</label><input value={f.include} onChange={(e) => set('include', e.target.value)} placeholder="香港|日本" /></div>
        <div className="field"><label>排除节点（名称正则）</label><input value={f.exclude} onChange={(e) => set('exclude', e.target.value)} placeholder="过期|官网" /></div>
      </div>
      <div className="field"><label>包含节点（按协议，不勾=全部）</label><ProtocolPicker value={f.protocols} onChange={(v) => set('protocols', v)} /></div>
      <div className="field"><label>排除节点（按协议）</label><ProtocolPicker value={f.excludeProtocols} onChange={(v) => set('excludeProtocols', v)} /></div>
      <div className="field">
        <label>延迟上限 (ms，留空=不限；填 0=仅排除超时节点)</label>
        <input type="number" min="0" step="1" value={f.maxLatency} onChange={(e) => set('maxLatency', e.target.value)} placeholder="如 200" />
        <div className="muted small" style={{ marginTop: 4 }}>
          超过上限或已超时的节点将被排除（依据「节点管理」中检测到的真实延迟；未检测的节点保留）。
        </div>
      </div>
      <div className="field"><label>节点名前缀</label><input value={f.prefix} onChange={(e) => set('prefix', e.target.value)} /></div>

      <RulePreview
        airports={f.airports}
        filter={{
          include: f.include, exclude: f.exclude,
          protocols: f.protocols, excludeProtocols: f.excludeProtocols,
          maxLatency: f.maxLatency,
        }}
      />

      <div className="field"><label>备注</label><input value={f.remark} onChange={(e) => set('remark', e.target.value)} /></div>
    </Modal>
  );
}

/* ---------------- Node preview modal ---------------- */
function PreviewModal({ user, toast, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    API.userPreview(user.id).then(setData).catch((e) => { setErr(e); toast.error(e.message); });
  }, [user.id, toast]);

  const latCell = (ms) => {
    if (ms == null) return <span className="muted">未测</span>;
    if (ms < 0) return <span className="badge red">超时</span>;
    const cls = ms < 200 ? 'green' : ms < 500 ? 'yellow' : 'red';
    return <span className={`badge ${cls}`}>{ms} ms</span>;
  };

  return (
    <Modal wide title={`节点预览 · ${user.name}`} onClose={onClose}
      footer={<button className="btn" onClick={onClose}>关闭</button>}>
      {err ? <div className="empty">加载失败：{err.message}</div>
        : !data ? <div className="empty"><span className="spin" /></div>
        : (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>
              以下为该用户客户端实际能拉取到的节点（已应用协议/名称/延迟等所有筛选）。
              {data.notice ? <> 当前状态：<strong>{data.notice}</strong>，客户端只会收到一条提示节点。</>
                : <> 共 <strong>{data.count}</strong> 个节点。</>}
            </p>
            {data.notice ? <div className="empty">{data.notice}</div> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>#</th><th>名称</th><th>协议</th><th>服务器</th><th>延迟</th></tr></thead>
                  <tbody>
                    {data.nodes.map((n, i) => (
                      <tr key={i}>
                        <td className="muted small">{i + 1}</td>
                        <td>{n.name}</td>
                        <td><span className="badge blue">{n.type}</span></td>
                        <td className="muted small">{n.server}:{n.port}</td>
                        <td>{latCell(n.latency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
    </Modal>
  );
}

/* ---------------- Subscription modal ---------------- */
const CLIENTS = [
  { k: 'auto', l: '自动' }, { k: 'base64', l: '通用(Base64)' }, { k: 'clash', l: 'Clash.Meta' },
  { k: 'singbox', l: 'sing-box' }, { k: 'surge', l: 'Surge' }, { k: 'quantumultx', l: 'QuantumultX' }, { k: 'loon', l: 'Loon' },
];

function SubModal({ user, toast, onClose }) {
  const [data, setData] = useState(null);
  const [client, setClient] = useState('auto');
  const [qr, setQr] = useState('');
  const [logs, setLogs] = useState(null);

  useEffect(() => { API.userSub(user.id).then(setData).catch((e) => toast.error(e.message)); }, [user.id, toast]);
  useEffect(() => { API.userSubLogs(user.id).then(setLogs).catch(() => setLogs([])); }, [user.id]);

  const currentUrl = data?.links?.[client]?.url || '';
  const portalUrl = (data?.links?.auto?.url || '').replace('/sub/', '/portal/').split('#')[0];
  useEffect(() => {
    if (!currentUrl) return setQr('');
    QRCode.toDataURL(currentUrl, { width: 220, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [currentUrl]);

  return (
    <Modal wide title={`订阅管理 · ${user.name}`} onClose={onClose}
      footer={<button className="btn" onClick={onClose}>关闭</button>}>
      {!data ? <div className="empty"><span className="spin" /></div> : (
        <div className="sub-modal-grid">
          <div>
            <div className="sub-links">
              {CLIENTS.filter((c) => c.k !== 'auto').map((c) => (
                <div className="sub-link-row" key={c.k}>
                  <span className="name">{c.l}</span>
                  <input readOnly value={data.links[c.k]?.url || ''} onClick={(e) => { e.target.select(); copyText(data.links[c.k]?.url, toast); }} />
                  <button className="btn sm" onClick={() => copyText(data.links[c.k]?.url, toast)}>复制</button>
                </div>
              ))}
              <div className="sub-link-row">
                <span className="name">自动(按客户端)</span>
                <input readOnly value={data.links.auto?.url || ''} onClick={(e) => e.target.select()} />
                <button className="btn sm" onClick={() => copyText(data.links.auto?.url, toast)}>复制</button>
              </div>
              <div className="sub-link-row">
                <span className="name">👤 用户自助页</span>
                <input readOnly value={portalUrl} onClick={(e) => e.target.select()} />
                <button className="btn sm" onClick={() => copyText(portalUrl, toast)}>复制</button>
              </div>
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>把「用户自助页」发给用户，他可免登录查看到期/流量/订阅二维码。</div>
          </div>
          <div className="qr-box">
            <div className="tabs" style={{ justifyContent: 'center' }}>
              {CLIENTS.map((c) => (
                <span key={c.k} className={`tab ${client === c.k ? 'active' : ''}`} onClick={() => setClient(c.k)}>{c.l}</span>
              ))}
            </div>
            {qr ? <img src={qr} alt="qr" width={220} height={220} /> : <div className="empty"><span className="spin" /></div>}
            <div className="muted small" style={{ marginTop: 8 }}>订阅名：{data.name}</div>
            <div className="muted small">扫码导入 · {CLIENTS.find((c) => c.k === client)?.l}</div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>拉取记录（最近 100 条）</h3>
        {logs === null ? <div className="muted small"><span className="spin" /></div>
          : logs.length === 0 ? <div className="muted small">暂无拉取记录</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>时间</th><th>客户端IP</th><th>客户端</th><th>设备 / UA</th></tr></thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="small muted">{fmtDateTime(l.created_at)}</td>
                      <td className="small mono">{l.ip || '-'}</td>
                      <td className="small">{clientLabel(l.target)}</td>
                      <td className="small muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.user_agent}>{l.user_agent || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </Modal>
  );
}

const CLIENT_LABELS = { clash: 'Clash', singbox: 'sing-box', surge: 'Surge', quantumultx: 'QuantumultX', loon: 'Loon', base64: '通用/Base64', v2rayn: 'v2rayN' };
function clientLabel(target) { return CLIENT_LABELS[target] || target || '自动'; }

function RenewModal({ user, toast, onClose, onDone }) {
  const [plans, setPlans] = useState([]);
  const [renewals, setRenewals] = useState([]);
  const [mode, setMode] = useState('plan'); // plan | custom
  const [planId, setPlanId] = useState('');
  const [custom, setCustom] = useState({ days: 30, trafficGb: '', price: '' });
  const [resetTraffic, setResetTraffic] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    API.plans().then((p) => { setPlans(p); if (p[0]) setPlanId(String(p[0].id)); }).catch(() => {});
    API.userRenewals(user.id).then(setRenewals).catch(() => {});
  }, [user.id]);

  const apply = async () => {
    const body = mode === 'plan'
      ? { planId: Number(planId), resetTraffic }
      : { days: Number(custom.days) || 0, trafficGb: custom.trafficGb === '' ? undefined : Number(custom.trafficGb), price: custom.price === '' ? undefined : Number(custom.price), resetTraffic };
    if (mode === 'plan' && !planId) return toast.error('请选择套餐');
    setSaving(true);
    try {
      const u = await API.renewUser(user.id, body);
      toast.success(`续费成功，新到期 ${fmtDate(u.expire_at)}`);
      onDone();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal title={`续费 · ${user.name}`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={apply} disabled={saving}>{saving ? <span className="spin" /> : '确认续费'}</button>
      </>}>
      <div className="muted small" style={{ marginBottom: 8 }}>当前到期：{user.expire_at ? fmtDate(user.expire_at) : '永久'}（未过期则在此基础上叠加）</div>
      <div className="tabs">
        <span className={`tab ${mode === 'plan' ? 'active' : ''}`} onClick={() => setMode('plan')}>套餐</span>
        <span className={`tab ${mode === 'custom' ? 'active' : ''}`} onClick={() => setMode('custom')}>自定义</span>
      </div>
      {mode === 'plan' ? (
        plans.length === 0 ? <div className="muted small">还没有套餐，去「设置 · 套餐管理」添加。</div> : (
          <div className="field"><label>选择套餐</label>
            <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}（{p.days || 0}天 · {p.traffic_gb ? `${p.traffic_gb}GB` : '不限'}{p.price != null ? ` · ¥${p.price}` : ''}）</option>)}
            </select>
          </div>
        )
      ) : (
        <div className="field-row">
          <div className="field"><label>时长(天)</label><input type="number" value={custom.days} onChange={(e) => setCustom((c) => ({ ...c, days: e.target.value }))} /></div>
          <div className="field"><label>流量(GB,空=不改)</label><input type="number" value={custom.trafficGb} onChange={(e) => setCustom((c) => ({ ...c, trafficGb: e.target.value }))} /></div>
          <div className="field"><label>价格(空=不改)</label><input type="number" value={custom.price} onChange={(e) => setCustom((c) => ({ ...c, price: e.target.value }))} /></div>
        </div>
      )}
      <label className="checkbox-inline" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={resetTraffic} onChange={(e) => setResetTraffic(e.target.checked)} />
        <span>重置本期流量（B−A 重新从 0 计）</span>
      </label>
      {renewals.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="small"><strong>续费记录</strong></div>
          <div className="table-wrap"><table>
            <thead><tr><th>时间</th><th>套餐</th><th>时长</th><th>价格</th><th>到期变更</th></tr></thead>
            <tbody>{renewals.map((r) => (
              <tr key={r.id}><td className="small muted">{fmtDateTime(r.created_at)}</td><td className="small">{r.plan_name}</td>
                <td className="small">{r.days ? `${r.days}天` : '-'}</td><td className="small">{r.price ?? '-'}</td>
                <td className="small muted">{r.before_expire ? fmtDate(r.before_expire) : '-'} → {fmtDate(r.after_expire)}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </Modal>
  );
}
