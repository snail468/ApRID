// Real node-availability probe. Unlike the TCP-handshake latency check (which
// only proves the port is open), this dials each node *through* a sing-box core
// and fetches a test URL via the clash-API delay endpoint — so it verifies the
// proxy actually works end-to-end. Needs the sing-box binary (config.singboxPath;
// bundled in the Docker image); degrades gracefully when it's absent.
//
// buildProbeConfig / parseDelayResult / nodeSignature are pure and unit-tested;
// the spawn/HTTP orchestration is a thin wrapper around them.

import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from '../db.js';
import { config } from '../config.js';
import { nodeToSingbox } from './subscription/converters.js';
import { nodeSignature, buildProbeConfig, parseDelayResult } from './probeFormat.js';

export { nodeSignature, buildProbeConfig, parseDelayResult };

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function httpGetJson(url, timeout = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } finally { clearTimeout(t); }
}

// Poll the clash API until it answers (sing-box has finished starting) or we give up.
async function waitClashReady(clashPort, deadline) {
  while (Date.now() < deadline) {
    try {
      const { status } = await httpGetJson(`http://127.0.0.1:${clashPort}/version`, 1000);
      if (status === 200) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// Run limited-concurrency async tasks.
async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let i = 0;
  const run = async () => { while (i < items.length) { const idx = i++; results[idx] = await worker(items[idx], idx); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

// Probe rows [{id, name, type, server, port, raw}] through sing-box. Dedupes by
// full node signature (identical configs tested once) then fans the verdict out
// to every node sharing it. Writes nodes.alive / alive_ms / alive_at.
// Throws with a clear message when sing-box isn't available.
export async function probeNodes(rows, { concurrency = 10, timeout = config.probeTimeout, testUrl = config.probeTestUrl } = {}) {
  // group identical node configs
  const groups = new Map(); // sig -> { node, ids:[], tag }
  let seq = 0;
  for (const r of rows) {
    const sig = nodeSignature(r);
    let g = groups.get(sig);
    if (!g) { g = { node: r, ids: [], tag: `p${seq++}` }; groups.set(sig, g); }
    g.ids.push(r.id);
  }
  const items = [...groups.values()].filter((g) => nodeToSingbox({ ...g.node, name: g.tag }));
  const untestable = groups.size - items.length; // protocols sing-box can't build

  if (!items.length) {
    return { total: rows.length, tested: 0, alive: 0, dead: 0, untestable, ok: true };
  }

  const clashPort = await getFreePort();
  const cfg = buildProbeConfig(items, clashPort);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aprid-probe-'));
  const cfgPath = path.join(dir, 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));

  let child;
  try {
    child = spawn(config.singboxPath, ['run', '-c', cfgPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`无法启动 sing-box（${config.singboxPath}）：${err.message}。请安装 sing-box 或设置 SINGBOX_PATH。`);
  }
  let stderr = '';
  child.stderr?.on('data', (d) => { stderr += d.toString(); });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const spawnFailed = new Promise((resolve) => child.on('error', (e) => resolve(e)));

  try {
    // fail fast if the binary is missing (spawn 'error' fires async)
    const early = await Promise.race([
      waitClashReady(clashPort, Date.now() + 6000).then((r) => ({ ready: r })),
      spawnFailed.then((e) => ({ error: e })),
    ]);
    if (early.error) {
      throw new Error(`无法启动 sing-box（${config.singboxPath}）：${early.error.message}。请安装 sing-box 或设置 SINGBOX_PATH。`);
    }
    if (!early.ready) {
      throw new Error(`sing-box 未能就绪。${stderr.trim().split('\n').slice(-2).join(' ') || '请检查 sing-box 版本与配置。'}`);
    }

    const delayUrl = (tag) =>
      `http://127.0.0.1:${clashPort}/proxies/${encodeURIComponent(tag)}/delay?timeout=${timeout}&url=${encodeURIComponent(testUrl)}`;
    const verdicts = await pool(items, concurrency, async (g) => {
      try {
        const { status, body } = await httpGetJson(delayUrl(g.tag), timeout + 2000);
        return { g, ...parseDelayResult(status, body) };
      } catch (err) {
        return { g, ok: false, ms: -1, error: err.message };
      }
    });

    // persist: fan each verdict out to all node ids sharing the config
    const now = Date.now();
    const upd = db.prepare('UPDATE nodes SET alive = ?, alive_ms = ?, alive_at = ? WHERE id = ?');
    let alive = 0, dead = 0;
    db.transaction(() => {
      for (const v of verdicts) {
        const okv = v.ok ? 1 : 0;
        const ms = v.ok ? v.ms : -1;
        for (const id of v.g.ids) upd.run(okv, ms, now, id);
        if (v.ok) alive += v.g.ids.length; else dead += v.g.ids.length;
      }
    })();

    return { total: rows.length, tested: items.length, endpointsTested: items.length, alive, dead, untestable, ok: true };
  } finally {
    try { child.kill('SIGKILL'); } catch { /* noop */ }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 1500))]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function singboxConfigured() {
  return !!config.singboxPath;
}
