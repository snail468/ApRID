# ApRID — 机场资源整合面板

一个机场资源整合（"二道贩子"）面板：聚合多个机场的节点，按用户下发订阅。

- 后端：Node.js + Express + 内置 SQLite（`node:sqlite`，无原生依赖）
- 前端：React + Vite
- 部署：单容器 Docker，一键启动，公网端口 **6601**

## 功能概览

| 模块 | 说明 |
| --- | --- |
| 管理员与登录 | env 配置初始管理员；登录后可改账号密码、开启 TOTP 两步验证、信任设备（60 天） |
| 机场管理 | 机场表（窄屏卡片）：搜索/排序/筛选/批量；账户、订阅链接、请求头/代理、到期用量、节点处理、分组、备注 |
| 机场订阅自动重置 | 通用 / SSPanel / V2Board / Xboard 适配器：后台登录机场→重置订阅→回填订阅链接→拉取 |
| 节点管理 | 节点表：按机场-账户分组、协议/名称过滤、延迟检测 |
| 用户管理 | 用户表：行状态配色（灰=停用 / 红=过期 / 黄=≤3天到期）；多格式订阅、扫码导入、到期切断、重置订阅 |
| 订阅模板 | 自定义模板，按客户端类型（Clash / v2rayN / Shadowrocket…）下发 |

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
