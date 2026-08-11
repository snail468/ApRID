#!/usr/bin/env bash
# ApRID 一键部署/升级脚本：拉取最新镜像并启动。
# 用法：  bash deploy.sh
# 升级：  再跑一次同样的命令即可（配置与数据都会保留）。
set -euo pipefail

IMAGE="ghcr.io/snail468/aprid:latest"
DIR="$HOME/aprid"
ENV_FILE="$DIR/aprid.env"
PORT="6601"

mkdir -p "$DIR/data"

# 首次运行：生成配置（随机管理员密码 + 随机 JWT 密钥）
if [ ! -f "$ENV_FILE" ]; then
  gen() { openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | xxd -p | tr -d '\n'; }
  cat > "$ENV_FILE" <<EOF
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$(gen 8)
JWT_SECRET=$(gen 32)
PORT=$PORT
DB_PATH=/data/aprid.db
EOF
  echo "==> 已生成配置 $ENV_FILE ："
  cat "$ENV_FILE"
  echo "==> 请记下上面的管理员账号密码（登录后可在面板内修改）。"
  echo
fi

echo "==> 拉取镜像并启动 $IMAGE ..."
docker rm -f aprid >/dev/null 2>&1 || true
docker run -d --name aprid \
  --restart unless-stopped \
  --pull always \
  -p "${PORT}:${PORT}" \
  --env-file "$ENV_FILE" \
  -v "$DIR/data:/data" \
  "$IMAGE"

echo "==> 完成。等待几秒后访问： http://<服务器公网IP>:${PORT}"
echo "==> 查看日志： docker logs -f aprid"
