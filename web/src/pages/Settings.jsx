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
