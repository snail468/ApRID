# ApRID 订阅模板说明（面板适用版）

本面板在「订阅模板」页按客户端类型套用模板。下面 5 个模板已作为各客户端的**默认模板**内置并在首次启动时自动入库，源码见
`server/src/services/subscription/defaultTemplates.js`。你也可以在「订阅模板」页复制、修改后设为默认。

## 占位符

模板里用占位符标记节点插入位置，面板在下发订阅时替换：

| 占位符 | 含义 | 适用客户端 |
| --- | --- | --- |
| `<PROXIES>` | 节点条目列表（各客户端原生语法） | 全部 |
| `<PROXY_NAMES>` | 逗号分隔的节点名 | Surge / Loon / QuantumultX |

- Clash.Meta / sing-box：面板会自动注入 `proxies` / `outbounds`，并把出现在策略组里的 `<PROXIES>` 展开成全部节点名。
- 旧写法 `{{PROXIES}}` 已废弃，请统一用 `<PROXIES>`。

---

## 默认 Clash.Meta

```yaml
mixed-port: 7890
allow-lan: true
mode: rule
dns:
  enable: true
  enhanced-mode: fake-ip
  nameserver: [223.5.5.5, 119.29.29.29]
  fallback: [https://1.1.1.1/dns-query, https://dns.google/dns-query]
proxies: []
proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies: [♻️ 自动选择, 🎯 全球直连, <PROXIES>]
  - name: ♻️ 自动选择
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    proxies: [<PROXIES>]
  - name: 🎯 全球直连
    type: select
    proxies: [DIRECT, 🚀 节点选择]
rules:
  - GEOSITE,category-ads-all,🛑 全球拦截
  - GEOSITE,openai,💬 AI 平台
  - GEOSITE,geolocation-!cn,🚀 节点选择
  - GEOIP,CN,🎯 全球直连
  - MATCH,🐟 漏网之鱼
```

## 默认 sing-box

```json
{
  "outbounds": [
    { "type": "selector", "tag": "🚀 节点选择", "outbounds": ["♻️ 自动选择", "direct", "<PROXIES>"], "default": "♻️ 自动选择" },
    { "type": "urltest", "tag": "♻️ 自动选择", "outbounds": ["<PROXIES>"], "url": "http://www.gstatic.com/generate_204", "interval": "5m" },
    { "type": "direct", "tag": "direct" }
  ],
  "route": { "final": "🚀 节点选择", "auto_detect_interface": true }
}
```

## 默认 Surge

```ini
[Proxy]
<PROXIES>

[Proxy Group]
🚀 节点选择 = select, ♻️ 自动选择, 🎯 全球直连, <PROXY_NAMES>
♻️ 自动选择 = url-test, <PROXY_NAMES>, url=http://www.gstatic.com/generate_204, interval=300

[Rule]
GEOIP,CN,🎯 全球直连
FINAL,🚀 节点选择,dns-failed
```

## 默认 Loon

```ini
[Proxy]
<PROXIES>

[Proxy Group]
🚀 节点选择 = select,♻️ 自动选择,🎯 全球直连,<PROXY_NAMES>
♻️ 自动选择 = url-test,<PROXY_NAMES>,url=http://www.gstatic.com/generate_204,interval=300

[Rule]
GEOIP,CN,🎯 全球直连
FINAL,🚀 节点选择
```

## 默认 QuantumultX

```ini
[server_local]
<PROXIES>

[policy]
static=🚀 节点选择, ♻️ 自动选择, 🎯 全球直连, <PROXY_NAMES>
url-latency-benchmark=♻️ 自动选择, <PROXY_NAMES>, check-interval=300, tolerance=100

[filter_local]
geoip, cn, 🎯 全球直连
final, 🚀 节点选择
```

> 完整可用内容以 `defaultTemplates.js` 为准；此处为节选便于阅读。
