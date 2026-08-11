# ApRID — 机场资源整合面板

一个机场资源整合（"二道贩子"）面板：聚合多个机场的节点，按用户下发订阅。

- 后端：Node.js + Express + better-sqlite3
- 前端：React + Vite
- 部署：单容器 Docker，一键启动，公网端口 **6601**

## 功能概览

| 模块 | 说明 |
| --- | --- |
| 管理员与登录 | env 配置初始管理员；登录后可改账号密码、开启 TOTP 两步验证、信任设备（60 天） |
| 机场管理 | 机场表（窄屏卡片）：搜索/排序/筛选/批量；账户、订阅链接、请求头/代理、到期用量、节点处理、分组、备注 |
| 机场订阅自动重置 | SSPanel / V2Board / Xboard 适配器：后台登录机场→重置订阅→回填订阅链接→拉取 |
| 节点管理 | 节点表：按机场-账户分组、协议/名称过滤、延迟检测 |
| 用户管理 | 用户表：行状态配色（灰=停用 / 红=过期 / 黄=≤3天到期）；多格式订阅、扫码导入、到期切断、重置订阅 |
| 订阅模板 | 自定义模板，按客户端类型（Clash / v2rayN / Shadowrocket…）下发 |

## 一键部署（服务器拉取镜像并启动，推荐）

在已装好 Docker 的服务器上，**一条命令**拉取预构建镜像并启动（升级时再跑一次即可，配置和数据都保留）：

```bash
curl -fsSL https://raw.githubusercontent.com/snail468/ApRID/main/deploy.sh | bash
```

或手动一条 `docker run`（把密码换成自己的；`JWT_SECRET` 自动随机生成）：

```bash
mkdir -p ~/aprid/data && docker rm -f aprid 2>/dev/null; docker run -d --name aprid \
  --restart unless-stopped --pull always -p 6601:6601 \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD='换成强密码' \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -v ~/aprid/data:/data \
  ghcr.io/snail468/aprid:latest
```

脚本 [deploy.sh](deploy.sh) 首次运行会在 `~/aprid/aprid.env` 生成随机管理员密码与 JWT 密钥并打印出来；之后重复运行即为升级（`--pull always` 拉最新镜像、重建容器，`~/aprid/data` 数据不变）。

> 上面的 `curl | bash` 需要仓库为 Public。若仓库是 Private，改用：`git clone https://github.com/snail468/ApRID.git && bash ApRID/deploy.sh`。

> 前提：服务器已装 Docker，且云安全组已放行 TCP 6601。若镜像拉取报 401，说明 GHCR 包还是 Private——见下方教程「常见问题」。

访问 `http://<服务器公网IP>:6601`，用打印出的管理员账号登录，**首次登录后请到「设置」改密码并开启两步验证**。

## 用 compose 部署（源码构建）

```bash
cp .env.example .env
# 编辑 .env，至少修改 ADMIN_USERNAME / ADMIN_PASSWORD / JWT_SECRET
docker compose up -d
```

访问 `http://<服务器IP>:6601`。

## 服务器全新部署详细教程（从零开始）

适用于一台全新的 Linux 云服务器（Ubuntu 20.04+ / Debian 11+ / CentOS 8+）。

### 0. 前置条件
- 一台有公网 IP 的服务器，可 SSH 登录（root 或带 sudo 的用户）。
- 在云厂商控制台的**安全组 / 防火墙**放行 **TCP 6601** 入站（阿里云/腾讯云叫"安全组"，AWS 叫"Security Group"）。这一步在服务器系统防火墙之外，最容易漏。

### 1. 安装 Docker

```bash
# 官方一键脚本（Ubuntu/Debian/CentOS 通用）
curl -fsSL https://get.docker.com | sh

# 启动并设为开机自启
sudo systemctl enable --now docker

# 验证（应打印版本号）
docker --version
docker compose version
```

> 若 `docker compose version` 报错，说明是老版 Docker，请升级；新版 Docker 自带 `compose` 子命令，无需单独装 `docker-compose`。

### 2. 部署（两种方式，任选其一）

#### 方式 A：拉取预构建镜像（推荐，无需编译）

```bash
# 建一个存放数据的目录
mkdir -p ~/aprid && cd ~/aprid

# 启动容器（把密码和密钥换成你自己的）
docker run -d --name aprid \
  --restart unless-stopped \
  -p 6601:6601 \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD='换成强密码' \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -v ~/aprid/data:/data \
  ghcr.io/snail468/aprid:latest
```

`JWT_SECRET` 用 `openssl rand -hex 32` 自动生成一个随机长串；数据库持久化在 `~/aprid/data`。

#### 方式 B：拉源码用 compose 构建

```bash
# 需要先装 git：Debian/Ubuntu 用 apt install -y git；CentOS 用 yum install -y git
git clone https://github.com/snail468/ApRID.git
cd ApRID

cp .env.example .env
nano .env          # 修改 ADMIN_PASSWORD、JWT_SECRET（其余保持默认即可）

docker compose up -d --build
```

### 3. 系统防火墙放行（如启用了 ufw/firewalld）

```bash
# Ubuntu/Debian (ufw)
sudo ufw allow 6601/tcp && sudo ufw reload

# CentOS/RHEL (firewalld)
sudo firewall-cmd --permanent --add-port=6601/tcp && sudo firewall-cmd --reload
```

### 4. 验证运行

```bash
docker ps                       # 状态应为 Up (healthy)
docker logs -f aprid            # 看启动日志，Ctrl+C 退出
curl http://127.0.0.1:6601/api/health   # 应返回 {"ok":true,...}
```

浏览器打开 `http://<服务器公网IP>:6601`，用 `.env` 里的管理员账号密码登录。**首次登录后请到「设置」修改密码并开启两步验证。**

### 5. 日常运维

| 操作 | 命令（方式 A `docker run`） | 命令（方式 B compose） |
| --- | --- | --- |
| 查看日志 | `docker logs -f aprid` | `docker compose logs -f` |
| 重启 | `docker restart aprid` | `docker compose restart` |
| 停止 | `docker stop aprid` | `docker compose down` |
| 升级到最新 | `docker pull ghcr.io/snail468/aprid:latest && docker rm -f aprid`，再重跑第 2 步 A 的命令 | `git pull && docker compose up -d --build` |
| 备份数据 | 备份 `~/aprid/data` 目录（含 SQLite 数据库） | 备份项目内 `data/` 目录 |

数据全在挂载的 `data` 卷里，删容器不丢数据；备份好该目录即可迁移到任何服务器。

### 6.（可选）绑定域名 + HTTPS

面板默认 HTTP。若要用域名和 HTTPS，在前面加一层反代（Nginx/Caddy）指向 `127.0.0.1:6601` 即可。Caddy 最简单，一份 `Caddyfile`：

```
your.domain.com {
    reverse_proxy 127.0.0.1:6601
}
```

Caddy 会自动申请并续期 Let's Encrypt 证书。

### 常见问题
- **打不开页面**：九成是云安全组没放行 6601；先 `curl http://127.0.0.1:6601/api/health` 在服务器本地确认服务正常，再查安全组/系统防火墙。
- **`docker pull` 拉取被拒 / 401**：镜像还是 Private，去 GitHub 仓库 Packages 页把 `aprid` 设为 Public；或用方式 B 从源码构建。
- **忘记管理员密码**：改 `.env`（或 `docker run` 的 `-e`）里的 `ADMIN_*` 只对**全新数据库**生效；已初始化过的库需删除 `data/aprid.db*` 后重启重新初始化（会清空数据）。

## CI / 预构建镜像

每次推送到 `main`，GitHub Actions 会自动跑测试、构建前端，并把 Docker 镜像发布到 GHCR：
`ghcr.io/snail468/aprid:latest`。

打一个 `v*` 版本 tag 还会额外发布带版本号的镜像：

```bash
git tag v1.0.0 && git push origin v1.0.0
# 产出 ghcr.io/snail468/aprid:1.0.0 、:1.0 、:1
```

服务器上可直接拉取预构建镜像，免本地编译：

```bash
docker run -d --name aprid -p 6601:6601 \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD=改我 -e JWT_SECRET=改我随机串 \
  -v $PWD/data:/data ghcr.io/snail468/aprid:latest
```

> 首次发布后需在仓库 Packages 页把该镜像设为 Public 才能匿名拉取。工作流见 [.github/workflows/ci.yml](.github/workflows/ci.yml)。

## 测试

```bash
cd server && npm test   # 协议解析 / 订阅转换 / 节点处理 逻辑测试
```

## 本地开发

```bash
# 后端
cd server && npm install && npm run dev
# 前端（另开终端）
cd web && npm install && npm run dev
```

前端开发服务器默认代理到 `http://localhost:6601`。

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
│           ├── airport/        # 机场适配器（SSPanel/V2Board）
│           └── nodeParser.js   # 订阅→节点解析
├── web/             # React 前端
├── Dockerfile
├── docker-compose.yml
└── .env.example
```
