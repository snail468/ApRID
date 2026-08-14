import { useState, useEffect, useCallback } from 'react';
import { API } from '../api.js';
import { fmtDate } from '../ui.jsx';

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
        <NotifyCard toast={toast} />
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
        用户到期/超限、机场用量≥97% 或到期≤1天时提醒管理员。通知内含免登录魔法链接，可直接回填订阅链接或拉取机场。
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
