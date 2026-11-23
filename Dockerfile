# Built for linux/arm64. All stages use the same pinned Node image so the
# native better-sqlite3 module matches the runtime.
ARG NODE_IMAGE=docker.io/library/node:24.22.2-bookworm-slim@sha256:e80dee4ed3709cf1f8004e34ecfb90df71b7eac8ba0d7d6222ba238a823d1eea

FROM ${NODE_IMAGE} AS deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.8.0
WORKDIR /app
# Compile better-sqlite3 locally instead of downloading a prebuilt binary.
ENV npm_config_build_from_source=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json ./packages/server/package.json
COPY packages/dashboard/package.json ./packages/dashboard/package.json
RUN pnpm install --frozen-lockfile --prod --filter @hem/server

FROM deps AS dashboard
RUN CI=true pnpm install --frozen-lockfile
COPY packages/dashboard/ ./packages/dashboard/
RUN pnpm build

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    HERMES_HEALTH_DB_PATH=/data/hem.sqlite
WORKDIR /app
COPY --from=deps /app/node_modules/ ./node_modules/
COPY --from=deps /app/packages/server/node_modules/ ./packages/server/node_modules/
COPY packages/server/package.json ./packages/server/
COPY packages/server/src/ ./packages/server/src/
COPY --from=dashboard /app/packages/dashboard/dist/ ./packages/dashboard/dist/
RUN install -d -o node -g node -m 0700 /data
USER node
EXPOSE 3000
WORKDIR /app/packages/server
CMD ["node", "src/server.ts"]
