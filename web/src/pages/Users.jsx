import { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { API } from '../api.js';
import { Modal, useConfirm, copyText, fmtDate, daysLeft, toDatetimeLocal, fromDatetimeLocal } from '../ui.jsx';
import { useTable, SortTh } from '../hooks/useTable.jsx';

const STATUS_LABEL = { active: '正常', expiring: '即将到期', expired: '已过期', disabled: '已停用' };
const STATUS_BADGE = { active: 'green', expiring: 'yellow', expired: 'red', disabled: 'gray' };

export default function Users({ toast }) {
  const [rows, setRows] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [airports, setAirports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [subUser, setSubUser] = useState(null);
  const [confirm, confirmNode] = useConfirm();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([API.users(), API.templates(), API.airports()])
      .then(([u, t, a]) => { setRows(u); setTemplates(t); setAirports(a); })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [toast]);
  useEffect(load, [load]);

  const t = useTable(rows, { searchKeys: ['name', 'group_name', 'remark'], initialSort: { key: 'id', dir: 'desc' } });

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

  const groups = [...new Set(rows.map((r) => r.group_name).filter(Boolean))];

  return (
    <>
      <div className="page-head">
        <h1>用户</h1>
        <button className="btn primary" onClick={() => setEditing({})}>+ 新增用户</button>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="搜索用户名/备注" value={t.query} onChange={(e) => t.setQuery(e.target.value)} />
        <select style={{ width: 130 }} value={t.filters.status || ''} onChange={(e) => t.setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select style={{ width: 130 }} value={t.filters.group_name || ''} onChange={(e) => t.setFilters((f) => ({ ...f, group_name: e.target.value }))}>
          <option value="">全部分组</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <div className="spacer" />
        {t.selected.size > 0 && (
          <>
            <button className="btn sm" onClick={() => batchToggle(true)}>批量启用</button>
            <button className="btn sm" onClick={() => batchToggle(false)}>批量停用</button>
            <button className="btn sm danger" onClick={batchDelete}>批量删除</button>
          </>
        )}
      </div>

      {loading ? <div className="empty"><span className="spin" /></div>
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
                    <td>{u.group_name || '-'}</td>
                    <td className="small muted">{u.remark || '-'}</td>
                    <td className="actions">
                      <button className="btn sm primary" onClick={() => setSubUser(u)}>订阅</button>
                      <button className="btn sm" onClick={() => setEditing(u)}>编辑</button>
                      <button className="btn sm" onClick={() => reset(u)} title="重置订阅">重置</button>
                      <button className="btn sm danger" onClick={() => del(u.id)}>删</button>
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
            <div className="mrow"><span className="k">分组</span><span>{u.group_name || '-'}</span></div>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn sm primary" onClick={() => setSubUser(u)}>订阅</button>
              <button className="btn sm" onClick={() => setEditing(u)}>编辑</button>
              <button className="btn sm" onClick={() => reset(u)}>重置</button>
              <button className="btn sm danger" onClick={() => del(u.id)}>删</button>
            </div>
          </div>
        ))}
      </div>

      {editing && <UserModal user={editing} templates={templates} airports={airports} toast={toast}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {subUser && <SubModal user={subUser} toast={toast} onClose={() => setSubUser(null)} />}
      {confirmNode}
    </>
  );
}

function expireCell(ms, status) {
  if (!ms) return <span className="muted">永久</span>;
  const d = daysLeft(ms);
  return <span>{fmtDate(ms)} {status === 'expired' ? <span className="muted">已过期</span> : <span className="muted">({d}天)</span>}</span>;
}

/* ---------------- User edit modal ---------------- */
function UserModal({ user, templates, airports, toast, onClose, onSaved }) {
  const isNew = !user.id;
  let uf = {}; try { uf = JSON.parse(user.node_filter || '{}'); } catch { /* noop */ }
  const [f, setF] = useState({
    name: user.name || '', enabled: user.enabled === undefined ? true : !!user.enabled,
    expire_at: toDatetimeLocal(user.expire_at), template_id: user.template_id || '',
    group_name: user.group_name || '', remark: user.remark || '',
    airports: uf.airports || [], include: uf.include || '', exclude: uf.exclude || '', prefix: uf.prefix || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const toggleAirport = (id) => setF((s) => ({
    ...s, airports: s.airports.includes(id) ? s.airports.filter((x) => x !== id) : [...s.airports, id],
  }));

  const save = async () => {
    if (!f.name.trim()) return toast.error('用户名称必填');
    setSaving(true);
    const node_filter = JSON.stringify({
      airports: f.airports, include: f.include || undefined, exclude: f.exclude || undefined, prefix: f.prefix || undefined,
    });
    const body = {
      name: f.name, enabled: f.enabled, expire_at: fromDatetimeLocal(f.expire_at),
      template_id: f.template_id || null, group_name: f.group_name, remark: f.remark, node_filter,
    };
    try {
      if (isNew) await API.createUser(body); else await API.updateUser(user.id, body);
      toast.success('已保存'); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal title={isNew ? '新增用户' : `编辑用户 · ${user.name}`} onClose={onClose}
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
        <div className="field"><label>分组</label><input value={f.group_name} onChange={(e) => set('group_name', e.target.value)} /></div>
      </div>
      <div className="field checkbox-inline">
        <input type="checkbox" id="enabled" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        <label htmlFor="enabled" style={{ margin: 0 }}>启用该用户</label>
      </div>
      <div className="field">
        <label>下发机场（不选=全部）</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {airports.map((a) => (
            <label key={a.id} className="checkbox-inline" style={{ margin: 0 }}>
              <input type="checkbox" checked={f.airports.includes(a.id)} onChange={() => toggleAirport(a.id)} /> {a.name}
            </label>
          ))}
          {airports.length === 0 && <span className="muted small">暂无机场</span>}
        </div>
      </div>
      <div className="field-row">
        <div className="field"><label>包含节点（正则）</label><input value={f.include} onChange={(e) => set('include', e.target.value)} placeholder="香港|日本" /></div>
        <div className="field"><label>排除节点（正则）</label><input value={f.exclude} onChange={(e) => set('exclude', e.target.value)} placeholder="过期|官网" /></div>
      </div>
      <div className="field"><label>节点名前缀</label><input value={f.prefix} onChange={(e) => set('prefix', e.target.value)} /></div>
      <div className="field"><label>备注</label><input value={f.remark} onChange={(e) => set('remark', e.target.value)} /></div>
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
  const [client, setClient] = useState('clash');
  const [qr, setQr] = useState('');

  useEffect(() => { API.userSub(user.id).then(setData).catch((e) => toast.error(e.message)); }, [user.id, toast]);

  const currentUrl = data?.links?.[client]?.url || '';
  useEffect(() => {
    if (!currentUrl) return setQr('');
    QRCode.toDataURL(currentUrl, { width: 220, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [currentUrl]);

  return (
    <Modal wide title={`订阅管理 · ${user.name}`} onClose={onClose}
      footer={<button className="btn" onClick={onClose}>关闭</button>}>
      {!data ? <div className="empty"><span className="spin" /></div> : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 20 }}>
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
            </div>
          </div>
          <div className="qr-box">
            <div className="tabs" style={{ justifyContent: 'center' }}>
              {CLIENTS.map((c) => (
                <span key={c.k} className={`tab ${client === c.k ? 'active' : ''}`} onClick={() => setClient(c.k)}>{c.l}</span>
              ))}
            </div>
            {qr ? <img src={qr} alt="qr" width={220} height={220} /> : <div className="empty"><span className="spin" /></div>}
            <div className="muted small" style={{ marginTop: 8 }}>{data.name}</div>
            <div className="muted small">扫码导入 · {CLIENTS.find((c) => c.k === client)?.l}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
