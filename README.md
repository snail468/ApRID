# ApRID — 机场资源整合面板

一个机场资源整合（"二道贩子"）面板：聚合多个机场的节点，按用户下发订阅。

- 后端：Node.js + Express + 内置 SQLite（`node:sqlite`，无原生依赖）
- 前端：React + Vite
- 部署：单容器 Docker，一键启动，公网端口 **6601**

## 功能概览

| 模块 | 说明 |
| --- | --- |
| 管理员与登录 | env 配置初始管理员；登录后可改账号密码、开启 TOTP 两步验证、信任设备（60 天） |
| 机场管理 | 机场表（窄屏卡片）：搜索/排序/筛选/批量；账户、订阅链接、**交互式**请求头/User-Agent/代理/节点处理、到期用量、分组管理、备注 |
| 节点管理 | 节点表：按机场-账户分组、协议/名称过滤、延迟检测；协议支持 vmess/vless/trojan/ss/hysteria2/tuic/**anytls** |
| 用户管理 | 用户表：行状态配色（灰=停用 / 红=过期或流量用完 / 黄=≤3天到期）；分组管理、下发机场（按账户区分 + 隐藏已下发）、按协议包含/排除、流量上限、多格式订阅、扫码导入、到期/流量用尽切断、重置订阅 |
| 自动化 | 边栏独立菜单，所有自动化显式运行并展示进度/报错日志：**机场订阅自动重置**、**用户流量统计**（B−A 估算，达上限自动切断订阅）、**到期/超限告警**（邮件/Telegram + 免登录魔法链接） |
| 订阅模板 | 自定义模板，按客户端类型（Clash / v2rayN / Shadowrocket…）下发 |
| 界面 | 白天 / 黑夜主题切换（本地持久化）；页面缓存预取，边栏切换即点即开 |

### 关于机场的人机验证 / 安全防护

部分机场用 Cloudflare、DDoS-Guard 等防护拦截自动程序。面板的处理方式：

1. 自动重置/拉取时**检测挑战页**（Cloudflare「Just a moment」等），命中即在任务日志中给出明确提示，而不是静默失败；
2. 机场编辑页提供 **User-Agent** 选择与 **Cookie** 字段——在浏览器手动通过验证后，从开发者工具复制 Cookie 粘贴进来，自动化即复用该会话绕过验证；
3. **登录令牌 Authorization**：V2Board/Xboard 填入后跳过登录直接重置；令牌失效会自动用账号密码重登重试；
4. 支持为单个机场配置 **HTTP/SOCKS5 代理**；
5. 「自动化」页每个机场有 **测试** 按钮，仅验证账号/令牌/Cookie 是否可用（不重置），运行前先自测；
6. 实在无法自动化的机场，可只手动更新订阅链接后执行「拉取」。

#### FlareSolverr 模式（对付 Cloudflare 机场的首选，可选）

魔戒等启用 Cloudflare **托管挑战** 的机场，无头浏览器也常过不去。**FlareSolverr** 专门解这个：它用反检测浏览器解开 CF，返回 `cf_clearance` 和匹配的 UA，面板拿到后**写回本机场**，再走普通 HTTP 完成登录+重置。由于面板与 FlareSolverr 在同一 compose 网络、**同一出口 IP**，`cf_clearance` 有效，登录接口不再 403。重置后的订阅拉取也复用该 cookie/UA，一并过 CF。

- compose 里已内置可选 `flaresolverr` 服务；`docker compose up -d` 即随之启动。
- 机场编辑页「自动重置方式」选 **FlareSolverr（推荐）**，仍填账号密码或登录令牌，FlareSolverr 地址留空即用默认侧车 `http://flaresolverr:8191`。
- 先用「自动化」页 **测试** 验证：能读到订阅链接即通。
- 说明：`cf_clearance` 有时效（约几十分钟~数小时），过期后下次运行会自动重新解一次，无需手动维护。
- **解挑战超时/失败怎么办**（魔戒等强挑战站点）：① 调大 `FLARESOLVERR_TIMEOUT`（compose 里，如 `180000`）；② 给该机场配一个**干净/住宅代理**（机场编辑页「拉取代理」）——机房/VPS IP 常被 Cloudflare 加强挑战，配代理后 FlareSolverr 解挑战与后续重置都会走同一代理，`cf_clearance` 绑定该代理 IP 依旧一致，成功率显著更高；③ 换更新的 FlareSolverr 镜像；④ 若站点用的是 Turnstile 交互式验证，目前无法自动绕过，只能手动更新订阅链接后执行「拉取」。

#### 手动重置（半自动兜底）

极少数机场（如上了 Cloudflare Turnstile 交互验证）任何全自动方案都可能过不去。这时用**手动重置**：把机场「自动重置方式」设为 **手动重置**，在机场列表点 **手动重置** 按钮——弹窗里一键跳转机场登录页、一键复制账号密码，你在自己浏览器里登录并重置订阅，把**新订阅链接**粘回，面板保存并自动拉取一次。整个过程仍在「自动化」任务日志留痕（旧链接→新链接、拉取节点数）。手动重置模式的机场会被自动化/定时**跳过**，不会瞎跑报错。

### 到期/超限告警（邮件 / Telegram + 免登录魔法链接）

运营者不会一直盯着面板。开启告警后，面板在触发条件命中时主动提醒**管理员本人**（单一收件人），
且通知里带**签名魔法链接**——点开即是一个**免登录**的操作页，不用打开登录面板就能处理：

- **用户端告警**：某用户**已到期**或**流量超限**时发送。内容含该用户下发的每个机场的网址、账号、
  密码与完整手动重置步骤，以及每个机场一个 **「回填新订阅链接」** 链接——你在机场重置后把新链接粘进去，
  面板即保存并拉取（等价于「手动重置」，但免登录）。
- **机场端告警**：某机场**用量 ≥ 99%** 或**到期 ≤ 1 天**时发送。内容含机场网址、账号密码、当前用量/到期，
  以及一个 **「拉取更新」** 按钮——点一下面板即重新拉取该机场，刷新用量与到期时间（另附「回填链接」备用）。

**配置**：在 **设置 · 🔔 告警通知** 填邮件（SMTP 主机/端口/账号/密码/收发件人）或 Telegram（Bot Token + Chat ID），
可分别开关「用户端 / 机场端告警」并设「同类告警冷却小时」（默认 24h，避免刷屏）。点 **发送测试** 验证渠道。
**触发**：在 **自动化 · 到期/超限告警** 点「立即检查并通知」，或开启定时（建议按小时间隔）。

**魔法链接说明**：链接用 `JWT_SECRET` 做 HMAC 签名、**默认 7 天过期**，且只能执行「回填/拉取」两个动作、
只针对链接里指定的那个机场，无法用于其它任何操作或登录。生成绝对链接需要面板对外地址——
优先取告警设置里的「面板对外地址」，否则用环境变量 `PUBLIC_BASE_URL`。请勿转发这些链接给他人。

## 部署

**前置**：一台 Linux 服务器，已装 Docker（`curl -fsSL https://get.docker.com | sh`），并在**云厂商安全组 / 防火墙放行 TCP 6601** 入站（最容易漏的一步）。系统若启用了 ufw/firewalld 也要放行：

```bash
sudo ufw allow 6601/tcp                                             # Ubuntu/Debian
sudo firewall-cmd --permanent --add-port=6601/tcp && sudo firewall-cmd --reload   # CentOS/RHEL
```

部署完成后访问 `http://<服务器公网IP>:6601`，**首次登录务必到「设置」改密码并开启两步验证**。

### 方式一：docker compose 拉取预构建镜像（推荐）

在服务器项目目录内准备好 `docker-compose.yml` 与 `.env`（clone 本仓库，或只拷这两个文件）：

```bash
git clone https://github.com/snail468/ApRID.git && cd ApRID
cp .env.example .env
nano .env                         # 至少修改 ADMIN_PASSWORD、JWT_SECRET

docker compose pull && docker compose up -d
```

`docker-compose.yml` 默认使用 `ghcr.io/snail468/aprid:latest`，`docker compose pull` 即拉取 Actions 构建好的镜像。

**默认登录账号来自 `.env`**：`.env.example` 里是 `admin` / `change_me_please`（占位，请务必改）。

> 升级：`docker compose pull && docker compose up -d`（拉最新镜像重建容器，`./data` 数据不变）。

### 方式二：一键脚本（docker run，自动生成随机密码）

不想维护 compose 文件时，一条命令搞定：

```bash
curl -fsSL https://raw.githubusercontent.com/snail468/ApRID/main/deploy.sh | bash
```

[deploy.sh](deploy.sh) 首次运行会在 `~/aprid/aprid.env` 生成配置——`ADMIN_USERNAME=admin`、**随机** `ADMIN_PASSWORD`、随机 `JWT_SECRET`——并**打印出来**供登录；重复运行同一命令即为升级。仓库为 Private 时改用 `git clone https://github.com/snail468/ApRID.git && bash ApRID/deploy.sh`。

### 方式三：源码本地构建（不使用预构建镜像）

```bash
git clone https://github.com/snail468/ApRID.git && cd ApRID
cp .env.example .env              # 修改 ADMIN_PASSWORD、JWT_SECRET
# 先在 docker-compose.yml 取消 `build: .` 注释，然后：
docker compose up -d --build
```

### 运维

| 操作 | compose（方式一/三） | docker run / deploy.sh（方式二） |
| --- | --- | --- |
| 查看日志 | `docker compose logs -f` | `docker logs -f aprid` |
| 重启 | `docker compose restart` | `docker restart aprid` |
| 停止 | `docker compose down` | `docker stop aprid` |
| 升级 | `docker compose pull && docker compose up -d` | 再跑一次 `deploy.sh` |
| 备份 | 备份项目内 `./data` 目录 | 备份 `~/aprid/data` 目录 |

数据全在挂载的 `data` 目录（SQLite 数据库），删容器不丢数据；备份该目录即可迁移到任意服务器。

### 验证与常见问题

```bash
docker ps                                 # 状态应为 Up (healthy)
curl http://127.0.0.1:6601/api/health     # 应返回 {"ok":true,...}
```

- **打不开页面**：先在服务器本地 `curl .../api/health` 确认服务正常，再排查云安全组 / 系统防火墙是否放行 6601。
- **`docker pull` 报 401 / 被拒**：GHCR 镜像还是 Private——到仓库 **Packages** 页把 `aprid` 设为 Public；或改用方式三源码构建。
- **忘记管理员密码**：修改 `.env` 的 `ADMIN_*` 只对**全新数据库**生效；已初始化过的库需删除 `data/aprid.db*` 后重启重新初始化（会清空数据）。

### （可选）绑定域名 + HTTPS

面板默认 HTTP。用 Caddy 反代自动签发并续期证书，一份 `Caddyfile`：

```
your.domain.com {
    reverse_proxy 127.0.0.1:6601
}
```

## 发版（CI）

- 推送 `main` / PR：跑后端测试 + 前端构建（**不发布镜像**）。
- 打 `v*` 版本 tag：构建并发布 Docker 镜像到 GHCR（`latest` 指向最新版，另出 `x.y.z` / `x.y` / `x`）。

```bash
git tag v1.0.0 && git push origin v1.0.0
```

> 镜像首次发布后，需在仓库 **Packages** 页把 `aprid` 设为 Public 才能匿名拉取。工作流见 [.github/workflows/ci.yml](.github/workflows/ci.yml)。

## 测试

```bash
cd server && npm test   # 协议解析 / 订阅转换 / 节点处理 逻辑测试
```

## 本地开发

```bash
cd server && npm install && npm run dev   # 后端
cd web && npm install && npm run dev      # 前端（另开终端，默认代理到 http://localhost:6601）
```

## 环境变量

见 [.env.example](.env.example)。

## 目录结构

```
ApRID/
├── server/          # 后端 API + 静态站点托管
│   └── src/
│       ├── index.js
│       ├── db.js
│       ├── config.js
│       ├── middleware/
│       ├── routes/
│       └── services/
│           ├── subscription/   # 各客户端格式转换
│           ├── airport/        # 机场适配器（通用/SSPanel/V2Board）
│           └── nodeParser.js   # 订阅→节点解析
├── web/             # React 前端
├── deploy.sh        # 一键拉取镜像部署脚本
├── Dockerfile
├── docker-compose.yml
└── .env.example
```
