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
import { nodeSignature, buildProbeConfig, parseDelayResult, parseUnknownOutboundTypes } from './probeFormat.js';

export { nodeSignature, buildProbeConfig, parseDelayResult, parseUnknownOutboundTypes };

// Outbound types the installed sing-box build has rejected in this process, so we
// can pre-drop them on later runs without paying a failing `check` each time.
// (e.g. 'anytls' when the bundled core is <1.12.) Cleared only on restart.
const unsupportedTypes = new Set();

// The sing-box outbound type a node maps to (ss -> 'shadowsocks', etc.), or null.
function singboxType(node) {
  const ob = nodeToSingbox(node);
  return ob ? ob.type : null;
}

// Run `sing-box check -c <cfg>` and report whether the config parses, capturing
// stderr so the caller can learn which outbound types are unknown. Never throws.
function runSingboxCheck(cfgPath) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(config.singboxPath, ['check', '-c', cfgPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, spawnError: err, stderr: '' });
      return;
    }
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => resolve({ ok: false, spawnError: err, stderr }));
    child.on('exit', (code) => resolve({ ok: code === 0, stderr }));
  });
}

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
  let items = [...groups.values()].filter((g) => nodeToSingbox({ ...g.node, name: g.tag }));
  let untestable = groups.size - items.length; // protocols this codebase can't build
  // pre-drop types a previous run already learned this sing-box build rejects
  if (unsupportedTypes.size) {
    const before = items.length;
    items = items.filter((g) => !unsupportedTypes.has(singboxType(g.node)));
    untestable += before - items.length;
  }

  if (!items.length) {
    return { total: rows.length, tested: 0, alive: 0, dead: 0, untestable, ok: true, unsupported: [...unsupportedTypes] };
  }

  const clashPort = await getFreePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aprid-probe-'));
  const cfgPath = path.join(dir, 'config.json');

  // Preflight: sing-box aborts the *entire* config on the first outbound type it
  // doesn't recognise, so a single anytls node on an old core would fail every
  // node. Iteratively `check` and strip unknown types (one distinct type surfaces
  // per pass) so the rest still get probed; the dropped ones count as untestable.
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      fs.writeFileSync(cfgPath, JSON.stringify(buildProbeConfig(items, clashPort)));
      const chk = await runSingboxCheck(cfgPath);
      if (chk.spawnError) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw new Error(`无法启动 sing-box（${config.singboxPath}）：${chk.spawnError.message}。请安装 sing-box 或设置 SINGBOX_PATH。`);
      }
      if (chk.ok) break;
      const bad = parseUnknownOutboundTypes(chk.stderr);
      if (!bad.length) break; // some other error — let the real run surface it
      for (const t of bad) unsupportedTypes.add(t);
      const before = items.length;
      items = items.filter((g) => !bad.includes(singboxType(g.node)));
      untestable += before - items.length;
      if (!items.length) {
        fs.rmSync(dir, { recursive: true, force: true });
        return { total: rows.length, tested: 0, alive: 0, dead: 0, untestable, ok: true, unsupported: [...unsupportedTypes] };
      }
    }
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }

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

    return { total: rows.length, tested: items.length, endpointsTested: items.length, alive, dead, untestable, ok: true, unsupported: [...unsupportedTypes] };
  } finally {
    try { child.kill('SIGKILL'); } catch { /* noop */ }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 1500))]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function singboxConfigured() {
  return !!config.singboxPath;
}
