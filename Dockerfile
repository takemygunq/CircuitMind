# CircuitMind — образ приложения.  docker build -t circuitmind .
FROM node:24-slim AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CIRCUITMIND_DATA_DIR=/data
# standalone-сервер + файлы, которые приложение читает во время работы
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/library ./library
COPY --from=build /app/config ./config
RUN mkdir -p /data && chown -R node:node /data /app/library
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
