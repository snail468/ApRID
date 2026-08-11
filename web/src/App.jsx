import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { API } from './api.js';
import { useToast } from './ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Airports from './pages/Airports.jsx';
import Nodes from './pages/Nodes.jsx';
import Users from './pages/Users.jsx';
import Templates from './pages/Templates.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  { to: '/', label: '仪表盘', icon: '📊', end: true },
  { to: '/airports', label: '机场管理', icon: '✈️' },
  { to: '/nodes', label: '节点管理', icon: '🔗' },
  { to: '/users', label: '用户', icon: '👥' },
  { to: '/templates', label: '订阅模板', icon: '📝' },
  { to: '/settings', label: '设置', icon: '⚙️' },
];

export default function App() {
  const [auth, setAuth] = useState(undefined); // undefined=loading, null=logged out, {user}
  const toast = useToast();

  useEffect(() => {
    API.me().then(setAuth).catch(() => setAuth(null));
  }, []);

  if (auth === undefined) {
    return <div className="login-wrap"><span className="spin" /></div>;
  }
  if (!auth) {
    return <Login onLogin={(me) => setAuth(me)} />;
  }
  return <Shell auth={auth} onLogout={() => setAuth(null)} toast={toast} />;
}

function Shell({ auth, onLogout, toast }) {
  const navigate = useNavigate();
  const logout = async () => {
    await API.logout().catch(() => {});
    onLogout();
    navigate('/');
  };
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">✈️ ApRID</div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => (isActive ? 'active' : '')}>
              <span>{n.icon}</span> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="small muted" style={{ marginBottom: 8 }}>👤 {auth.user}</div>
          <button className="btn sm" onClick={logout}>退出登录</button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard toast={toast} />} />
          <Route path="/airports" element={<Airports toast={toast} />} />
          <Route path="/nodes" element={<Nodes toast={toast} />} />
          <Route path="/users" element={<Users toast={toast} />} />
          <Route path="/templates" element={<Templates toast={toast} />} />
          <Route path="/settings" element={<Settings toast={toast} onAccountChange={onLogout} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
