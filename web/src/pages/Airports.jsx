import { useState } from 'react';
import { API } from '../api.js';
import { Modal, useConfirm, copyText, fmtBytes, fmtDate, fmtDateTime, daysLeft, toDatetimeLocal, fromDatetimeLocal, ActionMenu } from '../ui.jsx';
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
  const [manual, setManual] = useState(null);
  const [costAirport, setCostAirport] = useState(null);
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
                  <SortTh label="最后拉取" k="last_fetch_at" table={t} />
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
                    <td className="small muted">{a.last_fetch_at ? fmtDateTime(a.last_fetch_at) : '从未'}</td>
                    <td>{a.group_name || '-'}</td>
                    <td className="actions">
                      <ActionMenu label={busy[a.id] ? <span className="spin" /> : '操作 ▾'} items={[
                        { label: '拉取订阅', disabled: !!busy[a.id], onClick: () => doFetch(a.id) },
                        { label: '自动重置', disabled: !!busy[a.id], title: '后台自动登录重置', onClick: () => doReset(a.id) },
                        { label: '手动重置', title: '自己登录机场重置后粘贴新链接', onClick: () => setManual(a) },
                        { label: '成本/趋势', title: '成本记账与流量趋势', onClick: () => setCostAirport(a) },
                        { label: '编辑', onClick: () => setEditing(a) },
                        { label: '删除', danger: true, onClick: () => doDelete(a.id) },
                      ]} />
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
            <div className="mrow"><span className="k">最后拉取</span><span className="small muted">{a.last_fetch_at ? fmtDateTime(a.last_fetch_at) : '从未'}</span></div>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => doFetch(a.id)}>拉取</button>
              <button className="btn sm" onClick={() => doReset(a.id)}>重置</button>
              <button className="btn sm" onClick={() => setManual(a)}>手动重置</button>
              <button className="btn sm" onClick={() => setEditing(a)}>编辑</button>
              <button className="btn sm danger" onClick={() => doDelete(a.id)}>删</button>
            </div>
          </div>
        ))}
      </div>

      {editing && <AirportModal airport={editing} groups={groups} toast={toast} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); refreshGroups(); }} />}
      {manual && <ManualResetModal airport={manual} toast={toast} onClose={() => setManual(null)} onDone={() => { setManual(null); invalidate('nodes:'); load(); }} />}
      {costAirport && <CostTrendModal airport={costAirport} toast={toast} onClose={() => setCostAirport(null)} onChanged={load} />}
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
    panel_type: airport.panel_type || 'generic', group_name: airport.group_name || '',
    remark: airport.remark || '', proxy: airport.proxy || '',
    user_agent: airport.user_agent || '', cookie: airport.cookie || '',
    auth_token: airport.auth_token || '',
    reset_mode: airport.reset_mode || 'http',
    flaresolverr_url: airport.flaresolverr_url || '',
    request_headers: safeParse(airport.request_headers),
    node_filter: safeParse(airport.node_filter),
    expire_at: toDatetimeLocal(airport.expire_at),
  });
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const detect = async () => {
    if (!f.url.trim()) return toast.error('请先填写机场网址');
    setDetecting(true);
    try {
      const r = await API.detectPanel({ url: f.url, proxy: f.proxy, cookie: f.cookie, user_agent: f.user_agent });
      set('panel_type', r.panel_type);
      toast.success(`识别为「${r.panel_type}」：${r.detail}`);
    } catch (e) { toast.error(e.message); }
    finally { setDetecting(false); }
  };

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
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={f.panel_type} onChange={(e) => set('panel_type', e.target.value)}>
              {PANEL_TYPES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
            </select>
            <button type="button" className="btn sm" style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
              onClick={detect} disabled={detecting} title="通过机场网址自动识别面板类型">
              {detecting ? <span className="spin" /> : '自动识别'}
            </button>
          </div>
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
      <div className="field">
        <label>登录令牌 Authorization（可选，V2Board/Xboard 自动重置优先用它，跳过登录以绕过人机验证）</label>
        <input value={f.auth_token} onChange={(e) => set('auth_token', e.target.value)} placeholder="浏览器登录后从任意接口请求头复制 Authorization 值" />
      </div>

      <div className="section-label">自动重置方式</div>
      <div className="field-row">
        <div className="field">
          <label>重置方式</label>
          <select value={f.reset_mode} onChange={(e) => set('reset_mode', e.target.value)}>
            <option value="http">HTTP 轻量（默认，直接请求接口）</option>
            <option value="flaresolverr">FlareSolverr（推荐，专治 Cloudflare）</option>
            <option value="manual">手动重置（半自动，自己登录后粘贴新链接）</option>
          </select>
        </div>
        {f.reset_mode === 'flaresolverr' && (
          <div className="field">
            <label>FlareSolverr 地址（留空=用默认侧车）</label>
            <input value={f.flaresolverr_url} onChange={(e) => set('flaresolverr_url', e.target.value)} placeholder="http://flaresolverr:8191" />
          </div>
        )}
      </div>
      {f.reset_mode === 'flaresolverr' && (
        <div className="muted small" style={{ marginTop: -6, marginBottom: 4 }}>
          FlareSolverr 用真实浏览器解开 Cloudflare，取回 cf_clearance 与匹配 UA 写回本机场，再走 HTTP 完成登录+重置——
          面板与 FlareSolverr 同出口 IP，cf_clearance 有效，可稳定绕过 CF「Just a moment」。需在 docker-compose 里启用
          <code>flaresolverr</code> 服务。仍要填账号密码或登录令牌。请先用「自动化」页「测试」验证。
          <br />强挑战站点（如魔戒）若报“解挑战超时”：① 调大 <code>FLARESOLVERR_TIMEOUT</code>（如 180000）；
          ② 给上方「拉取代理」配一个干净/住宅代理——机房 IP 常被加强挑战，配代理后 FlareSolverr 与重置会走同一代理，成功率更高。
        </div>
      )}
      {f.reset_mode === 'manual' && (
        <div className="muted small" style={{ marginTop: -6, marginBottom: 4 }}>
          手动重置模式：面板不再自动登录。当某机场 Cloudflare 无法自动绕过时用它——在机场列表点「手动重置」，
          按引导登录机场重置订阅，把新订阅链接粘回，面板保存并自动拉取一次。自动化/定时会跳过该机场。
        </div>
      )}

      <div className="section-label">节点处理</div>
      <NodeProcessingEditor value={f.node_filter} onChange={(v) => set('node_filter', v)} />

      <div className="field" style={{ marginTop: 14 }}><label>备注</label><input value={f.remark} onChange={(e) => set('remark', e.target.value)} /></div>
      <div className="muted small" style={{ marginTop: 8 }}>💡 成本记账与流量趋势请在机场列表「操作 → 成本/趋势」中管理。</div>
    </Modal>
  );
}

/* ---------------- 成本/趋势 ---------------- */
function UsageChart({ snapshots }) {
  const pts = [];
  for (let i = 1; i < snapshots.length; i++) pts.push({ ts: snapshots[i].ts, v: Math.max(0, snapshots[i].cum - snapshots[i - 1].cum) });
  const last = pts.slice(-30);
  if (!last.length) return <div className="muted small">暂无足够快照（每次拉取机场按天积累，明天起会有曲线）。</div>;
  const max = Math.max(1, ...last.map((p) => p.v));
  const W = 520, H = 120, pad = 18, bw = (W - pad * 2) / last.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      {last.map((p, i) => {
        const h = (p.v / max) * (H - pad * 2);
        return <rect key={i} x={pad + i * bw + 1} y={H - pad - h} width={Math.max(1, bw - 2)} height={h} fill="var(--accent)" rx="1"><title>{`${fmtDate(p.ts)}：${fmtBytes(p.v)}`}</title></rect>;
      })}
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--border)" />
    </svg>
  );
}

function CostTrendModal({ airport, toast, onClose, onChanged }) {
  const [costType, setCostType] = useState(airport.cost_type || 'time');
  const [trend, setTrend] = useState(null);
  const [costs, setCosts] = useState([]);
  const [form, setForm] = useState({ kind: 'time', amount: '', traffic_gb: '', days: 30, note: '' });

  const load = () => {
    API.airportTrend(airport.id).then(setTrend).catch((e) => toast.error(e.message));
    API.airportCosts(airport.id).then(setCosts).catch(() => {});
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [airport.id]);

  const changeType = async (t) => {
    setCostType(t);
    setForm((f) => ({ ...f, kind: t === 'traffic' ? 'traffic' : 'time' }));
    try { await API.updateAirport(airport.id, { cost_type: t }); load(); onChanged?.(); }
    catch (e) { toast.error(e.message); }
  };
  const addCost = async () => {
    if (form.amount === '') return toast.error('请填写金额');
    try {
      await API.addAirportCost(airport.id, {
        kind: form.kind, amount: Number(form.amount),
        traffic_gb: form.traffic_gb === '' ? null : Number(form.traffic_gb),
        days: form.days === '' ? null : Number(form.days), note: form.note || null,
      });
      setForm((f) => ({ ...f, amount: '', traffic_gb: '', note: '' }));
      load(); onChanged?.(); toast.success('已记一笔');
    } catch (e) { toast.error(e.message); }
  };
  const delCost = async (cid) => { try { await API.deleteAirportCost(airport.id, cid); load(); onChanged?.(); } catch (e) { toast.error(e.message); } };

  const KIND_LABEL = { time: '时长套餐', traffic: '流量买量', topup: '加油/重置' };

  return (
    <Modal wide title={`成本 / 趋势 · ${airport.name}`} onClose={onClose}
      footer={<button className="btn" onClick={onClose}>关闭</button>}>
      <div className="field-row" style={{ alignItems: 'end' }}>
        <div className="field"><label>计费类型</label>
          <select value={costType} onChange={(e) => changeType(e.target.value)}>
            <option value="time">时长套餐（元/周期）</option>
            <option value="traffic">流量套餐（不限时，按量）</option>
          </select>
        </div>
        {trend && (
          <div className="field" style={{ flex: 2 }}>
            <label>记账</label>
            <div className="small">
              月成本 <strong>¥{(trend.monthlyCost || 0).toFixed(2)}</strong>
              {costType === 'traffic' && <>　单价 <strong>¥{(trend.unitPrice || 0).toFixed(3)}/GB</strong>　近30天 {fmtBytes(trend.consumption30d)}</>}
              {costType === 'traffic' && trend.remaining > 0 && <>　剩余 {fmtBytes(trend.remaining)}{trend.daysLeft != null ? `（约 ${trend.daysLeft} 天）` : ''}</>}
            </div>
          </div>
        )}
      </div>

      <h3 style={{ fontSize: 15, margin: '14px 0 6px' }}>每日用量趋势（近 30 天）</h3>
      {trend ? <UsageChart snapshots={trend.snapshots || []} /> : <div className="muted small"><span className="spin" /></div>}

      <h3 style={{ fontSize: 15, margin: '16px 0 6px' }}>成本流水</h3>
      <div className="field-row" style={{ alignItems: 'end' }}>
        <div className="field"><label>类型</label>
          <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
            <option value="time">时长套餐（续费/开通）</option>
            <option value="traffic">流量买量（含用尽重置）</option>
            <option value="topup">加油/重置（一次性）</option>
          </select>
        </div>
        <div className="field"><label>金额</label><input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></div>
        {form.kind === 'traffic' && <div className="field"><label>流量(GB)</label><input type="number" min="0" value={form.traffic_gb} onChange={(e) => setForm((f) => ({ ...f, traffic_gb: e.target.value }))} /></div>}
        {form.kind === 'time' && <div className="field"><label>周期(天)</label><input type="number" min="1" value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} /></div>}
        <div className="field"><label>备注</label><input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></div>
        <button className="btn" onClick={addCost}>+ 记一笔</button>
      </div>
      {costs.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead><tr><th>时间</th><th>类型</th><th>金额</th><th>流量/周期</th><th>备注</th><th></th></tr></thead>
            <tbody>
              {costs.map((c) => (
                <tr key={c.id}>
                  <td className="small muted">{fmtDate(c.created_at)}</td>
                  <td className="small">{KIND_LABEL[c.kind] || c.kind}</td>
                  <td className="small">¥{Number(c.amount || 0).toFixed(2)}</td>
                  <td className="small">{c.traffic_gb ? `${c.traffic_gb}GB` : c.days ? `${c.days}天` : '-'}</td>
                  <td className="small muted">{c.note || '-'}</td>
                  <td><button className="btn sm danger" onClick={() => delCost(c.id)}>删</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- 手动重置（半自动兜底）---------------- */
function ManualResetModal({ airport, toast, onClose, onDone }) {
  const [subUrl, setSubUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!/^https?:\/\//i.test(subUrl.trim())) return toast.error('请粘贴有效的新订阅链接（http/https 开头）');
    setSaving(true);
    try {
      const r = await API.manualResetAirport(airport.id, subUrl.trim());
      toast.success(`已保存并拉取，${r.count} 个节点`);
      onDone();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`手动重置 · ${airport.name}`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={submit} disabled={saving}>{saving ? <span className="spin" /> : '保存并拉取'}</button>
      </>}>
      <ol className="manual-steps">
        <li>
          打开机场登录页并登录：
          {airport.url
            ? <a href={airport.url} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>去登录 ↗</a>
            : <span className="muted"> 未配置机场网址</span>}
        </li>
        <li>
          账户：
          {airport.account
            ? <span className="pill-copy mono" onClick={() => copyText(airport.account, toast)} title="点击复制">{airport.account}</span>
            : <span className="muted">未填</span>}
          {airport.password && <span className="pill-copy small muted" style={{ marginLeft: 6 }} onClick={() => copyText(airport.password, toast)} title="点击复制密码">🔑 复制密码</span>}
        </li>
        <li>在机场用户中心「重置订阅 / 重置安全链接」，复制生成的<strong>新订阅链接</strong>。</li>
        <li>粘贴到下方，点「保存并拉取」。</li>
      </ol>
      <div className="field" style={{ marginTop: 8 }}>
        <label>新订阅链接</label>
        <input value={subUrl} onChange={(e) => setSubUrl(e.target.value)} placeholder="https://机场域名/api/v1/client/subscribe?token=..." />
      </div>
      {airport.sub_url && <div className="muted small">当前链接：{airport.sub_url}</div>}
    </Modal>
  );
}
