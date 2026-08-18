import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { API } from './api.js';
import { useToast } from './ui.jsx';
import { useTheme } from './theme.js';
import { prefetch } from './store.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Airports from './pages/Airports.jsx';
import Nodes from './pages/Nodes.jsx';
import Users from './pages/Users.jsx';
import Templates from './pages/Templates.jsx';
import Automation from './pages/Automation.jsx';
import Audit from './pages/Audit.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  { to: '/', label: '仪表盘', icon: '📊', end: true },
  { to: '/airports', label: '机场管理', icon: '✈️' },
  { to: '/nodes', label: '节点管理', icon: '🔗' },
  { to: '/users', label: '用户', icon: '👥' },
  { to: '/templates', label: '订阅模板', icon: '📝' },
  { to: '/automation', label: '自动化', icon: '🤖' },
  { to: '/audit', label: '操作审计', icon: '🛡️' },
  { to: '/settings', label: '设置', icon: '⚙️' },
];

// warm the caches used across pages so the first click into each is instant
function warmCaches() {
  prefetch([
    ['airports', () => API.airports()],
    ['users', () => API.users()],
    ['templates', () => API.templates()],
    ['nodes:', () => API.nodes()],
    ['stats', () => API.stats()],
  ]);
}

export default function App() {
  const [auth, setAuth] = useState(undefined); // undefined=loading, null=logged out, {user}
  const toast = useToast();

  useEffect(() => {
    API.me().then((me) => { setAuth(me); warmCaches(); }).catch(() => setAuth(null));
  }, []);

  if (auth === undefined) {
    return <div className="login-wrap"><span className="spin" /></div>;
  }
  if (!auth) {
    return <Login onLogin={(me) => { setAuth(me); warmCaches(); }} />;
  }
  return <Shell auth={auth} onLogout={() => setAuth(null)} toast={toast} />;
}

function Shell({ auth, onLogout, toast }) {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
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
          <button className="btn sm theme-toggle" onClick={toggle} title="切换主题">
            {theme === 'dark' ? '☀️ 白天' : '🌙 黑夜'}
          </button>
          <div className="small muted user-chip">👤 {auth.user}</div>
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
          <Route path="/automation" element={<Automation toast={toast} />} />
          <Route path="/audit" element={<Audit toast={toast} />} />
          <Route path="/settings" element={<Settings toast={toast} onAccountChange={onLogout} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
