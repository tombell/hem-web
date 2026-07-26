# Hem Web

Hem Web is the HTTP API backend and data store for health data exported by the [Hem](https://github.com/tombell/hem-app) iOS app.

## Security

Hem Web stores sensitive health information. Keep the default loopback bind address and expose it only through a TLS-terminating reverse proxy or private network. Generate a high-entropy bearer token, keep it outside source control, and rotate it if it may have been disclosed.

Restrict the database directory and backup files to the service account (for example, directory mode `0700` and file mode `0600`) and encrypt off-host backups. Authenticated health responses use `Cache-Control: no-store`.

The process applies a per-IP in-memory rate limit. Configure it with `HERMES_HEALTH_RATE_LIMIT_MAX` and `HERMES_HEALTH_RATE_LIMIT_WINDOW_MS`. Multi-process deployments must enforce a shared limit at the reverse proxy or replace the in-memory store. Do not trust forwarded client-IP headers unless the proxy is trusted and configured accordingly.

## Operations

`GET /health` is an unauthenticated liveness check. `GET /ready` additionally checks SQLite availability and returns `503` when the database is unavailable. Neither endpoint exposes database details. Application logs are structured JSON and omit request bodies and query parameters.
