import { useState, useMemo } from 'react';
import { API } from '../api.js';
import { Modal, useConfirm } from '../ui.jsx';
import { useCachedResource, invalidate } from '../store.js';
import { parseClashRules, spliceClashRules, partsToFields, fieldsToParts, extractPolicies } from '../clashRules.js';

const RULE_TYPES = [
  'DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'GEOIP', 'IP-CIDR', 'IP-CIDR6',
  'RULE-SET', 'PROCESS-NAME', 'DST-PORT', 'SRC-IP-CIDR', 'MATCH',
];

const CLIENT_TYPES = [
  { v: 'clash', l: 'Clash.Meta' }, { v: 'singbox', l: 'sing-box' }, { v: 'base64', l: '通用 Base64' },
  { v: 'surge', l: 'Surge' }, { v: 'quantumultx', l: 'QuantumultX' }, { v: 'loon', l: 'Loon' },
];

export default function Templates({ toast }) {
  const { data: rows = [], loading, refresh } = useCachedResource('templates', () => API.templates());
  const [editing, setEditing] = useState(null);
  const [confirm, confirmNode] = useConfirm();

  const load = () => { invalidate('templates'); refresh(); };

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

      {loading && rows.length === 0 ? <div className="empty"><span className="spin" /></div>
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
  const [mode, setMode] = useState('raw'); // 'raw' | 'rules' (rules only for clash)
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
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>模板内容</span>
          {f.client_type === 'clash' && (
            <span className="tabs" style={{ display: 'flex', gap: 6 }}>
              <button type="button" className={`rp-tab ${mode === 'raw' ? 'active' : ''}`} onClick={() => setMode('raw')}>原始文本</button>
              <button type="button" className={`rp-tab ${mode === 'rules' ? 'active' : ''}`} onClick={() => setMode('rules')}>可视化规则</button>
            </span>
          )}
        </label>
        {f.client_type === 'clash' && mode === 'rules'
          ? <ClashRulesEditor content={f.content} onChange={(v) => set('content', v)} />
          : <textarea style={{ minHeight: 320 }} value={f.content} onChange={(e) => set('content', e.target.value)}
              placeholder="Clash / sing-box 配置，节点插入位置用 <PROXIES> 占位" />}
      </div>
    </Modal>
  );
}

/* ---------------- Clash 路由规则可视化编辑器 ----------------
   Edits only the top-level `rules:` list; everything else in the YAML
   (proxy-groups / rule-providers / 注释) is spliced back untouched. Content stays
   the single source of truth — each change re-splices and calls onChange. */
function ClashRulesEditor({ content, onChange }) {
  const parsed = useMemo(() => parseClashRules(content), [content]);
  const policies = useMemo(() => extractPolicies(content), [content]);

  if (!parsed.found) {
    return (
      <div className="clash-rules empty-block">
        <div className="muted small">
          未找到 <code className="mono">rules:</code> 段——该模板可能不是标准 Clash 配置。可切回「原始文本」编辑，或
          <button type="button" className="btn sm" style={{ marginLeft: 6 }}
            onClick={() => onChange(spliceClashRules(content, [{ parts: ['MATCH', 'DIRECT'] }]))}>
            新建 rules 段
          </button>
        </div>
      </div>
    );
  }

  const rules = parsed.rules;
  const commit = (next) => onChange(spliceClashRules(content, next));
  const setField = (i, key, val) => {
    const flds = partsToFields(rules[i].parts); flds[key] = val;
    commit(rules.map((r, idx) => (idx === i ? { parts: fieldsToParts(flds) } : r)));
  };
  const move = (i, dir) => {
    const j = i + dir; if (j < 0 || j >= rules.length) return;
    const next = [...rules]; [next[i], next[j]] = [next[j], next[i]]; commit(next);
  };
  const del = (i) => commit(rules.filter((_, idx) => idx !== i));
  const add = () => commit([...rules, { parts: ['DOMAIN-SUFFIX', '', policies[0] || 'DIRECT'] }]);

  return (
    <div className="clash-rules">
      <datalist id="clash-rule-types">{RULE_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="clash-policies">{policies.map((p) => <option key={p} value={p} />)}</datalist>
      <div className="muted small" style={{ marginBottom: 8 }}>
        共 {rules.length} 条规则。顺序即匹配优先级（从上到下），<code className="mono">MATCH</code> 兜底应放最后。仅编辑 rules 段，其余配置原样保留。
      </div>
      <div className="cr-list">
        {rules.map((r, i) => {
          const flds = partsToFields(r.parts);
          const noValue = flds.type === 'MATCH' || flds.type === 'FINAL';
          return (
            <div className="cr-row" key={i}>
              <div className="cr-move">
                <button type="button" className="btn xs" disabled={i === 0} onClick={() => move(i, -1)} title="上移">↑</button>
                <button type="button" className="btn xs" disabled={i === rules.length - 1} onClick={() => move(i, 1)} title="下移">↓</button>
              </div>
              <input className="cr-type" list="clash-rule-types" value={flds.type} placeholder="类型"
                onChange={(e) => setField(i, 'type', e.target.value)} />
              <input className="cr-value" value={flds.value} placeholder={noValue ? '（无需匹配值）' : '匹配值 (域名/CIDR/规则集名)'}
                disabled={noValue} onChange={(e) => setField(i, 'value', e.target.value)} />
              <input className="cr-policy" list="clash-policies" value={flds.policy} placeholder="策略"
                onChange={(e) => setField(i, 'policy', e.target.value)} />
              <input className="cr-opts" value={flds.options} placeholder="选项 (如 no-resolve)"
                onChange={(e) => setField(i, 'options', e.target.value)} />
              <button type="button" className="btn xs danger" onClick={() => del(i)} title="删除">×</button>
            </div>
          );
        })}
      </div>
      <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={add}>＋ 添加规则</button>
    </div>
  );
}
