// Built-in default subscription templates, one per client family.
//
// These mirror the standard ACL4SSR-based routing template (see 订阅模板.txt at
// the repo root): the same policy groups (节点选择 / 自动选择 / AI 平台 / 国外媒体 /
// 电报信息 / 微软服务 / 苹果服务 / 全球直连 / 全球拦截 / 应用净化 / 漏网之鱼) and the
// same split rules — only the *syntax* is translated to each client's dialect and
// the node list is injected through placeholders instead of being hard-coded.
//
// Placeholders resolved at build time by converters.js:
//   <PROXIES>      -> the list of node entries (client-native syntax)
//   <PROXY_NAMES>  -> comma-joined node names (Surge / Loon / QuantumultX)
// Clash / sing-box also auto-inject the `proxies` / `outbounds` blocks and swap
// every `<PROXIES>` placeholder inside selector groups for the node names.

// Shared ACL4SSR rule-list URLs (plain-text DOMAIN-SUFFIX/… lists) — the same
// sources the standard template pulls, reused by Clash/Surge/Loon/QuantumultX.
const R = {
  LocalAreaNetwork: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list',
  BanAD: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list',
  BanProgramAD: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanProgramAD.list',
  GoogleCN: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/GoogleCN.list',
  SteamCN: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/SteamCN.list',
  Microsoft: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Microsoft.list',
  AI: 'https://raw.githubusercontent.com/QuixoticHeart/rule-set/refs/heads/ruleset/meta/ai.list',
  OpenAi: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/OpenAi.list',
  Apple: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Apple.list',
  ProxyMedia: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ProxyMedia.list',
  Telegram: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Telegram.list',
  ProxyLite: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ProxyLite.list',
  ChinaDomain: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list',
  ChinaCompanyIp: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaCompanyIp.list',
};

// ---------------- Clash.Meta ----------------
// Nearly the standard template verbatim: same groups, same RULE-SET rules and the
// full rule-providers block. Only the node placeholder is <PROXIES>.
export const CLASH_META = `# ApRID 默认 Clash.Meta 模板（保留标准 ACL4SSR 分流规则）
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
      - DIRECT
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
  - name: 🌍 国外媒体
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
  - name: Ⓜ️ 微软服务
    type: select
    proxies:
      - 🎯 全球直连
      - 🚀 节点选择
      - <PROXIES>
  - name: 🍎 苹果服务
    type: select
    proxies:
      - 🚀 节点选择
      - 🎯 全球直连
      - <PROXIES>
  - name: 🎯 全球直连
    type: select
    proxies:
      - DIRECT
      - 🚀 节点选择
      - ♻️ 自动选择
  - name: 🛑 全球拦截
    type: select
    proxies:
      - REJECT
      - DIRECT
  - name: 🍃 应用净化
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
  - RULE-SET,LocalAreaNetwork,🎯 全球直连
  - RULE-SET,BanAD,🛑 全球拦截
  - RULE-SET,BanProgramAD,🍃 应用净化
  - RULE-SET,GoogleCN,🎯 全球直连
  - RULE-SET,SteamCN,🎯 全球直连
  - RULE-SET,Microsoft,Ⓜ️ 微软服务
  - RULE-SET,AI,💬 AI 平台
  - RULE-SET,OpenAi,💬 AI 平台
  - RULE-SET,Apple,🍎 苹果服务
  - RULE-SET,ProxyMedia,🌍 国外媒体
  - RULE-SET,Telegram,📲 电报信息
  - RULE-SET,ProxyLite,🚀 节点选择
  - RULE-SET,ChinaDomain,🎯 全球直连
  - RULE-SET,ChinaCompanyIp,🎯 全球直连
  - GEOIP,CN,🎯 全球直连
  - MATCH,🐟 漏网之鱼
rule-providers:
  LocalAreaNetwork:
    type: http
    behavior: classical
    url: ${R.LocalAreaNetwork}
    format: text
    path: ./providers/LocalAreaNetwork.txt
    interval: 86400
  BanAD:
    type: http
    behavior: classical
    url: ${R.BanAD}
    format: text
    path: ./providers/BanAD.txt
    interval: 86400
  BanProgramAD:
    type: http
    behavior: classical
    url: ${R.BanProgramAD}
    format: text
    path: ./providers/BanProgramAD.txt
    interval: 86400
  GoogleCN:
    type: http
    behavior: classical
    url: ${R.GoogleCN}
    format: text
    path: ./providers/GoogleCN.txt
    interval: 86400
  SteamCN:
    type: http
    behavior: classical
    url: ${R.SteamCN}
    format: text
    path: ./providers/SteamCN.txt
    interval: 86400
  Microsoft:
    type: http
    behavior: classical
    url: ${R.Microsoft}
    format: text
    path: ./providers/Microsoft.txt
    interval: 86400
  AI:
    type: http
    behavior: classical
    url: ${R.AI}
    format: text
    path: ./providers/AI.txt
    interval: 86400
  OpenAi:
    type: http
    behavior: classical
    url: ${R.OpenAi}
    format: text
    path: ./providers/OpenAi.txt
    interval: 86400
  Apple:
    type: http
    behavior: classical
    url: ${R.Apple}
    format: text
    path: ./providers/Apple.txt
    interval: 86400
  ProxyMedia:
    type: http
    behavior: classical
    url: ${R.ProxyMedia}
    format: text
    path: ./providers/ProxyMedia.txt
    interval: 86400
  Telegram:
    type: http
    behavior: classical
    url: ${R.Telegram}
    format: text
    path: ./providers/Telegram.txt
    interval: 86400
  ProxyLite:
    type: http
    behavior: classical
    url: ${R.ProxyLite}
    format: text
    path: ./providers/ProxyLite.txt
    interval: 86400
  ChinaDomain:
    type: http
    behavior: classical
    url: ${R.ChinaDomain}
    format: text
    path: ./providers/ChinaDomain.txt
    interval: 86400
  ChinaCompanyIp:
    type: http
    behavior: classical
    url: ${R.ChinaCompanyIp}
    format: text
    path: ./providers/ChinaCompanyIp.txt
    interval: 86400
`;

// ---------------- sing-box ----------------
// Same policy groups as selectors; the standard split categories mapped onto
// sing-box remote rule-sets (SagerNet geosite/geoip .srs).
export const SINGBOX = `{
  "log": { "level": "info", "timestamp": true },
  "dns": {
    "servers": [
      { "tag": "proxy", "address": "https://8.8.8.8/dns-query", "detour": "🚀 节点选择" },
      { "tag": "local", "address": "223.5.5.5", "detour": "direct" }
    ],
    "rules": [ { "clash_mode": "direct", "server": "local" }, { "rule_set": "geosite-cn", "server": "local" } ],
    "final": "proxy",
    "strategy": "ipv4_only"
  },
  "inbounds": [
    { "type": "tun", "tag": "tun-in", "address": ["172.19.0.1/30"], "auto_route": true, "strict_route": true, "stack": "mixed" },
    { "type": "mixed", "tag": "mixed-in", "listen": "127.0.0.1", "listen_port": 7890 }
  ],
  "outbounds": [
    { "type": "selector", "tag": "🚀 节点选择", "outbounds": ["♻️ 自动选择", "direct", "<PROXIES>"], "default": "♻️ 自动选择" },
    { "type": "urltest", "tag": "♻️ 自动选择", "outbounds": ["<PROXIES>"], "url": "http://www.gstatic.com/generate_204", "interval": "5m", "tolerance": 50 },
    { "type": "selector", "tag": "💬 AI 平台", "outbounds": ["🚀 节点选择", "♻️ 自动选择", "🎯 全球直连", "<PROXIES>"] },
    { "type": "selector", "tag": "🌍 国外媒体", "outbounds": ["🚀 节点选择", "♻️ 自动选择", "🎯 全球直连", "<PROXIES>"] },
    { "type": "selector", "tag": "📲 电报信息", "outbounds": ["🚀 节点选择", "🎯 全球直连", "<PROXIES>"] },
    { "type": "selector", "tag": "Ⓜ️ 微软服务", "outbounds": ["🎯 全球直连", "🚀 节点选择", "<PROXIES>"] },
    { "type": "selector", "tag": "🍎 苹果服务", "outbounds": ["🚀 节点选择", "🎯 全球直连", "<PROXIES>"] },
    { "type": "selector", "tag": "🎯 全球直连", "outbounds": ["direct", "🚀 节点选择"], "default": "direct" },
    { "type": "selector", "tag": "🐟 漏网之鱼", "outbounds": ["🚀 节点选择", "🎯 全球直连", "♻️ 自动选择", "<PROXIES>"] },
    { "type": "direct", "tag": "direct" }
  ],
  "route": {
    "rules": [
      { "action": "sniff" },
      { "protocol": "dns", "action": "hijack-dns" },
      { "clash_mode": "direct", "outbound": "🎯 全球直连" },
      { "rule_set": "geosite-category-ads-all", "action": "reject" },
      { "rule_set": ["geosite-openai", "geosite-anthropic"], "outbound": "💬 AI 平台" },
      { "rule_set": "geosite-telegram", "outbound": "📲 电报信息" },
      { "rule_set": "geoip-telegram", "outbound": "📲 电报信息" },
      { "rule_set": ["geosite-youtube", "geosite-netflix", "geosite-disney", "geosite-category-media-cn"], "outbound": "🌍 国外媒体" },
      { "rule_set": "geosite-microsoft", "outbound": "Ⓜ️ 微软服务" },
      { "rule_set": "geosite-apple", "outbound": "🍎 苹果服务" },
      { "rule_set": ["geosite-google", "geosite-geolocation-!cn"], "outbound": "🚀 节点选择" },
      { "rule_set": "geosite-cn", "outbound": "🎯 全球直连" },
      { "rule_set": "geoip-cn", "outbound": "🎯 全球直连" }
    ],
    "rule_set": [
      { "type": "remote", "tag": "geosite-category-ads-all", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ads-all.srs" },
      { "type": "remote", "tag": "geosite-openai", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-openai.srs" },
      { "type": "remote", "tag": "geosite-anthropic", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-anthropic.srs" },
      { "type": "remote", "tag": "geosite-telegram", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-telegram.srs" },
      { "type": "remote", "tag": "geoip-telegram", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-telegram.srs" },
      { "type": "remote", "tag": "geosite-youtube", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-youtube.srs" },
      { "type": "remote", "tag": "geosite-netflix", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-netflix.srs" },
      { "type": "remote", "tag": "geosite-disney", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-disney.srs" },
      { "type": "remote", "tag": "geosite-category-media-cn", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-media-cn.srs" },
      { "type": "remote", "tag": "geosite-microsoft", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-microsoft.srs" },
      { "type": "remote", "tag": "geosite-apple", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-apple.srs" },
      { "type": "remote", "tag": "geosite-google", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-google.srs" },
      { "type": "remote", "tag": "geosite-geolocation-!cn", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-geolocation-!cn.srs" },
      { "type": "remote", "tag": "geosite-cn", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-cn.srs" },
      { "type": "remote", "tag": "geoip-cn", "format": "binary", "url": "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs" }
    ],
    "final": "🐟 漏网之鱼",
    "auto_detect_interface": true
  }
}
`;

// ---------------- Surge ----------------
// Surge parses the ACL4SSR plain-text lists via RULE-SET,<url>,<policy>, so the
// full standard split is preserved.
export const SURGE = `# ApRID 默认 Surge 模板（保留标准 ACL4SSR 分流规则）
[General]
loglevel = notify
dns-server = 223.5.5.5, 119.29.29.29
skip-proxy = 127.0.0.1, 192.168.0.0/16, 10.0.0.0/8, localhost, *.local
ipv6 = false

[Proxy]
<PROXIES>

[Proxy Group]
🚀 节点选择 = select, ♻️ 自动选择, DIRECT, <PROXY_NAMES>
♻️ 自动选择 = url-test, <PROXY_NAMES>, url=http://www.gstatic.com/generate_204, interval=300, tolerance=50
💬 AI 平台 = select, 🚀 节点选择, ♻️ 自动选择, 🎯 全球直连, <PROXY_NAMES>
🌍 国外媒体 = select, 🚀 节点选择, ♻️ 自动选择, 🎯 全球直连, <PROXY_NAMES>
📲 电报信息 = select, 🚀 节点选择, 🎯 全球直连, <PROXY_NAMES>
Ⓜ️ 微软服务 = select, 🎯 全球直连, 🚀 节点选择, <PROXY_NAMES>
🍎 苹果服务 = select, 🚀 节点选择, 🎯 全球直连, <PROXY_NAMES>
🎯 全球直连 = select, DIRECT, 🚀 节点选择
🛑 全球拦截 = select, REJECT, DIRECT
🍃 应用净化 = select, REJECT, DIRECT
🐟 漏网之鱼 = select, 🚀 节点选择, 🎯 全球直连, ♻️ 自动选择, <PROXY_NAMES>

[Rule]
RULE-SET,${R.LocalAreaNetwork},🎯 全球直连
RULE-SET,${R.BanAD},🛑 全球拦截
RULE-SET,${R.BanProgramAD},🍃 应用净化
RULE-SET,${R.GoogleCN},🎯 全球直连
RULE-SET,${R.SteamCN},🎯 全球直连
RULE-SET,${R.Microsoft},Ⓜ️ 微软服务
RULE-SET,${R.AI},💬 AI 平台
RULE-SET,${R.OpenAi},💬 AI 平台
RULE-SET,${R.Apple},🍎 苹果服务
RULE-SET,${R.ProxyMedia},🌍 国外媒体
RULE-SET,${R.Telegram},📲 电报信息
RULE-SET,${R.ProxyLite},🚀 节点选择
RULE-SET,${R.ChinaDomain},🎯 全球直连
RULE-SET,${R.ChinaCompanyIp},🎯 全球直连
GEOIP,CN,🎯 全球直连
FINAL,🐟 漏网之鱼,dns-failed
`;

// ---------------- Loon ----------------
// Loon consumes the same lists through its [Remote Rule] section.
export const LOON = `# ApRID 默认 Loon 模板（保留标准 ACL4SSR 分流规则）
[General]
dns-server = 223.5.5.5,119.29.29.29
skip-proxy = 127.0.0.1,192.168.0.0/16,10.0.0.0/8,localhost,*.local
ipv6 = false

[Proxy]
<PROXIES>

[Proxy Group]
🚀 节点选择 = select,♻️ 自动选择,DIRECT,<PROXY_NAMES>
♻️ 自动选择 = url-test,<PROXY_NAMES>,url=http://www.gstatic.com/generate_204,interval=300,tolerance=50
💬 AI 平台 = select,🚀 节点选择,♻️ 自动选择,🎯 全球直连,<PROXY_NAMES>
🌍 国外媒体 = select,🚀 节点选择,♻️ 自动选择,🎯 全球直连,<PROXY_NAMES>
📲 电报信息 = select,🚀 节点选择,🎯 全球直连,<PROXY_NAMES>
Ⓜ️ 微软服务 = select,🎯 全球直连,🚀 节点选择,<PROXY_NAMES>
🍎 苹果服务 = select,🚀 节点选择,🎯 全球直连,<PROXY_NAMES>
🎯 全球直连 = select,DIRECT,🚀 节点选择
🛑 全球拦截 = select,REJECT,DIRECT
🍃 应用净化 = select,REJECT,DIRECT
🐟 漏网之鱼 = select,🚀 节点选择,🎯 全球直连,♻️ 自动选择,<PROXY_NAMES>

[Remote Rule]
${R.LocalAreaNetwork}, policy=🎯 全球直连, tag=LocalAreaNetwork, enabled=true
${R.BanAD}, policy=🛑 全球拦截, tag=BanAD, enabled=true
${R.BanProgramAD}, policy=🍃 应用净化, tag=BanProgramAD, enabled=true
${R.GoogleCN}, policy=🎯 全球直连, tag=GoogleCN, enabled=true
${R.Microsoft}, policy=Ⓜ️ 微软服务, tag=Microsoft, enabled=true
${R.AI}, policy=💬 AI 平台, tag=AI, enabled=true
${R.OpenAi}, policy=💬 AI 平台, tag=OpenAi, enabled=true
${R.Apple}, policy=🍎 苹果服务, tag=Apple, enabled=true
${R.ProxyMedia}, policy=🌍 国外媒体, tag=ProxyMedia, enabled=true
${R.Telegram}, policy=📲 电报信息, tag=Telegram, enabled=true
${R.ProxyLite}, policy=🚀 节点选择, tag=ProxyLite, enabled=true
${R.ChinaDomain}, policy=🎯 全球直连, tag=ChinaDomain, enabled=true
${R.ChinaCompanyIp}, policy=🎯 全球直连, tag=ChinaCompanyIp, enabled=true

[Rule]
GEOIP,CN,🎯 全球直连
FINAL,🐟 漏网之鱼
`;

// ---------------- QuantumultX ----------------
// QuantumultX [filter_remote] auto-parses Surge/Clash style lists, so the same
// ACL4SSR sources drive the same policies.
export const QUANTUMULTX = `# ApRID 默认 QuantumultX 模板（保留标准 ACL4SSR 分流规则）
[general]
network_check_url=http://www.gstatic.com/generate_204
server_check_url=http://www.gstatic.com/generate_204
geo_location_checker=disable

[server_local]
<PROXIES>

[policy]
static=🚀 节点选择, ♻️ 自动选择, direct, <PROXY_NAMES>
url-latency-benchmark=♻️ 自动选择, <PROXY_NAMES>, check-interval=300, tolerance=50
static=💬 AI 平台, 🚀 节点选择, ♻️ 自动选择, 🎯 全球直连, <PROXY_NAMES>
static=🌍 国外媒体, 🚀 节点选择, ♻️ 自动选择, 🎯 全球直连, <PROXY_NAMES>
static=📲 电报信息, 🚀 节点选择, 🎯 全球直连, <PROXY_NAMES>
static=Ⓜ️ 微软服务, 🎯 全球直连, 🚀 节点选择, <PROXY_NAMES>
static=🍎 苹果服务, 🚀 节点选择, 🎯 全球直连, <PROXY_NAMES>
static=🎯 全球直连, direct, 🚀 节点选择
static=🐟 漏网之鱼, 🚀 节点选择, 🎯 全球直连, ♻️ 自动选择, <PROXY_NAMES>

[filter_remote]
${R.LocalAreaNetwork}, tag=LocalAreaNetwork, force-policy=🎯 全球直连, update-interval=86400, opt-parser=true, enabled=true
${R.BanAD}, tag=BanAD, force-policy=reject, update-interval=86400, opt-parser=true, enabled=true
${R.GoogleCN}, tag=GoogleCN, force-policy=🎯 全球直连, update-interval=86400, opt-parser=true, enabled=true
${R.Microsoft}, tag=Microsoft, force-policy=Ⓜ️ 微软服务, update-interval=86400, opt-parser=true, enabled=true
${R.AI}, tag=AI, force-policy=💬 AI 平台, update-interval=86400, opt-parser=true, enabled=true
${R.OpenAi}, tag=OpenAi, force-policy=💬 AI 平台, update-interval=86400, opt-parser=true, enabled=true
${R.Apple}, tag=Apple, force-policy=🍎 苹果服务, update-interval=86400, opt-parser=true, enabled=true
${R.ProxyMedia}, tag=ProxyMedia, force-policy=🌍 国外媒体, update-interval=86400, opt-parser=true, enabled=true
${R.Telegram}, tag=Telegram, force-policy=📲 电报信息, update-interval=86400, opt-parser=true, enabled=true
${R.ProxyLite}, tag=ProxyLite, force-policy=🚀 节点选择, update-interval=86400, opt-parser=true, enabled=true
${R.ChinaDomain}, tag=ChinaDomain, force-policy=🎯 全球直连, update-interval=86400, opt-parser=true, enabled=true
${R.ChinaCompanyIp}, tag=ChinaCompanyIp, force-policy=🎯 全球直连, update-interval=86400, opt-parser=true, enabled=true

[filter_local]
geoip, cn, 🎯 全球直连
final, 🐟 漏网之鱼
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
