import { useState, useEffect, useCallback } from 'react';
import { API } from './api.js';
import { Modal, useConfirm } from './ui.jsx';

export const PROTOCOLS = ['vmess', 'vless', 'trojan', 'ss', 'hysteria2', 'tuic', 'anytls'];

export const UA_PRESETS = [
  { l: 'Clash.Meta（推荐）', v: 'ClashMetaForAndroid/2.10.1.Meta' },
  { l: 'Clash Verge', v: 'clash-verge/v1.6.0' },
  { l: 'sing-box', v: 'sing-box/1.8.0' },
  { l: 'v2rayN', v: 'v2rayN/6.42' },
  { l: 'Shadowrocket', v: 'Shadowrocket/1993 CFNetwork' },
  { l: 'Quantumult X', v: 'Quantumult%20X/1.0.30' },
  { l: '浏览器 Chrome', v: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
];

/* -------- dropdown that also lets you type a brand-new group -------- */
export function GroupSelect({ value, groups, onChange }) {
  const names = groups.map((g) => (typeof g === 'string' ? g : g.name));
  const [creating, setCreating] = useState(false);
  if (creating) {
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <input autoFocus value={value} placeholder="输入新分组名" onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn sm" onClick={() => { setCreating(false); onChange(''); }}>选已有</button>
      </div>
    );
  }
  return (
    <select value={names.includes(value) ? value : ''} onChange={(e) => {
      if (e.target.value === '__new__') { setCreating(true); onChange(''); } else onChange(e.target.value);
    }}>
      <option value="">无分组</option>
      {names.map((n) => <option key={n} value={n}>{n}</option>)}
      <option value="__new__">＋ 新建分组…</option>
    </select>
  );
}

/* -------- protocol multi-select as checkboxes -------- */
export function ProtocolPicker({ value = [], onChange }) {
  const toggle = (p) => onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {PROTOCOLS.map((p) => (
        <label key={p} className="chip-check">
          <input type="checkbox" checked={value.includes(p)} onChange={() => toggle(p)} /> {p}
        </label>
      ))}
    </div>
  );
}

/* -------- User-Agent: preset dropdown + custom -------- */
export function UAField({ value, onChange }) {
  const isPreset = UA_PRESETS.some((p) => p.v === value);
  const custom = value && !isPreset;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select value={custom ? '__custom__' : (value || '')} onChange={(e) => {
        if (e.target.value === '__custom__') onChange(value || ' ');
        else onChange(e.target.value);
      }}>
        <option value="">默认（Clash.Meta）</option>
        {UA_PRESETS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
        <option value="__custom__">自定义…</option>
      </select>
      {custom && <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="自定义 User-Agent" />}
    </div>
  );
}

/* -------- request headers as key/value rows -------- */
const HEADER_PRESETS = {
  'Accept 通用': { Accept: '*/*' },
  '浏览器常用': { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' },
};
export function HeadersEditor({ value = {}, onChange }) {
  const entries = Object.entries(value);
  const setEntry = (i, k, v) => {
    const next = entries.map((e, idx) => (idx === i ? [k, v] : e));
    onChange(Object.fromEntries(next.filter(([kk]) => kk !== '')));
  };
  const add = () => onChange({ ...value, '': '' });
  const remove = (i) => onChange(Object.fromEntries(entries.filter((_, idx) => idx !== i)));
  return (
    <div>
      {entries.length === 0 && <div className="muted small" style={{ marginBottom: 6 }}>无自定义请求头</div>}
      {entries.map(([k, v], i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input style={{ flex: '0 0 40%' }} placeholder="Header 名" value={k} onChange={(e) => setEntry(i, e.target.value, v)} />
          <input placeholder="值" value={v} onChange={(e) => setEntry(i, k, e.target.value)} />
          <button type="button" className="btn sm danger" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <div className="btn-row">
        <button type="button" className="btn sm" onClick={add}>＋ 添加请求头</button>
        {Object.entries(HEADER_PRESETS).map(([label, obj]) => (
          <button key={label} type="button" className="btn sm" onClick={() => onChange({ ...value, ...obj })}>{label}</button>
        ))}
      </div>
    </div>
  );
}

/* -------- proxy builder (no raw socks5:// typing) -------- */
function parseProxy(url) {
  if (!url) return { scheme: '', host: '', port: '', user: '', pass: '' };
  try {
    const u = new URL(url);
    return {
      scheme: u.protocol.replace(':', ''), host: u.hostname, port: u.port,
      user: decodeURIComponent(u.username || ''), pass: decodeURIComponent(u.password || ''),
    };
  } catch { return { scheme: '', host: '', port: '', user: '', pass: '' }; }
}
function buildProxy({ scheme, host, port, user, pass }) {
  if (!scheme || !host || !port) return '';
  const auth = user ? `${encodeURIComponent(user)}${pass ? ':' + encodeURIComponent(pass) : ''}@` : '';
  return `${scheme}://${auth}${host}:${port}`;
}
export function ProxyBuilder({ value, onChange }) {
  // Hold the proxy parts in local state. buildProxy() returns '' until host+port
  // are both present, so we cannot derive the parts back from `value` on each
  // render (that made picking a scheme immediately vanish). Keep local state and
  // only re-sync when `value` changes to something we didn't produce.
  const [p, setP] = useState(() => parseProxy(value));
  useEffect(() => {
    if (buildProxy(p) !== (value || '')) setP(parseProxy(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const update = (patch) => {
    const next = { ...p, ...patch };
    setP(next);
    onChange(buildProxy(next));
  };
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select style={{ flex: '0 0 120px' }} value={p.scheme} onChange={(e) => update({ scheme: e.target.value })}>
          <option value="">不使用代理</option>
          <option value="http">HTTP</option>
          <option value="socks5">SOCKS5</option>
        </select>
        {p.scheme && <>
          <input style={{ flex: 1, minWidth: 120 }} placeholder="主机 IP/域名" value={p.host} onChange={(e) => update({ host: e.target.value })} />
          <input style={{ flex: '0 0 90px' }} placeholder="端口" value={p.port} onChange={(e) => update({ port: e.target.value })} />
        </>}
      </div>
      {p.scheme && (
        <>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input placeholder="用户名（可选）" value={p.user} onChange={(e) => update({ user: e.target.value })} />
            <input placeholder="密码（可选）" value={p.pass} onChange={(e) => update({ pass: e.target.value })} />
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            {buildProxy(p) ? `将使用：${buildProxy(p)}` : '请填写主机与端口'}
          </div>
        </>
      )}
    </div>
  );
}

/* -------- node processing editor (structured) -------- */
export function NodeProcessingEditor({ value = {}, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const rename = Array.isArray(value.rename) ? value.rename : [];
  const setRename = (list) => set('rename', list);
  return (
    <div className="np-editor">
      <div className="field-row">
        <div className="field"><label>包含名称（正则，留空=全部）</label>
          <input value={value.include || ''} onChange={(e) => set('include', e.target.value)} placeholder="香港|日本|HK" /></div>
        <div className="field"><label>排除名称（正则）</label>
          <input value={value.exclude || ''} onChange={(e) => set('exclude', e.target.value)} placeholder="官网|流量|过期|剩余" /></div>
      </div>
      <div className="field"><label>仅保留协议（不勾=全部）</label>
        <ProtocolPicker value={value.protocols || []} onChange={(v) => set('protocols', v)} /></div>
      <div className="field-row">
        <div className="field"><label>名称前缀（机场内）</label>
          <input value={value.prefix || ''} onChange={(e) => set('prefix', e.target.value)} placeholder="🇭🇰 " /></div>
        <div className="field"><label>跨机场唯一前缀</label>
          <input value={value.globalPrefix || ''} onChange={(e) => set('globalPrefix', e.target.value)} placeholder="A-" /></div>
      </div>
      <div className="field">
        <label>名称替换规则</label>
        {rename.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input placeholder="查找（如 HK）" value={r.from || ''} onChange={(e) => setRename(rename.map((x, idx) => idx === i ? { ...x, from: e.target.value } : x))} />
            <span style={{ alignSelf: 'center' }}>→</span>
            <input placeholder="替换为（如 香港）" value={r.to || ''} onChange={(e) => setRename(rename.map((x, idx) => idx === i ? { ...x, to: e.target.value } : x))} />
            <button type="button" className="btn sm danger" onClick={() => setRename(rename.filter((_, idx) => idx !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="btn sm" onClick={() => setRename([...rename, { from: '', to: '' }])}>＋ 添加替换规则</button>
      </div>
    </div>
  );
}

/* -------- live rule preview --------
   Given the draft filter + selected airports, debounce-fetches /api/nodes/preview
   and shows which nodes are kept vs dropped (with reason) — "所见即所得" for the
   include/exclude/protocol/latency rules. */
const DROP_REASON = {
  proto: { label: '协议不符', cls: 'gray' },
  exproto: { label: '协议排除', cls: 'gray' },
  include: { label: '未匹配包含', cls: 'yellow' },
  exclude: { label: '命中排除', cls: 'yellow' },
  timeout: { label: '超时', cls: 'red' },
  latency: { label: '延迟超限', cls: 'red' },
};

export function RulePreview({ airports = [], filter = {} }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('kept');

  const airportsKey = JSON.stringify(airports);
  const filterKey = JSON.stringify(filter);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      API.previewNodes({ airportIds: airports, filter })
        .then((d) => { if (alive) { setData(d); setErr(null); } })
        .catch((e) => { if (alive) setErr(e.message); })
        .finally(() => { if (alive) setLoading(false); });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airportsKey, filterKey]);

  const list = data ? (tab === 'kept' ? data.kept : data.dropped) : [];

  return (
    <div className="rule-preview">
      <div className="rule-preview-head">
        <span className="section-label" style={{ margin: 0 }}>规则实时预览</span>
        {loading && <span className="spin" style={{ marginLeft: 8 }} />}
        {data && !loading && (
          <span className="muted small" style={{ marginLeft: 'auto' }}>
            命中 <strong style={{ color: 'var(--green)' }}>{data.keptCount}</strong>
            {' / '}排除 <strong style={{ color: 'var(--red)' }}>{data.droppedCount}</strong>
            {' / '}共 {data.total}
          </span>
        )}
      </div>
      {err ? <div className="muted small">预览失败：{err}</div>
        : data && data.total === 0 ? <div className="muted small">所选机场暂无节点（请先在机场管理拉取订阅）。</div>
        : data ? (
          <>
            <div className="rp-tabs">
              <button type="button" className={`rp-tab ${tab === 'kept' ? 'active' : ''}`} onClick={() => setTab('kept')}>命中 {data.keptCount}</button>
              <button type="button" className={`rp-tab ${tab === 'dropped' ? 'active' : ''}`} onClick={() => setTab('dropped')}>排除 {data.droppedCount}</button>
            </div>
            <div className="rp-list">
              {list.length === 0 ? <div className="muted small" style={{ padding: 8 }}>无</div>
                : list.map((n, i) => (
                  <div className="rp-item" key={i}>
                    <span className="rp-name">{n.name}</span>
                    <span className="badge blue rp-proto">{n.type}</span>
                    {n.latency != null && n.latency >= 0 && <span className="muted small">{n.latency}ms</span>}
                    {tab === 'dropped' && n.reason && (
                      <span className={`badge ${DROP_REASON[n.reason]?.cls || 'gray'}`}>{DROP_REASON[n.reason]?.label || n.reason}</span>
                    )}
                  </div>
                ))}
              {data.truncated && <div className="muted small" style={{ padding: 6 }}>仅显示前 400 条…</div>}
            </div>
          </>
        ) : <div className="muted small">加载中…</div>}
    </div>
  );
}

/* -------- group management modal (add / rename / delete) -------- */
export function GroupManagerModal({ kind, title, toast, onClose, onChanged }) {
  const [rows, setRows] = useState([]);
  const [name, setName] = useState('');
  const [confirm, confirmNode] = useConfirm();

  const load = useCallback(() => {
    API.groups(kind).then(setRows).catch((e) => toast.error(e.message));
  }, [kind, toast]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!name.trim()) return;
    try { await API.createGroup({ kind, name: name.trim() }); setName(''); load(); onChanged?.(); }
    catch (e) { toast.error(e.message); }
  };
  const rename = async (g) => {
    const nn = window.prompt('重命名分组', g.name);
    if (nn == null || !nn.trim() || nn === g.name) return;
    try { await API.renameGroup(g.id, nn.trim()); load(); onChanged?.(); toast.success('已重命名'); }
    catch (e) { toast.error(e.message); }
  };
  const del = async (g) => {
    if (!(await confirm(`删除分组「${g.name}」？该分组下成员将变为「无分组」。`))) return;
    try { await API.deleteGroup(g.id); load(); onChanged?.(); toast.success('已删除'); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <Modal title={title || '分组管理'} onClose={onClose} footer={<button className="btn" onClick={onClose}>关闭</button>}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input placeholder="新分组名" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn primary" onClick={add}>新增</button>
      </div>
      {rows.length === 0 ? <div className="muted small">暂无分组。</div> : (
        <table>
          <thead><tr><th>分组</th><th>成员</th><th>操作</th></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td><strong>{g.name}</strong></td>
                <td className="muted small">{g.count}</td>
                <td className="actions">
                  <button className="btn sm" onClick={() => rename(g)}>重命名</button>
                  <button className="btn sm danger" onClick={() => del(g)}>删</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {confirmNode}
    </Modal>
  );
}
