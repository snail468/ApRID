import { useState } from 'react';
import { API } from '../api.js';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [need2fa, setNeed2fa] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      const r = await API.login({ username, password, otp: otp || undefined, trustDevice });
      if (r.need2fa) {
        setNeed2fa(true);
        setErr(otp ? '两步验证码错误' : '');
      } else if (r.ok) {
        const me = await API.me();
        onLogin(me);
      }
    } catch (e) {
      setErr(e.message);
      if (e.data?.need2fa) setNeed2fa(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <h1>✈️ ApRID</h1>
        <p className="sub">机场资源整合面板</p>
        <div className="field">
          <label>用户名</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </div>
        <div className="field">
          <label>密码</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {need2fa && (
          <>
            <div className="field">
              <label>两步验证码</label>
              <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6 位动态码" inputMode="numeric" autoFocus />
            </div>
            <div className="field checkbox-inline">
              <input type="checkbox" id="trust" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
              <label htmlFor="trust" style={{ margin: 0 }}>信任此设备（60 天内免验证）</label>
            </div>
          </>
        )}
        {err && <div className="badge red" style={{ display: 'block', marginBottom: 12, padding: 8 }}>{err}</div>}
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
          {loading ? <span className="spin" /> : (need2fa ? '验证并登录' : '登录')}
        </button>
      </form>
    </div>
  );
}
