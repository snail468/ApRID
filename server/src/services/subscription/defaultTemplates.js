// Built-in default subscription templates, one per client family.
//
// Placeholders resolved at build time by converters.js:
//   <PROXIES>      -> the list of node entries (client-native syntax)
//   <PROXY_NAMES>  -> comma-joined node names (Surge / Loon / QuantumultX)
// Clash / sing-box also auto-inject the `proxies` / `outbounds` blocks and swap
// every `<PROXIES>` placeholder inside selector groups for the node names.

export const CLASH_META = `# ApRID 默认 Clash.Meta 模板
mixed-port: 7890
allow-lan: true
mode: rule
log-level: info
ipv6: false
external-controller: 127.0.0.1:9090
unified-delay: true
tcp-concurrent: true
profile:
  store-selected: true
  store-fake-ip: true
dns:
  enable: true
  ipv6: false
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - 223.5.5.5
    - 119.29.29.29
  fallback:
    - https://1.1.1.1/dns-query
    - https://dns.google/dns-query
proxies: []
proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
      - ♻️ 自动选择
      - 🎯 全球直连
      - <PROXIES>
  - name: ♻️ 自动选择
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    proxies:
      - <PROXIES>
  - name: 💬 AI 平台
    type: select
    proxies:
      - 🚀 节点选择
      - ♻️ 自动选择
      - 🎯 全球直连
      - <PROXIES>
  - name: 📲 电报信息
    type: select
    proxies:
      - 🚀 节点选择
      - 🎯 全球直连
      - <PROXIES>
  - name: 🌍 国外媒体
    type: select
    proxies:
      - 🚀 节点选择
      - ♻️ 自动选择
      - 🎯 全球直连
      - <PROXIES>
  - name: 🎯 全球直连
    type: select
    proxies:
      - DIRECT
      - 🚀 节点选择
  - name: 🛑 全球拦截
    type: select
    proxies:
      - REJECT
      - DIRECT
  - name: 🐟 漏网之鱼
    type: select
    proxies:
      - 🚀 节点选择
      - 🎯 全球直连
      - ♻️ 自动选择
      - <PROXIES>
rules:
  - GEOSITE,category-ads-all,🛑 全球拦截
  - GEOSITE,openai,💬 AI 平台
  - GEOSITE,anthropic,💬 AI 平台
  - GEOSITE,telegram,📲 电报信息
  - GEOSITE,youtube,🌍 国外媒体
  - GEOSITE,netflix,🌍 国外媒体
  - GEOSITE,google,🚀 节点选择
  - GEOSITE,geolocation-!cn,🚀 节点选择
  - GEOIP,telegram,📲 电报信息
  - GEOSITE,cn,🎯 全球直连
  - GEOIP,CN,🎯 全球直连
  - MATCH,🐟 漏网之鱼
`;

export const SINGBOX = `{
  "log": { "level": "info", "timestamp": true },
  "dns": {
    "servers": [
      { "tag": "google", "address": "https://8.8.8.8/dns-query", "detour": "🚀 节点选择" },
      { "tag": "local", "address": "223.5.5.5", "detour": "direct" }
    ],
    "rules": [ { "clash_mode": "direct", "server": "local" }, { "rule_set": "geosite-cn", "server": "local" } ],
    "final": "google",
    "strategy": "ipv4_only"
  },
  "inbounds": [
    { "type": "tun", "tag": "tun-in", "address": ["172.19.0.1/30"], "auto_route": true, "strict_route": true, "stack": "mixed" },
    { "type": "mixed", "tag": "mixed-in", "listen": "127.0.0.1", "listen_port": 7890 }
  ],
  "outbounds": [
    { "type": "selector", "tag": "🚀 节点选择", "outbounds": ["♻️ 自动选择", "direct", "<PROXIES>"], "default": "♻️ 自动选择" },
    { "type": "urltest", "tag": "♻️ 自动选择", "outbounds": ["<PROXIES>"], "url": "http://www.gstatic.com/generate_204", "interval": "5m" },
    { "type": "direct", "tag": "direct" }
  ],
  "route": {
    "rules": [
      { "action": "sniff" },
      { "protocol": "dns", "action": "hijack-dns" },
      { "clash_mode": "direct", "outbound": "direct" },
      { "rule_set": "geosite-cn", "outbound": "direct" },
      { "rule_set": "geoip-cn", "outbound": "direct" }
    ],
    "rule_set": [
      { "type": "remote", "tag": "geosite-cn", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-cn.srs" },
      { "type": "remote", "tag": "geoip-cn", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs" }
    ],
    "final": "🚀 节点选择",
    "auto_detect_interface": true
  }
}
`;

export const SURGE = `# ApRID 默认 Surge 模板
[General]
loglevel = notify
dns-server = 223.5.5.5, 119.29.29.29
skip-proxy = 127.0.0.1, 192.168.0.0/16, 10.0.0.0/8, localhost, *.local
ipv6 = false

[Proxy]
<PROXIES>

[Proxy Group]
🚀 节点选择 = select, ♻️ 自动选择, 🎯 全球直连, <PROXY_NAMES>
♻️ 自动选择 = url-test, <PROXY_NAMES>, url=http://www.gstatic.com/generate_204, interval=300
🎯 全球直连 = select, DIRECT, 🚀 节点选择

[Rule]
DOMAIN-SUFFIX,openai.com,🚀 节点选择
DOMAIN-SUFFIX,anthropic.com,🚀 节点选择
DOMAIN-SUFFIX,telegram.org,🚀 节点选择
GEOIP,CN,🎯 全球直连
FINAL,🚀 节点选择,dns-failed
`;

export const LOON = `# ApRID 默认 Loon 模板
[General]
dns-server = 223.5.5.5,119.29.29.29
skip-proxy = 127.0.0.1,192.168.0.0/16,10.0.0.0/8,localhost,*.local
ipv6 = false

[Proxy]
<PROXIES>

[Proxy Group]
🚀 节点选择 = select,♻️ 自动选择,🎯 全球直连,<PROXY_NAMES>
♻️ 自动选择 = url-test,<PROXY_NAMES>,url=http://www.gstatic.com/generate_204,interval=300
🎯 全球直连 = select,DIRECT,🚀 节点选择

[Rule]
DOMAIN-SUFFIX,openai.com,🚀 节点选择
DOMAIN-SUFFIX,anthropic.com,🚀 节点选择
DOMAIN-SUFFIX,telegram.org,🚀 节点选择
GEOIP,CN,🎯 全球直连
FINAL,🚀 节点选择
`;

export const QUANTUMULTX = `# ApRID 默认 QuantumultX 模板
[general]
network_check_url=http://www.gstatic.com/generate_204
server_check_url=http://www.gstatic.com/generate_204
geo_location_checker=disable

[server_local]
<PROXIES>

[policy]
static=🚀 节点选择, ♻️ 自动选择, 🎯 全球直连, <PROXY_NAMES>
url-latency-benchmark=♻️ 自动选择, <PROXY_NAMES>, check-interval=300, tolerance=100
static=🎯 全球直连, direct, 🚀 节点选择

[filter_local]
host-suffix, openai.com, 🚀 节点选择
host-suffix, anthropic.com, 🚀 节点选择
host-suffix, telegram.org, 🚀 节点选择
geoip, cn, 🎯 全球直连
final, 🚀 节点选择
`;

// client_type -> { name, content }
export const DEFAULT_TEMPLATES = {
  clash: { name: '默认 Clash.Meta', content: CLASH_META },
  singbox: { name: '默认 sing-box', content: SINGBOX },
  surge: { name: '默认 Surge', content: SURGE },
  loon: { name: '默认 Loon', content: LOON },
  quantumultx: { name: '默认 QuantumultX', content: QUANTUMULTX },
  base64: { name: '默认 Base64 (v2rayN/Shadowrocket)', content: '' },
};
