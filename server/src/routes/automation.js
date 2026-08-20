import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { runAirportReset, runAllAirportResets, runTrafficStats, runAlertCheck, runLatencyCheck, runUserPullAll, runTrafficReset, runProbeCheck, runZombieCleanup } from '../services/automation.js';
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
        key: 'latency',
        name: '节点延迟检测',
        last: last('latency'),
        manual: true,
        autoTriggers: [],
        schedule: schedules.latency,
        scheduleText: describeSchedule(schedules.latency),
      },
      {
        key: 'probe',
        name: '真实可用性检测',
        last: last('probe'),
        manual: true,
        autoTriggers: [
          '通过 sing-box 实连测试 URL，验证节点是否真能代理（不止端口连通）；按机场范围（不选=全部）',
        ],
        schedule: schedules.probe,
        scheduleText: describeSchedule(schedules.probe),
      },
      {
        key: 'zombie_cleanup',
        name: '僵尸用户清理',
        last: last('zombie_cleanup'),
        manual: true,
        autoTriggers: [
          '用户到期后 N 天自动停用（释放机场账户槽/停止后台处理）、M 天自动删除（回收 token）；阈值 0=关闭该动作',
        ],
        schedule: schedules.zombie_cleanup,
        scheduleText: describeSchedule(schedules.zombie_cleanup),
      },
      {
        key: 'traffic_reset',
        name: '用户流量月度重置',
        last: last('traffic_reset'),
        manual: true,
        autoTriggers: [
          '每日清扫：给「每月重置日」= 今天的用户把已用流量清零（月末自动裁剪，如 31 号在 2 月按 28/29 号）',
          '每个用户的重置日在「用户 · 编辑」里设置；也可在用户列表对单个用户「重置流量」',
        ],
        schedule: schedules.traffic_reset,
        scheduleText: describeSchedule(schedules.traffic_reset),
      },
      {
        key: 'alerts',
        name: '到期/超限告警',
        last: last('alerts'),
        manual: true,
        autoTriggers: [
          '用户流量超限 → 流量统计时就地发送用户端告警（含免登录回填链接）',
          '机场用量≥97% → 拉取机场时就地发送机场端告警（含免登录拉取按钮）',
          '用户到期 / 即将到期(≤1天,提醒续费) / 机场到期≤1天 → 按下方 Cron 定时扫描发送',
        ],
        schedule: schedules.alerts,
        scheduleText: describeSchedule(schedules.alerts),
      },
      {
        key: 'user_pull',
        name: '用户触发机场拉取',
        last: last('user_pull'),
        manual: true,
        autoTriggers: [
          '用户拉取面板订阅 → 面板拉取其下发机场订阅（每机场滚动1小时最多一次）',
        ],
        schedule: null,
        scheduleText: '由用户拉取订阅事件触发（可手动为全部用户运行一次）',
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

// Run "节点延迟检测" for the given airports (empty/omitted = all nodes).
router.post('/latency', async (req, res) => {
  try {
    const airports = Array.isArray(req.body?.airports) ? req.body.airports : [];
    const r = await runLatencyCheck(airports, { cleanup: !!req.body?.cleanup });
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message, taskId: err.taskId });
  }
});

// Run "真实可用性检测" for the given airports (empty/omitted = all nodes).
router.post('/probe', async (req, res) => {
  try {
    const airports = Array.isArray(req.body?.airports) ? req.body.airports : [];
    const r = await runProbeCheck(airports);
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message, taskId: err.taskId });
  }
});

// Run "僵尸用户清理" now using the configured thresholds (records a task even if
// nothing is due).
router.post('/zombie-cleanup', async (req, res) => {
  try {
    const s = getSchedules().zombie_cleanup;
    const r = await runZombieCleanup({ disableDays: s.disableDays, deleteDays: s.deleteDays, recordEmpty: true });
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message, taskId: err.taskId });
  }
});

// Run "用户流量月度重置" sweep now (only users whose reset-day is today; records a
// task even if nothing is due).
router.post('/traffic-reset', async (req, res) => {
  try {
    const r = await runTrafficReset({ recordEmpty: true });
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message, taskId: err.taskId });
  }
});

// Run "用户触发机场拉取" manually for all enabled users (bypasses the 1h window).
router.post('/user-pull', async (req, res) => {
  try {
    const r = await runUserPullAll();
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message, taskId: err.taskId });
  }
});

export default router;
