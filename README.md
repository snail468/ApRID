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
| 自动化 | 边栏独立菜单，所有自动化显式运行并展示进度/报错日志：**机场订阅自动重置**、**用户流量统计**（B−A 估算，达上限自动切断订阅） |
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

#### 浏览器模式（绕过 CF / 接口签名的另一方案，可选）

对付得最凶的机场（Cloudflare 5 秒盾、Turnstile、接口带 `X-Signature`/RSA 加密），面板支持**浏览器模式**：不再自己拼 HTTP 请求，而是通过 CDP 接管一个真实 Chromium，在**机场页面自己的 JS 上下文里**完成登录与重置——请求由真实浏览器在机场域名下发出，天然携带 `cf_clearance`、复用页面的请求签名，绕过绝大多数防护。

- 主镜像只含 `playwright-core`（几 MB，不含浏览器）；浏览器由 `docker-compose.yml` 里的可选 **`browserless`** 侧车提供，用不到可整段删除。
- **必须用带 browserless 的 `docker-compose.yml` 一起启动**（`docker compose up -d`）——单独 `docker run` 或旧版 compose 里没有 browserless，会报 `ENOTFOUND browserless`。
- browserless v2 需要 token：compose 里 browserless 的 `TOKEN` 与 aprid 的 `BROWSER_CDP_ENDPOINT=ws://browserless:3000?token=...` 必须一致（把示例里的 `aprid-browser-token` 改成你自己的随机串）。
- 用法：机场编辑页「自动重置方式」选 **浏览器模式**，仍填账号密码或登录令牌；`Cookie` 字段可粘贴 `cf_clearance` 提高通过率；CDP 端点留空即用默认侧车（也可指向你自建/远程的浏览器）。
- 硬性点击验证码（极验滑块等）已预留打码接口（`CAPTCHA_PROVIDER`/`CAPTCHA_API_KEY`），默认不启用。
- 启用前请务必先用「自动化」页的 **测试** 按钮验证侧车连通与登录可用。

**从零开始三步**：① 用最新 `docker-compose.yml`（含 browserless）执行 `docker compose pull && docker compose up -d`；② `docker compose ps` 确认 `aprid` 与 `browserless` 都是 Up；③ 机场编辑页把「自动重置方式」改成浏览器模式并保存，去「自动化」页点该机场「测试」，显示绿色 ✓ 即成功。

**遇到 Cloudflare「Just a moment…」怎么办**：面板已会在打开页面后**自动等待 CF 挑战通过**再发接口请求，并伪装成正常桌面 Chrome。但默认的 **browserless 无头 Chromium 仍可能被“托管挑战（Managed Challenge）”识别**（如魔戒等）。此时按顺序尝试：

1. **贴 cf_clearance**：在你自己浏览器过验证后，从开发者工具复制 `cf_clearance` 到机场 **Cookie** 字段——注意它与 **出口 IP + UA** 绑定，需与侧车一致才有效（同机部署时可行）；
2. **换有头/反检测浏览器**做 CDP 侧车：把 `cdp_endpoint` 指向一个 headful 或反检测（stealth / camoufox）的浏览器；
3. **上 FlareSolverr**（专治 CF）：单独跑 `ghcr.io/flaresolverr/flaresolverr`，用它拿到 cf_clearance 后回填 Cookie，再用普通 HTTP 模式重置——如需面板内置对接 FlareSolverr，提 issue 即可加。

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
