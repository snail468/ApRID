// Node health: latency history, availability stats, and the "good node first"
// score used when assembling a subscription.
//
// History lives in node_checks, keyed by (airport_id, server, port) so it
// survives the delete+reinsert that airport refetch does (see fetch.js). Every
// latency run (manual button or the 延迟检测 automation) appends one row per node
// AND updates the live nodes.latency, both through recordLatencyResults so the
// two paths never drift.

import { db } from '../db.js';
import { orderByHealth } from './nodeProcess.js';

// keep this much history; older rows are pruned on each write so the table
// doesn't grow without bound.
const RETENTION_DAYS = 30;

// Persist a batch of latency results.
//   rows    : [{ id, airport_id, server, port }]  (the nodes that were pinged)
//   results : [{ id, latency }]                    (aligned by node id)
// Updates nodes.latency/latency_at for the live table and appends a node_checks
// history row per result. Returns the timestamp used.
export function recordLatencyResults(rows, results) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const now = Date.now();
  const upd = db.prepare('UPDATE nodes SET latency = ?, latency_at = ? WHERE id = ?');
  const ins = db.prepare(
    'INSERT INTO node_checks (airport_id, server, port, latency, ts) VALUES (?,?,?,?,?)'
  );
  db.transaction(() => {
    for (const r of results) {
      upd.run(r.latency, now, r.id);
      const row = byId.get(r.id);
      if (row) ins.run(row.airport_id ?? null, row.server, row.port, r.latency, now);
    }
    db.prepare('DELETE FROM node_checks WHERE ts < ?').run(now - RETENTION_DAYS * 86400000);
  })();
  return now;
}

// Per-node availability + latency aggregate over a trailing window, keyed by
// `${server}:${port}`. uptime = successful checks / total checks (0..1).
export function getNodeStatsMap(windowDays = 7) {
  const since = Date.now() - windowDays * 86400000;
  const rows = db.prepare(`
    SELECT server, port,
           COUNT(*)                                    AS total,
           SUM(CASE WHEN latency >= 0 THEN 1 ELSE 0 END) AS ok,
           AVG(CASE WHEN latency >= 0 THEN latency END)  AS avg_latency
      FROM node_checks
     WHERE ts >= ?
     GROUP BY server, port
  `).all(since);
  const map = new Map();
  for (const r of rows) {
    map.set(`${r.server}:${r.port}`, {
      total: r.total,
      ok: r.ok,
      uptime: r.total ? r.ok / r.total : null,
      avgLatency: r.avg_latency != null ? Math.round(r.avg_latency) : null,
    });
  }
  return map;
}

// Stable "good nodes first" ordering for a node list (server/port/latency each).
// Scoring lives in nodeProcess (pure/testable); this just supplies the stats map.
export function sortNodesByHealth(nodes, windowDays = 7) {
  return orderByHealth(nodes, getNodeStatsMap(windowDays));
}

// Latency samples for one node key over `days`, oldest first (for the trend curve).
export function getNodeHistory(airportId, server, port, days = 7) {
  const since = Date.now() - days * 86400000;
  return db.prepare(
    'SELECT latency, ts FROM node_checks WHERE airport_id = ? AND server = ? AND port = ? AND ts >= ? ORDER BY ts'
  ).all(airportId, server, port, since);
}
