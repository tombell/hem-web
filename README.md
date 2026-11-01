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

| Variable                             | Default           | Description                                                                        |
| ------------------------------------ | ----------------- | ---------------------------------------------------------------------------------- |
| `HERMES_HEALTH_BEARER_TOKEN`         | required          | Bearer token for Apple Health endpoints.                                           |
| `HERMES_HEALTH_DASHBOARD_TOKEN`      | unset             | Optional read-only token for dashboard queries. Must differ from the import token. |
| `HERMES_HEALTH_DB_PATH`              | `data/hem.sqlite` | SQLite database path.                                                              |
| `HERMES_HEALTH_MAX_BODY_BYTES`       | `5242880`         | Maximum JSON import body size.                                                     |
| `HERMES_HEALTH_PUBLIC_URL`           | `/`               | HTTP(S) or absolute-path OpenAPI server URL.                                       |
| `HERMES_HEALTH_RATE_LIMIT_MAX`       | `300`             | Requests allowed per client IP and window.                                         |
| `HERMES_HEALTH_RATE_LIMIT_WINDOW_MS` | `60000`           | In-memory rate-limit window in milliseconds.                                       |
| `HOST`                               | `127.0.0.1`       | Listen address.                                                                    |
| `PORT`                               | `3000`            | Listen port.                                                                       |

## Running

```sh
pnpm start
```

The database directory is created automatically. Numbered, transactional migrations run at startup. A database created by a newer unsupported application version is rejected rather than modified.

Operational endpoints do not require authentication:

- `GET /health` — process liveness
- `GET /ready` — process and SQLite readiness
- `GET /openapi.json` — OpenAPI 3.1 document

## Dashboard

The `@hem/dashboard` workspace package uses Preact, TypeScript, Tailwind CSS, and Vite+.
Set `HERMES_HEALTH_DASHBOARD_TOKEN` to a separate high-entropy secret in `.env`, then build and start:

```sh
pnpm build
pnpm start
```

Open `http://127.0.0.1:3000/dashboard/` and enter the dashboard token. The token stays in tab memory and clears on reload or disconnect. It can read Apple Health query endpoints but cannot import data. The existing import token continues to work for the iOS app. Without a dashboard token configured, the existing API behavior is unchanged.

The dashboard shows daily metric charts and values, workouts, individual sleep intervals, and import history. Filters are stored in the URL; health records and credentials are never persisted to browser storage. Select one export source at a time to avoid combining duplicate data across devices. Date ranges are limited to 366 days. Queries follow pagination and fail visibly rather than presenting incomplete totals.

Daily metric dates remain as exported. Timestamp filters use the browser's timezone and include the entire final calendar day. Sleep records are grouped by their local start date, with overlaps shown separately; no nightly duration total is inferred. Mixed units appear as separate metric series, and missing records appear as gaps, not zero. The overview cards show the latest recorded value within the selected range, not a period total.

For development, run `pnpm start` in one terminal and `pnpm dev:dashboard` in another. Open the dashboard URL printed by Vite+. Its development proxy targets `http://127.0.0.1:3000`; change the package's Vite config if using another API port. Production assets are served by Fastify, and the container build includes them.

Run `pnpm api:types` after changing `src/openapi.json`, then `pnpm fmt`. Generated response types are committed. The generator runs in an isolated, pinned TypeScript 5 tool environment because it uses compiler APIs not exposed by TypeScript 7; application checks continue to use the project's TypeScript 7 compiler.

Manual check: connect, switch sources and date ranges, inspect missing days in a chart and its values table, visit workouts/sleep/imports, then disconnect. Check the layout on a narrow screen and navigate filters and tables with the keyboard.

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

The `Dockerfile` builds a self-contained image that listens on `0.0.0.0:3000` and stores the database at `/data/hem.sqlite`. Run it with Docker or Apple's [`container`](https://github.com/apple/container) tool.

### Docker

```sh
docker build -t hem-web .
docker run -d --name hem-web \
  --env-file .env \
  -p 127.0.0.1:3000:3000 \
  -v hem-web-data:/data \
  hem-web
```

### Apple container

Requires an Apple silicon Mac. Start the container system service once, then build and run:

```sh
container system start
container build -t hem-web .
container run -d --name hem-web \
  --env-file .env \
  -p 127.0.0.1:3000:3000 \
  -v hem-web-data:/data \
  hem-web
```

## Security

Hem Web stores sensitive health information. Keep the default loopback bind address and expose it only through a TLS-terminating reverse proxy or private network. Generate a high-entropy bearer token, keep it outside source control, and rotate it if it may have been disclosed.

Restrict the database directory and backup files to the service account (directory mode `0700`, file mode `0600`) and encrypt off-host backups. Health responses use `Cache-Control: no-store`.

The process applies a per-IP in-memory rate limit. Multi-process deployments must enforce a shared limit at the reverse proxy or replace the in-memory store. Do not trust forwarded client-IP headers unless the proxy is trusted and configured accordingly.

Application logs are structured JSON and omit request bodies and query parameters.

## Development

[Vite+](https://viteplus.dev/guide/) is installed locally at the workspace root.
The existing pnpm scripts use its bundled Vitest, Oxlint, and Oxfmt, configured in
`vite.config.ts`. No global `vp` installation is required. Node remains managed by
mise, dependencies by pnpm, and typechecking by TypeScript's `tsc`.

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm lint
pnpm fmt:check
pnpm audit --prod
```

Use `pnpm fmt` to format files, `pnpm lint:fix` for automatic lint fixes, and
`pnpm exec vp test watch` to watch tests. `pnpm exec vp check` checks formatting
and lint; run `pnpm typecheck` separately for TypeScript checks.

The backend runs TypeScript directly in Node, so there is no Vite application
build step. The Docker image installs only production dependencies and does not
include Vite+. CI runs the development checks on pushes to `main`.
The future dashboard is planned to use Preact, TypeScript, and Tailwind; this
migration does not add dashboard code or UI dependencies.
