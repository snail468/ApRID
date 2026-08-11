import { useState, useEffect, useCallback } from 'react';
import { API } from '../api.js';
import { Modal, useConfirm } from '../ui.jsx';

const CLIENT_TYPES = [
  { v: 'clash', l: 'Clash.Meta' }, { v: 'singbox', l: 'sing-box' }, { v: 'base64', l: '通用 Base64' },
  { v: 'surge', l: 'Surge' }, { v: 'quantumultx', l: 'QuantumultX' }, { v: 'loon', l: 'Loon' },
];

export default function Templates({ toast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [confirm, confirmNode] = useConfirm();

  const load = useCallback(() => {
    setLoading(true);
    API.templates().then(setRows).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [toast]);
  useEffect(load, [load]);

  const del = async (id) => { if (await confirm('删除该模板？')) { await API.deleteTemplate(id); load(); } };

  return (
    <>
      <div className="page-head">
        <h1>订阅模板</h1>
        <button className="btn primary" onClick={() => setEditing({})}>+ 新增模板</button>
      </div>
      <p className="muted small" style={{ marginTop: -8 }}>
        用户按客户端类型拉取订阅时套用对应模板。模板中用 <code className="mono">&lt;PROXIES&gt;</code> 占位符标记节点插入位置（Clash/sing-box 也可自动注入 proxies）。
      </p>

      {loading ? <div className="empty"><span className="spin" /></div>
        : rows.length === 0 ? <div className="empty">暂无模板。</div>
        : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>名称</th><th>客户端类型</th><th>默认</th><th>内容长度</th><th>操作</th></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td><strong>{t.name}</strong></td>
                    <td><span className="badge blue">{clientLabel(t.client_type)}</span></td>
                    <td>{t.is_default ? <span className="badge green">默认</span> : <span className="muted">-</span>}</td>
                    <td className="muted small">{(t.content || '').length} 字符</td>
                    <td className="actions">
                      <button className="btn sm" onClick={() => setEditing(t)}>编辑</button>
                      <button className="btn sm danger" onClick={() => del(t.id)}>删</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {editing && <TemplateModal tpl={editing} toast={toast} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {confirmNode}
    </>
  );
}

function clientLabel(v) { return CLIENT_TYPES.find((c) => c.v === v)?.l || v || '通用'; }

function TemplateModal({ tpl, toast, onClose, onSaved }) {
  const isNew = !tpl.id;
  const [f, setF] = useState({
    name: tpl.name || '', client_type: tpl.client_type || 'clash',
    content: tpl.content || '', is_default: !!tpl.is_default,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) return toast.error('模板名称必填');
    setSaving(true);
    try {
      if (isNew) await API.createTemplate(f); else await API.updateTemplate(tpl.id, f);
      toast.success('已保存'); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal wide title={isNew ? '新增模板' : `编辑模板 · ${tpl.name}`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? <span className="spin" /> : '保存'}</button>
      </>}>
      <div className="field-row">
        <div className="field"><label>模板名称 *</label><input value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="field"><label>客户端类型</label>
          <select value={f.client_type} onChange={(e) => set('client_type', e.target.value)}>
            {CLIENT_TYPES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>
        </div>
      </div>
      <div className="field checkbox-inline">
        <input type="checkbox" id="isdef" checked={f.is_default} onChange={(e) => set('is_default', e.target.checked)} />
        <label htmlFor="isdef" style={{ margin: 0 }}>设为该客户端类型的默认模板</label>
      </div>
      <div className="field">
        <label>模板内容</label>
        <textarea style={{ minHeight: 320 }} value={f.content} onChange={(e) => set('content', e.target.value)}
          placeholder="Clash / sing-box 配置，节点插入位置用 <PROXIES> 占位" />
      </div>
    </Modal>
  );
}
