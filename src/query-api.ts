import { parseIsoDate, parseRfc3339 } from "./date-time";
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

interface PaginatedImportMetadataRow extends ImportMetadataRow {
  range_start_ms: number;
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
  external_id: string | null;
  id: number;
  import_id: number;
  source_key: string;
  start: string;
  start_ms: number;
  type: string;
  unit: string;
  updated_at: string;
  value: number;
}

interface CategorySampleRow {
  end: string;
  external_id: string | null;
  id: number;
  import_id: number;
  source_key: string;
  start: string;
  start_ms: number;
  type: string;
  updated_at: string;
  value: string;
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
  start_ms: number;
  updated_at: string;
  workout_key: string;
}

interface SleepRow {
  end: string;
  external_id: string | null;
  id: number;
  import_id: number;
  source_key: string;
  start: string;
  start_ms: number;
  updated_at: string;
  value: string;
}

type SqlParams = unknown[];

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5_000;

type CursorEndpoint =
  | "category-samples"
  | "daily-metrics"
  | "imports"
  | "samples"
  | "sleep"
  | "sources"
  | "workouts";
type CursorValue = number | string;

interface ParsedPagination {
  cursor: CursorValue[] | undefined;
  limit: number;
}

export function handleHealthQueryRequest(db: HealthDatabase, url: URL): ApiResult {
  if (url.pathname === "/apple-health/sources") {
    return listSources(db, url.searchParams);
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

  if (url.pathname === "/apple-health/category-samples") {
    return listCategorySamples(db, url.searchParams);
  }

  if (url.pathname === "/apple-health/workouts") {
    return listWorkouts(db, url.searchParams);
  }

  if (url.pathname === "/apple-health/sleep") {
    return listSleep(db, url.searchParams);
  }

  return errorResult(404, "not_found", "Not found");
}

function listSources(db: HealthDatabase, params: URLSearchParams): ApiResult {
  const pagination = parsePagination(params, "sources", ["string"]);
  if (!pagination.ok) return pagination.result;

  const cursorClause = pagination.value.cursor ? "WHERE source_key > ?" : "";
  const cursorValues = pagination.value.cursor ?? [];
  const rows = db
    .prepare<SqlParams, SourceRow>(`
    WITH source_stats AS (
      SELECT
        source_key,
        COUNT(*) AS import_count,
        MIN(created_at) AS first_imported_at,
        MAX(updated_at) AS last_imported_at
      FROM imports
      ${cursorClause}
      GROUP BY source_key
    )
    SELECT
      source_stats.source_key,
      latest.source_app,
      latest.source_bundle_identifier,
      latest.source_device_identifier,
      latest.source_device_name,
      source_stats.import_count,
      source_stats.first_imported_at,
      source_stats.last_imported_at
    FROM source_stats
    JOIN imports AS latest ON latest.id = (
      SELECT candidate.id
      FROM imports AS candidate
      WHERE candidate.source_key = source_stats.source_key
      ORDER BY candidate.updated_at DESC, candidate.id DESC
      LIMIT 1
    )
    ORDER BY source_stats.source_key ASC
    LIMIT ?
  `)
    .all(...cursorValues, pagination.value.limit + 1);

  return paginatedResult(
    "sources",
    rows,
    pagination.value.limit,
    (row) => [row.source_key],
    (page) => ({
      sources: page.map((row) => ({
        firstImportedAt: row.first_imported_at,
        importCount: row.import_count,
        lastImportedAt: row.last_imported_at,
        source: importSource(row),
        sourceKey: row.source_key,
      })),
    }),
  );
}

function listImports(db: HealthDatabase, params: URLSearchParams): ApiResult {
  const pagination = parsePagination(params, "imports", ["number", "number"]);
  if (!pagination.ok) return pagination.result;

  const built = buildImportWhereClause(params, pagination.value.cursor);
  if (!built.ok) return built.result;

  const rows = db
    .prepare<SqlParams, PaginatedImportMetadataRow>(`
    SELECT
      id,
      schema_version,
      range_start,
      range_end,
      range_start_ms,
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
    ORDER BY range_start_ms DESC, id DESC
    LIMIT ?
  `)
    .all(...built.values, pagination.value.limit + 1);

  return paginatedResult(
    "imports",
    rows,
    pagination.value.limit,
    (row) => [row.range_start_ms, row.id],
    (page) => ({ imports: page.map(importMetadata) }),
  );
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
  const pagination = parsePagination(params, "daily-metrics", ["string", "string", "number"]);
  if (!pagination.ok) return pagination.result;

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

  if (pagination.value.cursor) {
    clauses.push("(date, metric, id) > (?, ?, ?)");
    values.push(...pagination.value.cursor);
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
    ORDER BY date ASC, metric ASC, id ASC
    LIMIT ?
  `)
    .all(...values, pagination.value.limit + 1);

  return paginatedResult(
    "daily-metrics",
    rows,
    pagination.value.limit,
    (row) => [row.date, row.metric, row.id],
    (page) => ({ dailyMetrics: page.map(dailyMetric) }),
  );
}

function listSamples(db: HealthDatabase, params: URLSearchParams): ApiResult {
  const pagination = parsePagination(params, "samples", ["number", "string", "number"]);
  if (!pagination.ok) return pagination.result;

  const built = buildIntervalWhereClause(params, {
    cursor: pagination.value.cursor,
    cursorSql: "(start_ms, type, id) > (?, ?, ?)",
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
      external_id,
      start,
      start_ms,
      end,
      value,
      unit,
      import_id,
      updated_at
    FROM samples
    ${built.sql}
    ORDER BY start_ms ASC, type ASC, id ASC
    LIMIT ?
  `)
    .all(...built.values, pagination.value.limit + 1);

  return paginatedResult(
    "samples",
    rows,
    pagination.value.limit,
    (row) => [row.start_ms, row.type, row.id],
    (page) => ({ samples: page.map(sample) }),
  );
}

function listCategorySamples(db: HealthDatabase, params: URLSearchParams): ApiResult {
  const pagination = parsePagination(params, "category-samples", [
    "number",
    "string",
    "string",
    "number",
  ]);
  if (!pagination.ok) return pagination.result;

  const built = buildIntervalWhereClause(params, {
    cursor: pagination.value.cursor,
    cursorSql: "(start_ms, type, value, id) > (?, ?, ?, ?)",
    exactFilters: [
      ["source_key", "sourceKey"],
      ["type", "type"],
      ["value", "value"],
    ],
  });
  if (!built.ok) return built.result;

  const rows = db
    .prepare<SqlParams, CategorySampleRow>(`
    SELECT
      id,
      source_key,
      type,
      external_id,
      start,
      start_ms,
      end,
      value,
      import_id,
      updated_at
    FROM category_samples
    ${built.sql}
    ORDER BY start_ms ASC, type ASC, value ASC, id ASC
    LIMIT ?
  `)
    .all(...built.values, pagination.value.limit + 1);

  return paginatedResult(
    "category-samples",
    rows,
    pagination.value.limit,
    (row) => [row.start_ms, row.type, row.value, row.id],
    (page) => ({ categorySamples: page.map(categorySample) }),
  );
}

function listWorkouts(db: HealthDatabase, params: URLSearchParams): ApiResult {
  const pagination = parsePagination(params, "workouts", ["number", "string", "number"]);
  if (!pagination.ok) return pagination.result;

  const built = buildIntervalWhereClause(params, {
    cursor: pagination.value.cursor,
    cursorSql: "(start_ms, activity_type, id) > (?, ?, ?)",
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
      start_ms,
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
    ORDER BY start_ms ASC, activity_type ASC, id ASC
    LIMIT ?
  `)
    .all(...built.values, pagination.value.limit + 1);

  return paginatedResult(
    "workouts",
    rows,
    pagination.value.limit,
    (row) => [row.start_ms, row.activity_type, row.id],
    (page) => ({ workouts: page.map(workout) }),
  );
}

function listSleep(db: HealthDatabase, params: URLSearchParams): ApiResult {
  const pagination = parsePagination(params, "sleep", ["number", "string", "number"]);
  if (!pagination.ok) return pagination.result;

  const built = buildIntervalWhereClause(params, {
    cursor: pagination.value.cursor,
    cursorSql: "(start_ms, value, id) > (?, ?, ?)",
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
      external_id,
      start,
      start_ms,
      end,
      value,
      import_id,
      updated_at
    FROM sleep
    ${built.sql}
    ORDER BY start_ms ASC, value ASC, id ASC
    LIMIT ?
  `)
    .all(...built.values, pagination.value.limit + 1);

  return paginatedResult(
    "sleep",
    rows,
    pagination.value.limit,
    (row) => [row.start_ms, row.value, row.id],
    (page) => ({ sleep: page.map(sleep) }),
  );
}

function parsePagination(
  params: URLSearchParams,
  endpoint: CursorEndpoint,
  valueTypes: Array<"number" | "string">,
): { ok: true; value: ParsedPagination } | { ok: false; result: ApiResult } {
  const rawLimit = params.get("limit");
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) {
      return {
        ok: false,
        result: errorResult(400, "invalid_query", "limit must be a positive integer"),
      };
    }

    limit = Number(rawLimit);
    if (limit <= 0 || limit > MAX_LIMIT) {
      return {
        ok: false,
        result: errorResult(400, "invalid_query", `limit must be between 1 and ${MAX_LIMIT}`),
      };
    }
  }

  const rawCursor = params.get("cursor");
  if (rawCursor === null) return { ok: true, value: { cursor: undefined, limit } };

  try {
    const decoded = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8")) as unknown;
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("endpoint" in decoded) ||
      decoded.endpoint !== endpoint ||
      !("version" in decoded) ||
      decoded.version !== 1 ||
      !("values" in decoded) ||
      !Array.isArray(decoded.values) ||
      decoded.values.length !== valueTypes.length ||
      decoded.values.some(
        (value, index) =>
          typeof value !== valueTypes[index] ||
          (typeof value === "number" && !Number.isFinite(value)),
      )
    ) {
      throw new Error("Invalid cursor");
    }

    return { ok: true, value: { cursor: decoded.values as CursorValue[], limit } };
  } catch {
    return {
      ok: false,
      result: errorResult(400, "invalid_query", "cursor is invalid for this endpoint"),
    };
  }
}

function buildImportWhereClause(
  params: URLSearchParams,
  cursor: CursorValue[] | undefined,
): { ok: true; sql: string; values: unknown[] } | { ok: false; result: ApiResult } {
  const clauses = ["1 = 1"];
  const values: unknown[] = [];
  addExactFilter(clauses, values, "source_key", params.get("sourceKey"));

  const start = params.get("start");
  if (start !== null) {
    const result = validateDateTime(start, "start");
    if (!result.ok) return result;
    clauses.push("range_end_ms > ?");
    values.push(result.value);
  }

  const end = params.get("end");
  if (end !== null) {
    const result = validateDateTime(end, "end");
    if (!result.ok) return result;
    clauses.push("range_start_ms < ?");
    values.push(result.value);
  }

  if (cursor) {
    clauses.push("(range_start_ms, id) < (?, ?)");
    values.push(...cursor);
  }

  return { ok: true, sql: `WHERE ${clauses.join(" AND ")}`, values };
}

function buildIntervalWhereClause(
  params: URLSearchParams,
  options: {
    cursor: CursorValue[] | undefined;
    cursorSql: string;
    exactFilters: Array<[column: string, queryParam: string]>;
  },
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
    clauses.push("end_ms > ?");
    values.push(result.value);
  }

  const end = params.get("end");
  if (end !== null) {
    const result = validateDateTime(end, "end");
    if (!result.ok) return result;
    clauses.push("start_ms < ?");
    values.push(result.value);
  }

  if (options.cursor) {
    clauses.push(options.cursorSql);
    values.push(...options.cursor);
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
): { ok: true; value: number } | { ok: false; result: ApiResult } {
  const epochMilliseconds = parseRfc3339(value);
  if (epochMilliseconds === undefined) {
    return {
      ok: false,
      result: errorResult(400, "invalid_query", `${name} must be an RFC 3339 timestamp`),
    };
  }

  return { ok: true, value: epochMilliseconds };
}

function validateDate(
  value: string,
  name: string,
): { ok: true } | { ok: false; result: ApiResult } {
  if (!parseIsoDate(value)) {
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
    externalId: row.external_id,
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

function categorySample(row: CategorySampleRow) {
  return {
    end: row.end,
    externalId: row.external_id,
    id: row.id,
    importId: row.import_id,
    sourceKey: row.source_key,
    start: row.start,
    type: row.type,
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
    externalId: row.external_id,
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

function paginatedResult<Row>(
  endpoint: CursorEndpoint,
  rows: Row[],
  limit: number,
  cursorValues: (row: Row) => CursorValue[],
  body: (page: Row[]) => Record<string, unknown>,
): ApiResult {
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const lastRow = page.at(-1);
  const nextCursor =
    hasMore && lastRow
      ? Buffer.from(
          JSON.stringify({ endpoint, values: cursorValues(lastRow), version: 1 }),
        ).toString("base64url")
      : null;

  return successResult({ ...body(page), hasMore, nextCursor });
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
