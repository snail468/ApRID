import { useState, useEffect, useCallback } from 'react';
import { API } from '../api.js';
import { Modal, fmtDateTime } from '../ui.jsx';

export default function Audit({ toast }) {
  const [rows, setRows] = useState([]);
  const [actors, setActors] = useState([]);
  const [actor, setActor] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async (opts = {}) => {
    setLoading(true);
    try {
      const before = opts.append ? rows[rows.length - 1]?.id : undefined;
      const data = await API.audit({ actor, q, before, limit: 100 });
      setRows((prev) => (opts.append ? [...prev, ...data] : data));
      setDone(data.length < 100);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [actor, q, rows, toast]);

  // reload from scratch whenever a filter changes
  useEffect(() => {
    let alive = true;
    setLoading(true);
    API.audit({ actor, q, limit: 100 }).then((data) => {
      if (!alive) return;
      setRows(data); setDone(data.length < 100);
    }).catch((e) => toast.error(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, q]);

  useEffect(() => { API.auditActors().then(setActors).catch(() => {}); }, []);

  return (
    <>
      <div className="page-head"><h1>操作审计</h1></div>
      <p className="muted small" style={{ marginTop: -8 }}>
        记录管理员的每一次增删改操作（谁 / 何时 / 改了什么 / 结果），保留 90 天。密码、令牌等敏感字段已脱敏。
      </p>
      <div className="toolbar">
        <input className="search" placeholder="搜索动作/路径" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ width: 160 }} value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">全部操作者</option>
          {actors.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {loading && rows.length === 0 ? <div className="empty"><span className="spin" /></div>
        : rows.length === 0 ? <div className="empty">暂无审计记录。</div>
        : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="nosort">时间</th>
                    <th className="nosort">操作者</th>
                    <th className="nosort">动作</th>
                    <th className="nosort">方法</th>
                    <th className="nosort">结果</th>
                    <th className="nosort">来源 IP</th>
                    <th className="nosort">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="small mono">{fmtDateTime(r.created_at)}</td>
                      <td>{r.actor || <span className="muted">-</span>}</td>
                      <td>{r.action}</td>
                      <td><span className={`badge ${methodClass(r.method)}`}>{r.method}</span></td>
                      <td>{statusBadge(r.status)}</td>
                      <td className="small mono muted">{r.ip || '-'}</td>
                      <td>{r.detail ? <button className="btn sm" onClick={() => setDetail(r)}>查看</button> : <span className="muted">-</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-cards">
              {rows.map((r) => (
                <div className="mcard" key={r.id}>
                  <div className="mrow"><strong>{r.action}</strong>{statusBadge(r.status)}</div>
                  <div className="mrow"><span className="k">时间</span><span className="small">{fmtDateTime(r.created_at)}</span></div>
                  <div className="mrow"><span className="k">操作者</span><span>{r.actor || '-'}</span></div>
                  <div className="mrow"><span className="k">方法 / IP</span><span className="small mono">{r.method} · {r.ip || '-'}</span></div>
                  {r.detail && <div className="mrow"><span className="k" /><button className="btn sm" onClick={() => setDetail(r)}>查看详情</button></div>}
                </div>
              ))}
            </div>

            {!done && (
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button className="btn sm" onClick={() => load({ append: true })} disabled={loading}>
                  {loading ? <span className="spin" /> : '加载更多'}
                </button>
              </div>
            )}
          </>
        )}

      {detail && (
        <Modal title={`详情 · ${detail.action}`} onClose={() => setDetail(null)}
          footer={<button className="btn" onClick={() => setDetail(null)}>关闭</button>}>
          <div className="muted small" style={{ marginBottom: 8 }}>{detail.method} {detail.path}</div>
          <pre className="mono small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
            {prettyJson(detail.detail)}
          </pre>
        </Modal>
      )}
    </>
  );
}

function methodClass(m) {
  return m === 'DELETE' ? 'red' : m === 'POST' ? 'green' : 'blue';
}
function statusBadge(s) {
  if (s == null) return <span className="muted">-</span>;
  const cls = s < 300 ? 'green' : s < 400 ? 'yellow' : 'red';
  return <span className={`badge ${cls}`}>{s}</span>;
}
function prettyJson(s) {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}
