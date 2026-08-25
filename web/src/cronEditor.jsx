import { useState, useEffect } from 'react';

// 交互式 Cron 编辑器（北京时间）。在「自动化」各标签页与「设置 · 异地备份」共用。
// schedule: { enabled, cron }；onSave({ enabled, cron }) 回调保存。
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// best-effort parse of a cron string back into the builder's structured state
export function parseCronToState(cron) {
  const parts = String(cron || '').trim().split(/\s+/);
  const base = { mode: 'daily', minute: 0, hour: 3, everyN: 2, weekday: 1, monthday: 1, custom: cron || '0 3 * * *' };
  if (parts.length !== 5) return { ...base, mode: 'custom' };
  const [mi, h, dom, mon, dow] = parts;
  const num = (s) => /^\d+$/.test(s);
  if (h === '*' && dom === '*' && mon === '*' && dow === '*' && num(mi)) return { ...base, mode: 'hourly', minute: +mi };
  if (dom === '*' && mon === '*' && dow === '*' && mi === '0' && /^\*\/\d+$/.test(h)) return { ...base, mode: 'everyN', everyN: +h.slice(2) };
  if (dom === '*' && mon === '*' && dow === '*' && num(mi) && num(h)) return { ...base, mode: 'daily', minute: +mi, hour: +h };
  if (dom === '*' && mon === '*' && num(mi) && num(h) && num(dow)) return { ...base, mode: 'weekly', minute: +mi, hour: +h, weekday: +dow };
  if (mon === '*' && dow === '*' && num(mi) && num(h) && num(dom)) return { ...base, mode: 'monthly', minute: +mi, hour: +h, monthday: +dom };
  return { ...base, mode: 'custom' };
}

export function buildCron(s) {
  const mi = clamp(s.minute, 0, 59), h = clamp(s.hour, 0, 23);
  switch (s.mode) {
    case 'hourly': return `${mi} * * * *`;
    case 'everyN': return `0 */${clamp(s.everyN, 1, 23)} * * *`;
    case 'daily': return `${mi} ${h} * * *`;
    case 'weekly': return `${mi} ${h} * * ${clamp(s.weekday, 0, 6)}`;
    case 'monthly': return `${mi} ${h} ${clamp(s.monthday, 1, 31)} * *`;
    default: return (s.custom || '').trim();
  }
}
function clamp(v, lo, hi) { const n = Math.round(Number(v)); return Number.isNaN(n) ? lo : Math.min(hi, Math.max(lo, n)); }
const pad = (n) => String(n).padStart(2, '0');

function describe(s) {
  const mi = clamp(s.minute, 0, 59), h = clamp(s.hour, 0, 23);
  switch (s.mode) {
    case 'hourly': return `每小时第 ${mi} 分`;
    case 'everyN': return `每 ${clamp(s.everyN, 1, 23)} 小时`;
    case 'daily': return `每天 ${pad(h)}:${pad(mi)}`;
    case 'weekly': return `每${WEEK[clamp(s.weekday, 0, 6)]} ${pad(h)}:${pad(mi)}`;
    case 'monthly': return `每月 ${clamp(s.monthday, 1, 31)} 日 ${pad(h)}:${pad(mi)}`;
    default: return `自定义：${(s.custom || '').trim() || '（空）'}`;
  }
}

export function CronEditor({ schedule, onSave }) {
  const [enabled, setEnabled] = useState(false);
  const [st, setSt] = useState(null);

  useEffect(() => {
    if (!schedule) return;
    setEnabled(!!schedule.enabled);
    setSt(parseCronToState(schedule.cron));
  }, [schedule?.enabled, schedule?.cron]);

  if (!st) return null;
  const set = (k, v) => setSt((c) => ({ ...c, [k]: v }));
  const cron = buildCron(st);

  return (
    <div className="schedule-editor">
      <label className="checkbox-inline">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>开启定时任务（北京时间）</span>
      </label>
      {enabled && (
        <>
          <div className="schedule-row">
            <select value={st.mode} onChange={(e) => set('mode', e.target.value)}>
              <option value="hourly">每小时</option>
              <option value="everyN">每 N 小时</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
              <option value="custom">自定义 Cron</option>
            </select>

            {st.mode === 'hourly' && (
              <span className="schedule-inline">第 <input type="number" min="0" max="59" value={st.minute} onChange={(e) => set('minute', e.target.value)} /> 分</span>
            )}
            {st.mode === 'everyN' && (
              <span className="schedule-inline">每 <input type="number" min="1" max="23" value={st.everyN} onChange={(e) => set('everyN', e.target.value)} /> 小时</span>
            )}
            {(st.mode === 'daily' || st.mode === 'weekly' || st.mode === 'monthly') && (
              <span className="schedule-inline">
                {st.mode === 'weekly' && (
                  <select value={st.weekday} onChange={(e) => set('weekday', e.target.value)}>
                    {WEEK.map((w, i) => <option key={i} value={i}>{w}</option>)}
                  </select>
                )}
                {st.mode === 'monthly' && (
                  <><input type="number" min="1" max="31" value={st.monthday} onChange={(e) => set('monthday', e.target.value)} /> 日</>
                )}
                <input type="number" min="0" max="23" value={st.hour} onChange={(e) => set('hour', e.target.value)} />
                <span>:</span>
                <input type="number" min="0" max="59" value={st.minute} onChange={(e) => set('minute', e.target.value)} />
              </span>
            )}
            {st.mode === 'custom' && (
              <input style={{ width: 180 }} className="mono" value={st.custom} placeholder="分 时 日 月 周"
                onChange={(e) => set('custom', e.target.value)} />
            )}
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>{describe(st)} · <code>{cron || '（空）'}</code></div>
        </>
      )}
      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => onSave({ enabled, cron })}>保存定时</button>
    </div>
  );
}
