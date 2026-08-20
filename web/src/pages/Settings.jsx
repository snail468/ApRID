import { useState, useEffect, useCallback, useRef } from 'react';
import { API } from '../api.js';
import { fmtDate, useConfirm } from '../ui.jsx';

export default function Settings({ toast, onAccountChange }) {
  const [settings, setSettings] = useState(null);
  const load = useCallback(() => API.settings().then(setSettings).catch((e) => toast.error(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);

  if (!settings) return <div className="empty"><span className="spin" /></div>;
  return (
    <>
      <div className="page-head"><h1>设置</h1></div>
      <div style={{ display: 'grid', gap: 20, maxWidth: 720 }}>
        <AccountCard settings={settings} toast={toast} onChanged={onAccountChange} />
        <PlansCard toast={toast} />
        <NotifyCard toast={toast} />
        <NodeExcludeCard toast={toast} />
        <AdminPathCard toast={toast} />
        <DeliveryCard toast={toast} />
        <BackupCard toast={toast} />
        <TwoFACard settings={settings} toast={toast} reload={load} />
        <DevicesCard toast={toast} />
      </div>
    </>
  );
}

function AccountCard({ settings, toast, onChanged }) {
  const [username, setUsername] = useState(settings.username);
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!currentPassword) return toast.error('请输入当前密码');
    setSaving(true);
    try {
      await API.updateAccount({ username, currentPassword, newPassword: newPassword || undefined });
      toast.success('账户已更新，请重新登录');
      setTimeout(() => onAccountChange?.(), 1200);
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>账户</h3>
      <div className="field"><label>用户名</label><input value={username} onChange={(e) => setUsername(e.target.value)} /></div>
      <div className="field-row">
        <div className="field"><label>当前密码 *</label><input type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div className="field"><label>新密码（留空不改）</label><input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} /></div>
      </div>
      <button className="btn primary" onClick={save} disabled={saving}>{saving ? <span className="spin" /> : '保存账户'}</button>
    </div>
  );
}

function NotifyCard({ toast }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => { API.getNotify().then(setCfg).catch((e) => toast.error(e.message)); }, [toast]);
  if (!cfg) return <div className="card"><h3 style={{ marginTop: 0 }}>🔔 告警通知</h3><div className="muted small"><span className="spin" /></div></div>;

  const setTop = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  const setEmail = (k, v) => setCfg((c) => ({ ...c, email: { ...c.email, [k]: v } }));
  const setTg = (k, v) => setCfg((c) => ({ ...c, telegram: { ...c.telegram, [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      const r = await API.saveNotify(cfg);
      setCfg(r.config);
      toast.success('告警通知设置已保存');
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  const test = async () => {
    setTesting(true);
    try { const r = await API.testNotify(); toast.success(`测试通知已发送（${r.results.map((x) => x.channel).join('/')}）`); }
    catch (e) { toast.error(e.message); } finally { setTesting(false); }
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>🔔 告警通知</h3>
      <p className="muted small">
        用户到期/即将到期(≤1天)/超限、机场用量≥97% 或到期≤1天时提醒管理员。通知内含免登录魔法链接，可直接回填订阅链接或拉取机场。
        超限/机场用量为事件即时触发，到期类每小时后台自动检查。
      </p>

      <div className="field">
        <label>面板对外地址（魔法链接用，留空则用请求 Host / PUBLIC_BASE_URL）</label>
        <input value={cfg.panelBaseUrl || ''} onChange={(e) => setTop('panelBaseUrl', e.target.value)} placeholder="https://panel.example.com" />
      </div>
      <div className="field-row">
        <label className="checkbox-inline"><input type="checkbox" checked={!!cfg.userAlerts} onChange={(e) => setTop('userAlerts', e.target.checked)} /><span>用户端告警</span></label>
        <label className="checkbox-inline"><input type="checkbox" checked={!!cfg.airportAlerts} onChange={(e) => setTop('airportAlerts', e.target.checked)} /><span>机场端告警</span></label>
        <div className="field"><label>同类告警冷却(小时)</label><input type="number" min="0" value={cfg.cooldownHours ?? 24} onChange={(e) => setTop('cooldownHours', Number(e.target.value))} /></div>
      </div>
      <div className="field-row">
        <div className="field"><label>机场连续拉取失败告警阈值(次,0关)</label><input type="number" min="0" value={cfg.fetchFailThreshold ?? 3} onChange={(e) => setTop('fetchFailThreshold', Number(e.target.value))} /></div>
        <div className="field"><label>订阅多IP安全告警阈值(24h内IP数,0关)</label><input type="number" min="0" value={cfg.multiIpThreshold ?? 3} onChange={(e) => setTop('multiIpThreshold', Number(e.target.value))} /></div>
      </div>

      <h4 style={{ margin: '14px 0 6px' }}>
        <label className="checkbox-inline"><input type="checkbox" checked={!!cfg.email.enabled} onChange={(e) => setEmail('enabled', e.target.checked)} /><span>邮件 (SMTP)</span></label>
      </h4>
      {cfg.email.enabled && (
        <>
          <div className="field-row">
            <div className="field"><label>SMTP 主机</label><input value={cfg.email.host || ''} onChange={(e) => setEmail('host', e.target.value)} placeholder="smtp.gmail.com" /></div>
            <div className="field"><label>端口</label><input type="number" value={cfg.email.port ?? 465} onChange={(e) => setEmail('port', Number(e.target.value))} /></div>
            <label className="checkbox-inline"><input type="checkbox" checked={cfg.email.secure !== false} onChange={(e) => setEmail('secure', e.target.checked)} /><span>SSL/TLS</span></label>
          </div>
          <div className="field-row">
            <div className="field"><label>账号</label><input value={cfg.email.user || ''} onChange={(e) => setEmail('user', e.target.value)} autoComplete="off" /></div>
            <div className="field"><label>密码 / 授权码（留空不改）</label><input type="password" value={cfg.email.pass || ''} onChange={(e) => setEmail('pass', e.target.value)} autoComplete="new-password" /></div>
          </div>
          <div className="field-row">
            <div className="field"><label>发件人 From（留空用账号）</label><input value={cfg.email.from || ''} onChange={(e) => setEmail('from', e.target.value)} /></div>
            <div className="field"><label>收件人 To（管理员邮箱）</label><input value={cfg.email.to || ''} onChange={(e) => setEmail('to', e.target.value)} /></div>
          </div>
        </>
      )}

      <h4 style={{ margin: '14px 0 6px' }}>
        <label className="checkbox-inline"><input type="checkbox" checked={!!cfg.telegram.enabled} onChange={(e) => setTg('enabled', e.target.checked)} /><span>Telegram</span></label>
      </h4>
      {cfg.telegram.enabled && (
        <div className="field-row">
          <div className="field"><label>Bot Token（留空不改）</label><input type="password" value={cfg.telegram.botToken || ''} onChange={(e) => setTg('botToken', e.target.value)} autoComplete="new-password" placeholder="123456:ABC..." /></div>
          <div className="field"><label>Chat ID</label><input value={cfg.telegram.chatId || ''} onChange={(e) => setTg('chatId', e.target.value)} placeholder="123456789" /></div>
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? <span className="spin" /> : '保存告警设置'}</button>
        <button className="btn" onClick={test} disabled={testing}>{testing ? <span className="spin" /> : '发送测试'}</button>
      </div>
    </div>
  );
}

function NodeExcludeCard({ toast }) {
  const [value, setValue] = useState(null);
  const [def, setDef] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    API.getNodeExclude().then((r) => { setValue(r.value || ''); setDef(r.default || ''); }).catch((e) => toast.error(e.message));
  }, [toast]);
  if (value === null) return <div className="card"><h3 style={{ marginTop: 0 }}>🧹 全局节点排除</h3><div className="muted small"><span className="spin" /></div></div>;

  const save = async () => {
    setSaving(true);
    try { const r = await API.saveNodeExclude(value); setValue(r.value || ''); toast.success('全局节点排除已保存'); }
    catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>🧹 全局节点排除</h3>
      <p className="muted small">
        一条正则（不区分大小写），名称匹配的节点会被全局丢弃——用来清掉机场塞进订阅的广告/通知节点（流量、到期、官网…）。
        用 <code>|</code> 分隔关键词。留空表示不排除。
      </p>
      <div className="field">
        <label>排除正则</label>
        <textarea rows={4} className="mono" style={{ width: '100%', resize: 'vertical' }}
          value={value} onChange={(e) => setValue(e.target.value)} placeholder="官网|流量|到期|..." />
      </div>
      <p className="muted small">导入机场时即时对新拉取生效（旧节点下次拉取时清理）；下发订阅时也即时生效。</p>
      <div className="btn-row">
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? <span className="spin" /> : '保存'}</button>
        <button className="btn" onClick={() => setValue(def)} title="恢复内置默认排除词">恢复默认</button>
      </div>
    </div>
  );
}

function AdminPathCard({ toast }) {
  const [value, setValue] = useState(null);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirm, confirmNode] = useConfirm();

  useEffect(() => {
    API.getAdminPath().then((r) => { setValue(r.value || ''); setInput(r.value || ''); }).catch((e) => toast.error(e.message));
  }, [toast]);
  if (value === null) return <div className="card"><h3 style={{ marginTop: 0 }}>🕵️ 隐藏管理入口</h3><div className="muted small"><span className="spin" /></div></div>;

  const clean = (input || '').trim().replace(/^\/+|\/+$/g, '');
  const valid = clean === '' || /^[A-Za-z0-9_-]{1,64}$/.test(clean);
  const origin = window.location.origin;

  const save = async () => {
    if (!valid) return toast.error('路径只能是字母/数字/下划线/连字符（1–64 位）');
    const msg = clean
      ? `保存后，管理面板将只能通过 ${origin}/${clean} 访问，根路径及其它路径返回 404。请务必记住这个路径！`
      : '将清除隐藏路径，管理面板恢复在根路径可访问。';
    if (!(await confirm(msg))) return;
    setSaving(true);
    try {
      const r = await API.saveAdminPath(clean);
      setValue(r.value || ''); setInput(r.value || '');
      toast.success('已保存');
      if (r.value) {
        // navigate to the new secret path so the current session isn't stranded on a 404
        setTimeout(() => { window.location.href = `${origin}/${r.value}`; }, 800);
      }
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>🕵️ 隐藏管理入口</h3>
      <p className="muted small">
        设一个只有你知道的路径，管理面板将<strong>只在该路径下</strong>可访问（如 <code className="mono">{origin}/{clean || 's3cr3t'}</code>），
        其它任何路径都返回 404，避免登录入口被扫描/发现。留空 = 关闭（根路径可访问）。
      </p>
      <div className="field">
        <label>自定义路径（留空关闭）</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="muted small mono">{origin}/</span>
          <input className="mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder="s3cr3t-panel" style={{ flex: 1 }} />
        </div>
        {!valid && <div className="err-text small" style={{ marginTop: 4 }}>只能用字母/数字/下划线/连字符，1–64 位</div>}
      </div>
      <p className="muted small">
        ⚠️ 忘记路径会把自己锁在外面——恢复方法：在数据库执行
        <code className="mono"> UPDATE settings SET value='' WHERE key='admin_path'</code>，或用「恢复」导入旧备份。
        API（<code>/api</code>）与订阅（<code>/sub</code>）不受影响。
      </p>
      <div className="btn-row">
        <button className="btn primary" onClick={save} disabled={saving || !valid}>{saving ? <span className="spin" /> : '保存'}</button>
        {value && <span className="muted small" style={{ alignSelf: 'center' }}>当前：<code className="mono">/{value}</code></span>}
      </div>
      {confirmNode}
    </div>
  );
}

function DeliveryCard({ toast }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { API.getDelivery().then(setCfg).catch((e) => toast.error(e.message)); }, [toast]);
  if (!cfg) return <div className="card"><h3 style={{ marginTop: 0 }}>📦 订阅下发</h3><div className="muted small"><span className="spin" /></div></div>;

  const save = async (patch) => {
    setSaving(true);
    try { const r = await API.saveDelivery(patch); setCfg(r); toast.success('已保存'); }
    catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>📦 订阅下发</h3>
      <p className="muted small">下发给用户订阅时的处理选项。改动即时生效（下次拉取订阅时应用）。</p>
      <label className="checkbox-inline" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={cfg.dedup} disabled={saving} onChange={(e) => save({ dedup: e.target.checked })} />
        <span>按端点去重：同一 <code>服务器:端口</code> 只保留一个，剔除多账号导入的重复节点</span>
      </label>
      <label className="checkbox-inline" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={cfg.sortByHealth} disabled={saving} onChange={(e) => save({ sortByHealth: e.target.checked })} />
        <span>好节点优先：按可用性/可用率/延迟把健康节点排在订阅前面（可用性检测通过的最优先，不通的沉底）</span>
      </label>
      <label className="checkbox-inline">
        <input type="checkbox" checked={cfg.dropDead} disabled={saving} onChange={(e) => save({ dropDead: e.target.checked })} />
        <span>不下发不通节点：可用性检测判定不通（<code>alive=0</code>）的节点直接不下发；未检测的节点不受影响</span>
      </label>
    </div>
  );
}

function PlansCard({ toast }) {
  const [plans, setPlans] = useState(null);
  const [form, setForm] = useState({ name: '', days: 30, traffic_gb: '', price: '' });
  const load = useCallback(() => API.plans().then(setPlans).catch((e) => toast.error(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!form.name.trim()) return toast.error('套餐名必填');
    try { await API.createPlan(form); setForm({ name: '', days: 30, traffic_gb: '', price: '' }); load(); toast.success('已添加套餐'); }
    catch (e) { toast.error(e.message); }
  };
  const del = async (id) => { try { await API.deletePlan(id); load(); } catch (e) { toast.error(e.message); } };

  if (!plans) return <div className="card"><h3 style={{ marginTop: 0 }}>🎫 套餐管理</h3><div className="muted small"><span className="spin" /></div></div>;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>🎫 套餐管理</h3>
      <p className="muted small">套餐 = 时长(天) + 流量(GB，空/0=不限) + 价格。用户「续费」时可一键套用（延长到期、重置本期流量）。</p>
      {plans.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>名称</th><th>时长</th><th>流量</th><th>价格</th><th></th></tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td><td>{p.days ? `${p.days}天` : '-'}</td>
                  <td>{p.traffic_gb ? `${p.traffic_gb}GB` : '不限'}</td><td>{p.price ?? '-'}</td>
                  <td><button className="btn sm danger" onClick={() => del(p.id)}>删</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="field-row" style={{ marginTop: 10 }}>
        <div className="field"><label>名称</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
        <div className="field"><label>时长(天)</label><input type="number" value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} /></div>
        <div className="field"><label>流量(GB)</label><input type="number" value={form.traffic_gb} placeholder="空=不限" onChange={(e) => setForm((f) => ({ ...f, traffic_gb: e.target.value }))} /></div>
        <div className="field"><label>价格</label><input type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} /></div>
      </div>
      <button className="btn" onClick={add}>+ 添加套餐</button>
    </div>
  );
}

function BackupCard({ toast }) {
  const fileRef = useRef(null);
  const [restoring, setRestoring] = useState(false);
  const [confirm, confirmNode] = useConfirm();

  const doRestore = async (file) => {
    if (!file) return;
    if (!(await confirm(`用「${file.name}」覆盖当前数据库？此操作不可撤销，恢复后服务会自动重启。`))) {
      if (fileRef.current) fileRef.current.value = ''; return;
    }
    setRestoring(true);
    try { await API.restoreDb(file); toast.success('已恢复，服务正在重启，请稍候刷新页面'); }
    catch (e) { toast.error(e.message); }
    finally { setRestoring(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>💾 数据库备份 / 恢复</h3>
      <p className="muted small">备份导出完整数据库快照（机场/用户/模板/设置全部在内）；恢复会<strong>覆盖当前数据并重启服务</strong>。建议定期下载备份。</p>
      <div className="btn-row">
        <a className="btn primary" href={API.backupUrl} download>下载备份</a>
        <button className="btn" disabled={restoring} onClick={() => fileRef.current?.click()}>{restoring ? <span className="spin" /> : '上传恢复'}</button>
        <input ref={fileRef} type="file" accept=".db" style={{ display: 'none' }} onChange={(e) => doRestore(e.target.files[0])} />
      </div>
      {confirmNode}
    </div>
  );
}

function TwoFACard({ settings, toast, reload }) {
  const [enabled, setEnabled] = useState(settings.twofaEnabled);
  const [setup, setSetup] = useState(null); // {qr, secret}
  const [otp, setOtp] = useState('');
  const [pw, setPw] = useState('');

  useEffect(() => { setEnabled(settings.twofaEnabled); }, [settings.twofaEnabled]);

  const beginSetup = async () => {
    try { setSetup(await API.twofaSetup()); } catch (e) { toast.error(e.message); }
  };
  const confirmEnable = async () => {
    try { await API.twofaEnable({ otp }); toast.success('两步验证已开启'); setSetup(null); setOtp(''); setEnabled(true); reload(); }
    catch (e) { toast.error(e.message); }
  };
  const disable = async () => {
    try { await API.twofaDisable({ currentPassword: pw }); toast.success('两步验证已关闭'); setPw(''); setEnabled(false); reload(); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>两步验证 (TOTP) {enabled ? <span className="badge green">已开启</span> : <span className="badge gray">未开启</span>}</h3>
      {!enabled && !setup && (
        <>
          <p className="muted small">使用 Google Authenticator / 1Password 等扫码，增强登录安全。</p>
          <button className="btn" onClick={beginSetup}>开启两步验证</button>
        </>
      )}
      {!enabled && setup && (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="qr-box"><img src={setup.qr} alt="totp qr" width={180} height={180} /></div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="field"><label>密钥（手动输入用）</label><input readOnly className="mono" value={setup.secret} /></div>
            <div className="field"><label>输入 App 中的 6 位验证码</label><input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" /></div>
            <div className="btn-row">
              <button className="btn primary" onClick={confirmEnable}>确认开启</button>
              <button className="btn" onClick={() => setSetup(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
      {enabled && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
            <label>关闭两步验证需验证当前密码</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <button className="btn danger" onClick={disable}>关闭两步验证</button>
        </div>
      )}
    </div>
  );
}

function DevicesCard({ toast }) {
  const [devices, setDevices] = useState([]);
  const load = useCallback(() => API.devices().then(setDevices).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const revoke = async (id) => { await API.revokeDevice(id); toast.success('已移除'); load(); };
  const revokeAll = async () => { await API.revokeAllDevices(); toast.success('已清空信任设备'); load(); };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>信任设备 <span className="muted small">（{devices.length}，60 天失效）</span></h3>
      {devices.length === 0 ? <div className="muted small">暂无信任设备。</div> : (
        <>
          <table>
            <thead><tr><th>设备</th><th>信任时间</th><th>失效时间</th><th></th></tr></thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td className="small">{d.label}</td>
                  <td className="muted small">{fmtDate(d.created_at)}</td>
                  <td className="muted small">{fmtDate(d.expires_at)}</td>
                  <td><button className="btn sm danger" onClick={() => revoke(d.id)}>移除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12 }}><button className="btn sm danger" onClick={revokeAll}>清空全部</button></div>
        </>
      )}
    </div>
  );
}
