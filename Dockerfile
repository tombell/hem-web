# Build for linux/arm64; use the same immutable Node/libc in every stage.
FROM docker.io/library/node:24.22.2-bookworm-slim@sha256:e80dee4ed3709cf1f8004e34ecfb90df71b7eac8ba0d7d6222ba238a823d1eea AS toolchain
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@11.8.0
WORKDIR /app
ENV npm_config_build_from_source=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM toolchain AS checks
RUN pnpm install --frozen-lockfile
COPY src/ ./src/
COPY test/ ./test/
COPY scripts/start-launchd.sh ./scripts/start-launchd.sh
COPY README.md tsconfig.json oxlint.config.ts oxfmt.config.ts Dockerfile .dockerignore .gitignore ./
RUN pnpm test && pnpm typecheck && pnpm lint && pnpm fmt:check

FROM toolchain AS prod-deps
RUN pnpm install --frozen-lockfile --prod \
    && node --input-type=module -e 'import Database from "better-sqlite3"; const db = new Database(":memory:"); if (db.prepare("SELECT 1 AS n").get().n !== 1) process.exit(1); db.close();'

# Export this stage locally to audit the exact filtered build context.
FROM scratch AS context-audit
COPY . /context/

FROM docker.io/library/node:24.22.2-bookworm-slim@sha256:e80dee4ed3709cf1f8004e34ecfb90df71b7eac8ba0d7d6222ba238a823d1eea AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 HERMES_HEALTH_DB_PATH=/data/hem.sqlite
WORKDIR /app
COPY --from=prod-deps /app/node_modules/ ./node_modules/
COPY package.json ./
COPY src/ ./src/
RUN mkdir /data && chown 1000:1000 /data && chmod 0700 /data \
    && chmod -R a-w /app \
    && node --input-type=module -e 'import Database from "better-sqlite3"; const db = new Database(":memory:"); if (process.platform !== "linux" || process.arch !== "arm64" || db.prepare("SELECT 1 AS n").get().n !== 1) process.exit(1); db.close();'
USER 1000:1000
EXPOSE 3000
STOPSIGNAL SIGTERM
ENTRYPOINT ["/bin/sh", "-c", "set -eu; umask 077; exec \"$@\"", "--"]
CMD ["node", "src/server.ts"]
