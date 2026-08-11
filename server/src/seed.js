import { db } from './db.js';

// Seed a few starter subscription templates on first run.
export function seedTemplates() {
  const count = db.prepare('SELECT COUNT(*) n FROM templates').get().n;
  if (count > 0) return;

  const now = Date.now();
  const ins = db.prepare(
    'INSERT INTO templates (name, client_type, content, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?)'
  );

  const clashTpl = `# ApRID 默认 Clash.Meta 模板
mixed-port: 7890
allow-lan: true
mode: rule
log-level: info
dns:
  enable: true
  nameserver:
    - 223.5.5.5
    - 8.8.8.8
proxies: []
proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
      - ♻️ 自动选择
      - <PROXIES>
  - name: ♻️ 自动选择
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    proxies:
      - <PROXIES>
rules:
  - GEOIP,CN,DIRECT
  - MATCH,🚀 节点选择
`;

  ins.run('默认 Clash.Meta', 'clash', clashTpl, 1, now, now);
  ins.run('默认 Base64 (v2rayN/Shadowrocket)', 'base64', '', 1, now, now);
  ins.run('默认 sing-box', 'singbox', '', 1, now, now);

  console.log('[init] seeded default subscription templates');
}
