import net from 'node:net';

// TCP-connect latency to a node's server:port (ms). Returns -1 on failure.
export function tcpPing(host, port, timeout = 5000) {
  return new Promise((resolve) => {
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

// check many nodes with limited concurrency
export async function pingNodes(nodes, concurrency = 20) {
  const results = new Array(nodes.length);
  let i = 0;
  async function worker() {
    while (i < nodes.length) {
      const idx = i++;
      const n = nodes[idx];
      results[idx] = { id: n.id, latency: await tcpPing(n.server, n.port) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, nodes.length) }, worker));
  return results;
}
