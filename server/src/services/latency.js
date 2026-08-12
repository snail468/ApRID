import net from 'node:net';

// Real TCP-handshake latency to a node's server:port (ms) — measures the actual
// round-trip time to open a connection, i.e. the true network delay to the node.
// Returns -1 on timeout/failure (unreachable node).
export function tcpPing(host, port, timeout = 5000) {
  return new Promise((resolve) => {
    if (!host || !port) return resolve(-1);
    const start = Date.now();
    const sock = new net.Socket();
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(val);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(Date.now() - start));
    sock.once('timeout', () => finish(-1));
    sock.once('error', () => finish(-1));
    sock.connect(port, host);
  });
}

// Best-of-N TCP handshakes so a single lost packet doesn't skew the reading.
// Returns the minimum successful RTT, or -1 if every attempt failed.
export async function measureLatency(host, port, { attempts = 2, timeout = 5000 } = {}) {
  let best = -1;
  for (let i = 0; i < attempts; i++) {
    const ms = await tcpPing(host, port, timeout);
    if (ms >= 0 && (best < 0 || ms < best)) best = ms;
  }
  return best;
}

// check many nodes with limited concurrency
export async function pingNodes(nodes, concurrency = 20) {
  const results = new Array(nodes.length);
  let i = 0;
  async function worker() {
    while (i < nodes.length) {
      const idx = i++;
      const n = nodes[idx];
      results[idx] = { id: n.id, latency: await measureLatency(n.server, n.port) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, nodes.length) }, worker));
  return results;
}
