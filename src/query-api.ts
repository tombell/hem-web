import type { HealthDatabase } from "./db";

export interface ApiResult {
  body: unknown;
  headers?: Record<string, string>;
  status: number;
}

interface ImportMetadataRow {
  created_at: string;
  generated_at: string;
  id: number;
  payload_hash: string;
  range_calendar: string;
  range_end: string;
  range_kind: string;
  range_start: string;
  range_time_zone: string;
  schema_version: number;
  source_app: string | null;
  source_bundle_identifier: string | null;
  source_device_identifier: string | null;
  source_device_name: string | null;
  source_key: string;
  updated_at: string;
}

interface RawImportRow extends ImportMetadataRow {
  raw_json: string;
}

interface SourceRow {
  first_imported_at: string;
  import_count: number;
  last_imported_at: string;
  source_app: string | null;
  source_bundle_identifier: string | null;
  source_device_identifier: string | null;
  source_device_name: string | null;
  source_key: string;
}

interface DailyMetricRow {
  date: string;
  id: number;
  import_id: number;
  metric: string;
  source_key: string;
  unit: string;
  updated_at: string;
  value: number;
}

interface SampleRow {
  end: string;
  id: number;
  import_id: number;
  source_key: string;
  start: string;
  type: string;
  unit: string;
  updated_at: string;
  value: number;
}

interface WorkoutRow {
  active_energy_unit: string | null;
  active_energy_value: number | null;
  activity_type: string;
  distance_unit: string | null;
  distance_value: number | null;
  duration_unit: string | null;
  duration_value: number | null;
  end: string;
  external_id: string | null;
  id: number;
  import_id: number;
  source_key: string;
  start: string;
  updated_at: string;
  workout_key: string;
}

interface SleepRow {
  end: string;
  id: number;
  import_id: number;
  source_key: string;
  start: string;
  updated_at: string;
  value: string;
}

type SqlParams = unknown[];

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5_000;

export function handleHealthQueryRequest(db: HealthDatabase, url: URL): ApiResult {
  if (url.pathname === "/apple-health/sources") {
    return listSources(db);
  }

  if (url.pathname === "/apple-health/imports") {
    return listImports(db, url.searchParams);
  }

  const importPayloadMatch = url.pathname.match(/^\/apple-health\/imports\/([1-9]\d*)\/payload$/);
  if (importPayloadMatch) {
    return getImportPayload(db, Number(importPayloadMatch[1]));
  }

  if (url.pathname === "/apple-health/daily-metrics") {
    return listDailyMetrics(db, url.searchParams);
  }

  if (url.pathname === "/apple-health/samples") {
    return listSamples(db, url.searchParams);
  }

  if (url.pathname === "/apple-health/workouts") {
    return listWorkouts(db, url.searchParams);
  }

  if (url.pathname === "/apple-health/sleep") {
    return listSleep(db, url.searchParams);
  }

  return errorResult(404, "not_found", "Not found");
}

function listSources(db: HealthDatabase): ApiResult {
  const rows = db
    .prepare<[], SourceRow>(`
    SELECT
      source_key,
      source_app,
      source_bundle_identifier,
      source_device_identifier,
      source_device_name,
      COUNT(*) AS import_count,
      MIN(created_at) AS first_imported_at,
      MAX(updated_at) AS last_imported_at
    FROM imports
    GROUP BY source_key
    ORDER BY source_key ASC
  `)
    .all();

  return successResult({
    sources: rows.map((row) => ({
      firstImportedAt: row.first_imported_at,
      importCount: row.import_count,
      lastImportedAt: row.last_imported_at,
      source: importSource(row),
      sourceKey: row.source_key,
    })),
  });
}

function listImports(db: HealthDatabase, params: URLSearchParams): ApiResult {
  const filters = parseCommonFilters(params);
  if (!filters.ok) return filters.result;

  const built = buildImportWhereClause(params);
  if (!built.ok) return built.result;

  const rows = db
    .prepare<SqlParams, ImportMetadataRow>(`
    SELECT
      id,
      schema_version,
      range_start,
      range_end,
      range_kind,
      range_calendar,
      range_time_zone,
      source_key,
      source_app,
      source_bundle_identifier,
      source_device_identifier,
      source_device_name,
      generated_at,
      payload_hash,
      created_at,
      updated_at
    FROM imports
    ${built.sql}
    ORDER BY range_start DESC, id DESC
    LIMIT ?
  `)
    .all(...built.values, filters.limit);

  return successResult({
    imports: rows.map(importMetadata),
  });
}

function getImportPayload(db: HealthDatabase, importId: number): ApiResult {
  const row = db
    .prepare<[number], RawImportRow>(`
    SELECT
      id,
      schema_version,
      range_start,
      range_end,
      range_kind,
      range_calendar,
      range_time_zone,
      source_key,
      source_app,
      source_bundle_identifier,
      source_device_identifier,
      source_device_name,
      generated_at,
      payload_hash,
      raw_json,
      created_at,
      updated_at
    FROM imports
    WHERE id = ?
  `)
    .get(importId);

  if (!row) {
    return errorResult(404, "not_found", "Import not found");
  }

  return successResult({
    import: importMetadata(row),
    payload: JSON.parse(row.raw_json),
  });
}

function listDailyMetrics(db: HealthDatabase, params: URLSearchParams): ApiResult {
  const filters = parseCommonFilters(params);
  if (!filters.ok) return filters.result;

  const clauses = ["1 = 1"];
  const values: unknown[] = [];
  addExactFilter(clauses, values, "source_key", params.get("sourceKey"));
  addExactFilter(clauses, values, "metric", params.get("metric"));

  const startDate = params.get("startDate");
  if (startDate !== null) {
    const result = validateDate(startDate, "startDate");
    if (!result.ok) return result.result;
    clauses.push("date >= ?");
    values.push(startDate);
  }

  const endDate = params.get("endDate");
  if (endDate !== null) {
    const result = validateDate(endDate, "endDate");
    if (!result.ok) return result.result;
    clauses.push("date <= ?");
    values.push(endDate);
  }

  const rows = db
    .prepare<SqlParams, DailyMetricRow>(`
    SELECT
      id,
      source_key,
      date,
      metric,
      value,
      unit,
      import_id,
      updated_at
    FROM daily_metrics
    WHERE ${clauses.join(" AND ")}
    ORDER BY date ASC, metric ASC
    LIMIT ?
  `)
    .all(...values, filters.limit);

  return successResult({ dailyMetrics: rows.map(dailyMetric) });
}

function listSamples(db: HealthDatabase, params: URLSearchParams): ApiResult {
  const filters = parseCommonFilters(params);
  if (!filters.ok) return filters.result;

  const built = buildIntervalWhereClause(params, {
    exactFilters: [
      ["source_key", "sourceKey"],
      ["type", "type"],
    ],
  });
  if (!built.ok) return built.result;

  const rows = db
    .prepare<SqlParams, SampleRow>(`
    SELECT
      id,
      source_key,
      type,
      start,
      end,
      value,
      unit,
      import_id,
      updated_at
    FROM samples
    ${built.sql}
    ORDER BY start ASC, type ASC
    LIMIT ?
  `)
    .all(...built.values, filters.limit);

  return successResult({ samples: rows.map(sample) });
}

function listWorkouts(db: HealthDatabase, params: URLSearchParams): ApiResult {
  const filters = parseCommonFilters(params);
  if (!filters.ok) return filters.result;

  const built = buildIntervalWhereClause(params, {
    exactFilters: [
      ["source_key", "sourceKey"],
      ["activity_type", "activityType"],
    ],
  });
  if (!built.ok) return built.result;

  const rows = db
    .prepare<SqlParams, WorkoutRow>(`
    SELECT
      id,
      source_key,
      workout_key,
      external_id,
      activity_type,
      start,
      end,
      duration_value,
      duration_unit,
      active_energy_value,
      active_energy_unit,
      distance_value,
      distance_unit,
      import_id,
      updated_at
    FROM workouts
    ${built.sql}
    ORDER BY start ASC, activity_type ASC
    LIMIT ?
  `)
    .all(...built.values, filters.limit);

  return successResult({ workouts: rows.map(workout) });
}

function listSleep(db: HealthDatabase, params: URLSearchParams): ApiResult {
  const filters = parseCommonFilters(params);
  if (!filters.ok) return filters.result;

  const built = buildIntervalWhereClause(params, {
    exactFilters: [
      ["source_key", "sourceKey"],
      ["value", "value"],
    ],
  });
  if (!built.ok) return built.result;

  const rows = db
    .prepare<SqlParams, SleepRow>(`
    SELECT
      id,
      source_key,
      start,
      end,
      value,
      import_id,
      updated_at
    FROM sleep
    ${built.sql}
    ORDER BY start ASC, value ASC
    LIMIT ?
  `)
    .all(...built.values, filters.limit);

  return successResult({ sleep: rows.map(sleep) });
}

function parseCommonFilters(
  params: URLSearchParams,
): { limit: number; ok: true } | { ok: false; result: ApiResult } {
  const limit = params.get("limit");
  if (limit === null) {
    return { limit: DEFAULT_LIMIT, ok: true };
  }

  if (!/^\d+$/.test(limit)) {
    return {
      ok: false,
      result: errorResult(400, "invalid_query", "limit must be a positive integer"),
    };
  }

  const value = Number(limit);
  if (value <= 0 || value > MAX_LIMIT) {
    return {
      ok: false,
      result: errorResult(400, "invalid_query", `limit must be between 1 and ${MAX_LIMIT}`),
    };
  }

  return { limit: value, ok: true };
}

function buildImportWhereClause(
  params: URLSearchParams,
): { ok: true; sql: string; values: unknown[] } | { ok: false; result: ApiResult } {
  const clauses = ["1 = 1"];
  const values: unknown[] = [];
  addExactFilter(clauses, values, "source_key", params.get("sourceKey"));

  const start = params.get("start");
  if (start !== null) {
    const result = validateDateTime(start, "start");
    if (!result.ok) return result;
    clauses.push("range_end > ?");
    values.push(start);
  }

  const end = params.get("end");
  if (end !== null) {
    const result = validateDateTime(end, "end");
    if (!result.ok) return result;
    clauses.push("range_start < ?");
    values.push(end);
  }

  return { ok: true, sql: `WHERE ${clauses.join(" AND ")}`, values };
}

function buildIntervalWhereClause(
  params: URLSearchParams,
  options: { exactFilters: Array<[column: string, queryParam: string]> },
): { ok: true; sql: string; values: unknown[] } | { ok: false; result: ApiResult } {
  const clauses = ["1 = 1"];
  const values: unknown[] = [];
  for (const [column, queryParam] of options.exactFilters) {
    addExactFilter(clauses, values, column, params.get(queryParam));
  }

  const start = params.get("start");
  if (start !== null) {
    const result = validateDateTime(start, "start");
    if (!result.ok) return result;
    clauses.push("end > ?");
    values.push(start);
  }

  const end = params.get("end");
  if (end !== null) {
    const result = validateDateTime(end, "end");
    if (!result.ok) return result;
    clauses.push("start < ?");
    values.push(end);
  }

  return { ok: true, sql: `WHERE ${clauses.join(" AND ")}`, values };
}

function addExactFilter(
  clauses: string[],
  values: unknown[],
  column: string,
  value: string | null,
): void {
  if (value === null || value.trim() === "") return;
  clauses.push(`${column} = ?`);
  values.push(value);
}

function validateDateTime(
  value: string,
  name: string,
): { ok: true } | { ok: false; result: ApiResult } {
  if (Number.isNaN(Date.parse(value))) {
    return {
      ok: false,
      result: errorResult(400, "invalid_query", `${name} must be a valid date/time string`),
    };
  }

  return { ok: true };
}

function validateDate(
  value: string,
  name: string,
): { ok: true } | { ok: false; result: ApiResult } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, result: errorResult(400, "invalid_query", `${name} must be YYYY-MM-DD`) };
  }

  return { ok: true };
}

function importMetadata(row: ImportMetadataRow) {
  return {
    createdAt: row.created_at,
    generatedAt: row.generated_at,
    id: row.id,
    payloadHash: row.payload_hash,
    range: {
      calendar: row.range_calendar,
      end: row.range_end,
      kind: row.range_kind,
      start: row.range_start,
      timeZone: row.range_time_zone,
    },
    schemaVersion: row.schema_version,
    source: importSource(row),
    sourceKey: row.source_key,
    updatedAt: row.updated_at,
  };
}

function importSource(
  row: Pick<
    ImportMetadataRow,
    "source_app" | "source_bundle_identifier" | "source_device_identifier" | "source_device_name"
  >,
) {
  const source: Record<string, string> = {};
  if (row.source_app !== null) source.app = row.source_app;
  if (row.source_bundle_identifier !== null) source.bundleIdentifier = row.source_bundle_identifier;
  if (row.source_device_identifier !== null) source.deviceIdentifier = row.source_device_identifier;
  if (row.source_device_name !== null) source.deviceName = row.source_device_name;
  return source;
}

function dailyMetric(row: DailyMetricRow) {
  return {
    date: row.date,
    id: row.id,
    importId: row.import_id,
    metric: row.metric,
    sourceKey: row.source_key,
    unit: row.unit,
    updatedAt: row.updated_at,
    value: row.value,
  };
}

function sample(row: SampleRow) {
  return {
    end: row.end,
    id: row.id,
    importId: row.import_id,
    sourceKey: row.source_key,
    start: row.start,
    type: row.type,
    unit: row.unit,
    updatedAt: row.updated_at,
    value: row.value,
  };
}

function workout(row: WorkoutRow) {
  return {
    activeEnergy: quantity(row.active_energy_value, row.active_energy_unit),
    activityType: row.activity_type,
    distance: quantity(row.distance_value, row.distance_unit),
    duration: quantity(row.duration_value, row.duration_unit),
    end: row.end,
    externalId: row.external_id,
    id: row.id,
    importId: row.import_id,
    sourceKey: row.source_key,
    start: row.start,
    updatedAt: row.updated_at,
    workoutKey: row.workout_key,
  };
}

function sleep(row: SleepRow) {
  return {
    end: row.end,
    id: row.id,
    importId: row.import_id,
    sourceKey: row.source_key,
    start: row.start,
    updatedAt: row.updated_at,
    value: row.value,
  };
}

function quantity(
  value: number | null,
  unit: string | null,
): { unit: string; value: number } | null {
  if (value === null || unit === null) return null;
  return { unit, value };
}

function successResult(body: Record<string, unknown>): ApiResult {
  return { body, status: 200 };
}

function errorResult(status: number, category: string, message: string): ApiResult {
  return {
    body: {
      error: { category, message },
      ok: false,
    },
    status,
  };
}
