# Hem Web

Hem Web is the HTTP API and SQLite data store for health data exported by the [Hem](https://github.com/tombell/hem-app) iOS app.

## Requirements

- Node.js LTS (managed by [mise](https://mise.jdx.dev/) via `.mise.toml`)
- pnpm
- SQLite CLI for backup and restore operations

## Setup

```sh
mise install
pnpm install
cp .env.example .env # or create .env manually
```

At minimum, configure a high-entropy bearer token:

```dotenv
HERMES_HEALTH_BEARER_TOKEN=replace-with-a-long-random-secret
```

`.env` is ignored by Git. Environment variables already present in the process take precedence over `.env` files.

### Configuration

| Variable                             | Default           | Description                                  |
| ------------------------------------ | ----------------- | -------------------------------------------- |
| `HERMES_HEALTH_BEARER_TOKEN`         | required          | Bearer token for Apple Health endpoints.     |
| `HERMES_HEALTH_DB_PATH`              | `data/hem.sqlite` | SQLite database path.                        |
| `HERMES_HEALTH_MAX_BODY_BYTES`       | `5242880`         | Maximum JSON import body size.               |
| `HERMES_HEALTH_PUBLIC_URL`           | `/`               | HTTP(S) or absolute-path OpenAPI server URL. |
| `HERMES_HEALTH_RATE_LIMIT_MAX`       | `300`             | Requests allowed per client IP and window.   |
| `HERMES_HEALTH_RATE_LIMIT_WINDOW_MS` | `60000`           | In-memory rate-limit window in milliseconds. |
| `HOST`                               | `127.0.0.1`       | Listen address.                              |
| `PORT`                               | `3000`            | Listen port.                                 |

## Running

```sh
pnpm start
```

The database directory is created automatically. Numbered, transactional migrations run at startup. A database created by a newer unsupported application version is rejected rather than modified.

Operational endpoints do not require authentication:

- `GET /health` — process liveness
- `GET /ready` — process and SQLite readiness
- `GET /openapi.json` — OpenAPI 3.1 document

## API

All `/apple-health/*` endpoints require `Authorization: Bearer <token>`. Import an export with:

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $HERMES_HEALTH_BEARER_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @apple-health-export.json \
  http://127.0.0.1:3000/apple-health/import
```

The response identifies whether the range was created, duplicated, or replaced and includes normalized fact counts. Health record intervals allow `end` to equal `start`, preserving zero-duration HealthKit samples.

Query endpoints cover sources, imports, daily metrics, samples, category samples, workouts, and sleep. Collection responses include `hasMore` and an opaque `nextCursor`. Pass that value back as `cursor` while retaining the same filters:

```sh
curl --get \
  -H "Authorization: Bearer $HERMES_HEALTH_BEARER_TOKEN" \
  --data-urlencode 'limit=100' \
  --data-urlencode "cursor=$NEXT_CURSOR" \
  http://127.0.0.1:3000/apple-health/samples
```

See `/openapi.json` for complete payloads, filters, responses, and status codes.

## Backup and restore

SQLite runs in WAL mode. Do not copy only the main database file while the service is running. Create a consistent online backup with SQLite's backup command:

```sh
mkdir -p /secure/backups/hem-web
chmod 700 /secure/backups/hem-web
sqlite3 data/hem.sqlite ".backup '/secure/backups/hem-web/hem-$(date +%F).sqlite'"
chmod 600 /secure/backups/hem-web/hem-*.sqlite
```

Encrypt off-host backups. Periodically verify them:

```sh
sqlite3 /secure/backups/hem-web/hem-2026-07-26.sqlite 'PRAGMA integrity_check;'
```

To restore, stop Hem Web first, preserve the current files, and restore into a clean path:

```sh
mv data/hem.sqlite data/hem.sqlite.previous
rm -f data/hem.sqlite-wal data/hem.sqlite-shm
sqlite3 /secure/backups/hem-web/hem-2026-07-26.sqlite ".backup 'data/hem.sqlite'"
chmod 600 data/hem.sqlite
```

Start the service and confirm `/ready` before deleting the preserved database.

## Deployment

For the pinned Linux ARM64 image, isolated verification, named-volume storage,
loopback publication and narrow Apple Container recovery, see
[Container deployment](docs/container-deployment.md). This is opt-in; the native
launcher remains available for rollback and no proxy changes are required.

`scripts/start-launchd.sh` can be used by launchd without repository- or user-specific absolute paths. It supports:

| Variable                   | Purpose                                                         |
| -------------------------- | --------------------------------------------------------------- |
| `HEM_WEB_PROJECT_DIR`      | Project directory; defaults to the script's parent directory.   |
| `HEM_WEB_ENV_FILE`         | External environment file; defaults to `~/.config/hem-web/env`. |
| `HEM_WEB_PROJECT_ENV_FILE` | Project environment file; defaults to `<project>/.env`.         |
| `MISE_BIN`                 | Explicit mise executable used to locate Node.                   |
| `NODE_BIN`                 | Explicit Node executable; bypasses mise discovery.              |

The external environment file is loaded first and the project environment file may override it. The script prefers `NODE_BIN`, then `MISE_BIN`, discovered mise, and discovered Node. It executes `node src/server.ts` directly, so launchd supervises the single application process without pnpm, tsx, or esbuild intermediaries.

## Security

Hem Web stores sensitive health information. Keep the default loopback bind address and expose it only through a TLS-terminating reverse proxy or private network. Generate a high-entropy bearer token, keep it outside source control, and rotate it if it may have been disclosed.

Restrict the database directory and backup files to the service account (directory mode `0700`, file mode `0600`) and encrypt off-host backups. Health responses use `Cache-Control: no-store`.

The process applies a per-IP in-memory rate limit. Multi-process deployments must enforce a shared limit at the reverse proxy or replace the in-memory store. Do not trust forwarded client-IP headers unless the proxy is trusted and configured accordingly.

Application logs are structured JSON and omit request bodies and query parameters.

## Development

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm fmt:check
pnpm audit --prod
```
