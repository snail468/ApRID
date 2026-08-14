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
RUN mkdir -p /data
COPY server/package.json ./
COPY --from=server-deps /app/node_modules ./node_modules
COPY server/src ./src
# built frontend served statically by the server
COPY --from=web /web/dist ./public
EXPOSE 6601
VOLUME ["/data"]
CMD ["node", "src/index.js"]
