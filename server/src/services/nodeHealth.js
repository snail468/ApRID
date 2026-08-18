// Node health: latency history, availability stats, and the "good node first"
// score used when assembling a subscription.
//
// Latency is a property of the physical endpoint (server:port), so history in
// node_checks is keyed by endpoint — one row per endpoint per run, shared by
// every duplicate node across airports/accounts. The ping sweep dedupes by
// endpoint (each measured at most once) and fans the reading out to all nodes
// sharing it. See planLatencyChecks() in nodeProcess.js.

import { db } from '../db.js';
import { orderByHealth, planLatencyChecks, endpointKey } from './nodeProcess.js';
import { pingNodes } from './latency.js';

// keep this much history; older rows are pruned on each write so the table
// doesn't grow without bound.
const RETENTION_DAYS = 30;

// Ping a set of node rows, deduped by endpoint. Each unique server:port is
// measured at most once (or reused if fresh), then the reading is written back to
// EVERY node row sharing that endpoint, and ONE node_checks history row is
// appended per endpoint actually measured. Avoids re-detecting the same physical
// server that several accounts imported.
//   rows: [{ id, server, port, latency, latency_at }]
// Returns { perNode:[{id,latency}], total, endpoints, measured, reused, at }.
export async function pingDedupAndRecord(rows, { concurrency = 20, freshMinutes = 0 } = {}) {
  const now = Date.now();
  const freshMs = freshMinutes > 0 ? freshMinutes * 60000 : 0;
  const { groups, toMeasure, reused } = planLatencyChecks(rows, { now, freshMs });

  // measure each unique endpoint once (aligned to toMeasure by index)
  const measured = await pingNodes(toMeasure, concurrency);
  const latByKey = new Map();
  measured.forEach((m, i) => latByKey.set(toMeasure[i].key, m.latency));
  for (const { key, latency } of reused) latByKey.set(key, latency);

  const updNode = db.prepare('UPDATE nodes SET latency = ?, latency_at = ? WHERE id = ?');
  const insHist = db.prepare('INSERT INTO node_checks (server, port, latency, ts) VALUES (?,?,?,?)');
  const perNode = [];
  db.transaction(() => {
    // fan the endpoint's reading out to every node sharing it
    for (const [key, g] of groups) {
      const latency = latByKey.get(key);
      for (const id of g.ids) { updNode.run(latency, now, id); perNode.push({ id, latency }); }
    }
    // history: one row per endpoint we actually (re)measured this run
    for (const { key, server, port } of toMeasure) insHist.run(server, port, latByKey.get(key), now);
    db.prepare('DELETE FROM node_checks WHERE ts < ?').run(now - RETENTION_DAYS * 86400000);
  })();

  return { perNode, total: rows.length, endpoints: groups.size, measured: toMeasure.length, reused: reused.length, at: now };
}

// Per-endpoint availability + latency aggregate over a trailing window, keyed by
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
    map.set(endpointKey(r.server, r.port), {
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

// Latency samples for one endpoint over `days`, oldest first (for the trend curve).
export function getNodeHistory(server, port, days = 7) {
  const since = Date.now() - days * 86400000;
  return db.prepare(
    'SELECT latency, ts FROM node_checks WHERE server = ? AND port = ? AND ts >= ? ORDER BY ts'
  ).all(server, port, since);
}

// Most recent measured latency per endpoint across ALL nodes — used to seed a
// freshly imported node (e.g. the same server pulled by another account) with a
// latency already measured elsewhere, so it needs no extra detection.
export function latestLatencyByEndpoint() {
  const rows = db.prepare(
    'SELECT server, port, latency, latency_at FROM nodes WHERE latency IS NOT NULL AND latency_at IS NOT NULL'
  ).all();
  const map = new Map();
  for (const r of rows) {
    const k = endpointKey(r.server, r.port);
    const cur = map.get(k);
    if (!cur || r.latency_at > cur.latency_at) map.set(k, { latency: r.latency, latency_at: r.latency_at });
  }
  return map;
}
