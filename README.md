# Hem Web

Private pnpm package for Hem data services.

## Setup

```sh
pnpm install
HERMES_HEALTH_BEARER_TOKEN="replace-me" pnpm run start
```

The server listens on `HOST` or `127.0.0.1`, and `PORT` or `3000`.

## API

The OpenAPI 3.1 document is available from:

```http
GET /openapi.json
```

```http
POST /apple-health/import
Authorization: Bearer <shared-secret>
Content-Type: application/json
```

Returns `201 { "ok": true }` for a new import and `200 { "ok": true }` for an exact duplicate or replacement import.

Authenticated read endpoints for Hermes:

```http
GET /apple-health/sources
GET /apple-health/imports?sourceKey=<source>&start=<iso-date-time>&end=<iso-date-time>&limit=500
GET /apple-health/imports/{id}/payload
GET /apple-health/daily-metrics?sourceKey=<source>&metric=steps&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&limit=500
GET /apple-health/samples?sourceKey=<source>&type=restingHeartRate&start=<iso-date-time>&end=<iso-date-time>&limit=500
GET /apple-health/category-samples?sourceKey=<source>&type=mindfulSession&value=notApplicable&start=<iso-date-time>&end=<iso-date-time>&limit=500
GET /apple-health/workouts?sourceKey=<source>&activityType=running&start=<iso-date-time>&end=<iso-date-time>&limit=500
GET /apple-health/sleep?sourceKey=<source>&value=asleepCore&start=<iso-date-time>&end=<iso-date-time>&limit=500
```

All `/apple-health/*` endpoints require the same bearer token. Import, sample, category sample, workout, and sleep range filters match rows whose intervals overlap the requested `start`/`end`.

The current app sends `categorySamples` for mindfulness and symptoms.

## Environment

- `HERMES_HEALTH_BEARER_TOKEN`: required shared secret.
- `HERMES_HEALTH_DB_PATH`: SQLite path, default `<repo>/data/hem.sqlite`.
- `HERMES_HEALTH_MAX_BODY_BYTES`: max request body, default `5242880`.
- `HOST`: server host, default `127.0.0.1`.
- `PORT`: server port, default `3000`.

Health payloads are stored in SQLite, but full payload bodies are never logged.
