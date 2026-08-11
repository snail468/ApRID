# ---------- Stage 1: build frontend ----------
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---------- Stage 2: install server deps ----------
FROM node:20-alpine AS server-deps
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
# better-sqlite3 needs build toolchain on alpine
RUN apk add --no-cache python3 make g++ \
    && npm install --omit=dev \
    && apk del python3 make g++

# ---------- Stage 3: runtime ----------
FROM node:20-alpine AS runtime
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
