import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { seedAdmin } from './db.js';
import { seedTemplates } from './seed.js';

import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import airportRoutes from './routes/airports.js';
import nodeRoutes from './routes/nodes.js';
import userRoutes from './routes/users.js';
import templateRoutes from './routes/templates.js';
import taskRoutes from './routes/tasks.js';
import statsRoutes from './routes/stats.js';
import subRoutes from './routes/sub.js';

seedAdmin();
seedTemplates();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// health check (used by docker healthcheck)
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// public subscription endpoint (no auth)
app.use('/sub', subRoutes);

// admin API
app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/airports', airportRoutes);
app.use('/api/nodes', nodeRoutes);
app.use('/api/users', userRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/stats', statsRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'API not found' }));

// serve built frontend (production) with SPA fallback
if (fs.existsSync(config.publicDir)) {
  app.use(express.static(config.publicDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) =>
    res.send('<h1>ApRID</h1><p>后端运行中。前端未构建（开发模式请访问 Vite 端口）。</p>'));
}

// error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || '服务器错误' });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n  ApRID 面板已启动: http://0.0.0.0:${config.port}`);
  console.log(`  数据库: ${config.dbPath}\n`);
});
