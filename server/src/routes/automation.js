import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { runAirportReset, runAllAirportResets, runTrafficStats, runAlertCheck } from '../services/automation.js';
import { testAirportConnection } from '../services/airport/adapters.js';
import { getSchedules, setSchedules, describeSchedule } from '../services/scheduler.js';

const router = express.Router();
router.use(requireAuth);

// Overview of automations + their most recent task, so the UI can render状态/进度.
router.get('/', (req, res) => {
  const last = (type) => db.prepare('SELECT * FROM tasks WHERE type = ? ORDER BY id DESC LIMIT 1').get(type);
  const airports = db.prepare('SELECT id, name, group_name, account, sub_url, last_fetch_at FROM airports ORDER BY id DESC').all();
  const schedules = getSchedules();
  res.json({
    automations: [
      {
        key: 'airport_reset',
        name: '机场订阅自动重置',
        last: last('airport_reset'),
        // Explicit trigger conditions surfaced on the panel:
        manual: true,
        autoTriggers: [
          '用户点击「重置订阅」时，自动重置该用户下发的所有机场',
          '用户到期后重置订阅时同样自动触发',
        ],
        schedule: schedules.airport_reset,
        scheduleText: describeSchedule(schedules.airport_reset),
      },
      {
        key: 'traffic_stats',
        name: '用户流量统计',
        last: last('traffic_stats'),
        manual: true,
        autoTriggers: [],
        schedule: schedules.traffic_stats,
        scheduleText: describeSchedule(schedules.traffic_stats),
      },
      {
        key: 'alerts',
        name: '到期/超限告警',
        last: last('alerts'),
        manual: true,
        autoTriggers: [
          '用户到期或流量超限 → 发送用户端告警（含免登录回填链接）',
          '机场用量≥99% 或到期≤1天 → 发送机场端告警（含免登录拉取按钮）',
        ],
        schedule: schedules.alerts,
        scheduleText: describeSchedule(schedules.alerts),
      },
    ],
    airports,
  });
});

// Read / update the定时任务 config for all automations.
router.get('/schedule', (req, res) => res.json({ schedules: getSchedules() }));
router.put('/schedule', (req, res) => {
  const schedules = setSchedules(req.body?.schedules || {});
  res.json({ ok: true, schedules });
});

// Dry-run connection test: verify an airport's credentials/token work without
// resetting anything.
router.post('/test-reset', async (req, res) => {
  const id = Number(req.body?.airportId);
  const ap = db.prepare('SELECT * FROM airports WHERE id = ?').get(id);
  if (!ap) return res.status(404).json({ error: '机场不存在' });
  try {
    const r = await testAirportConnection(ap);
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Run "机场订阅自动重置": one airport, or all when no id supplied.
router.post('/airport-reset', async (req, res) => {
  const id = req.body?.airportId;
  try {
    if (id) {
      const r = await runAirportReset(Number(id));
      return res.json({ ok: true, ...r });
    }
    const results = await runAllAirportResets();
    res.json({ ok: true, results });
  } catch (err) {
    res.status(400).json({ error: err.message, taskId: err.taskId });
  }
});

// Run "用户流量统计".
router.post('/traffic-stats', async (req, res) => {
  try {
    const r = await runTrafficStats({ refetch: req.body?.refetch !== false });
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message, taskId: err.taskId });
  }
});

// Run "到期/超限告警".
router.post('/alerts', async (req, res) => {
  try {
    const r = await runAlertCheck();
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message, taskId: err.taskId });
  }
});

export default router;
