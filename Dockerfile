# ---------- Stage 1: build frontend ----------
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---------- Stage 2: install server deps ----------
# No native modules anymore (uses Node's built-in node:sqlite), so a plain
# npm install with no build toolchain — small and fast, works on any x86_64/arm64.
FROM node:24-slim AS server-deps
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev

# ---------- Stage 3: runtime ----------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=6601
ENV DB_PATH=/data/aprid.db
# app-wide timezone: 全应用时间统一 UTC+8（北京时间）
ENV TZ=Asia/Shanghai
# sing-box core for the real node-availability probe (services/probe.js).
# Best-effort install — the `|| echo` makes a download failure NON-fatal so the
# image still builds; the probe degrades gracefully at runtime if the binary is
# absent. Override the version with --build-arg SINGBOX_VERSION=x.y.z.
ARG SINGBOX_VERSION=1.11.4
RUN set -u; arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) sb=amd64;; arm64) sb=arm64;; *) sb='';; esac; \
    if [ -n "$sb" ]; then ( set -e; \
      apt-get update && apt-get install -y --no-install-recommends curl ca-certificates; \
      curl -fsSL "https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/sing-box-${SINGBOX_VERSION}-linux-${sb}.tar.gz" -o /tmp/sb.tgz; \
      tar -xzf /tmp/sb.tgz -C /tmp; \
      mv "/tmp/sing-box-${SINGBOX_VERSION}-linux-${sb}/sing-box" /usr/local/bin/sing-box; \
      chmod +x /usr/local/bin/sing-box; \
      apt-get purge -y curl && apt-get autoremove -y && apt-get clean; \
      rm -rf /tmp/sb.tgz "/tmp/sing-box-${SINGBOX_VERSION}-linux-${sb}" /var/lib/apt/lists/* \
    ) || echo "[build] sing-box install skipped — 可用性检测将不可用（可运行时挂载 sing-box 并设 SINGBOX_PATH）"; fi
ENV SINGBOX_PATH=/usr/local/bin/sing-box
RUN mkdir -p /data
COPY server/package.json ./
COPY --from=server-deps /app/node_modules ./node_modules
COPY server/src ./src
# built frontend served statically by the server
COPY --from=web /web/dist ./public
EXPOSE 6601
VOLUME ["/data"]
CMD ["node", "src/index.js"]
