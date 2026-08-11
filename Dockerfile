# ---------- Stage 1: build frontend ----------
FROM node:20-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---------- Stage 2: install server deps ----------
# Use a glibc base (Debian slim), NOT alpine/musl — better-sqlite3's native
# binary must match the runtime libc, otherwise the process segfaults (exit 139).
FROM node:20-slim AS server-deps
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
# build toolchain for better-sqlite3 (node-gyp fallback if no matching prebuild)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm install --omit=dev \
    && rm -rf /var/lib/apt/lists/*

# ---------- Stage 3: runtime ----------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=6601
ENV DB_PATH=/data/aprid.db
RUN mkdir -p /data
COPY server/package.json ./
COPY --from=server-deps /app/node_modules ./node_modules
COPY server/src ./src
# built frontend served statically by the server
COPY --from=web /web/dist ./public
EXPOSE 6601
VOLUME ["/data"]
CMD ["node", "src/index.js"]
