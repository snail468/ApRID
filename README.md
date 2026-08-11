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

## 快速开始（Docker 一键部署）

```bash
cp .env.example .env
# 编辑 .env，至少修改 ADMIN_USERNAME / ADMIN_PASSWORD / JWT_SECRET
docker compose up -d
```

访问 `http://<服务器IP>:6601`。

## CI / 预构建镜像

每次推送到 `main`，GitHub Actions 会自动跑测试、构建前端，并把 Docker 镜像发布到 GHCR：
`ghcr.io/snail468/aprid:latest`。服务器上可直接拉取预构建镜像，免本地编译：

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
