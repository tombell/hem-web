import { createHash } from "node:crypto";

import type { HealthDatabase } from "./db";
import { type HealthPayload, type QuantityValue, getSourceKey, isQuantityValue } from "./payload";

export interface ImportCounts {
  dailyMetrics: number;
  samples: number;
  sleep: number;
  workouts: number;
}

export interface ImportResult {
  counts: ImportCounts;
  importId: number;
  payloadHash: string;
  sourceKey: string;
  status: "created" | "duplicate" | "replaced";
}

interface ExistingImport {
  id: number;
  payload_hash: string;
}

type PreparedStatements = ReturnType<typeof prepareStatements>;

export function importHealthPayload(
  db: HealthDatabase,
  payload: HealthPayload,
  rawJson: string,
  hashInput: unknown = payload,
): ImportResult {
  const payloadHash = sha256Hex(stableStringify(hashInput));
  const sourceKey = getSourceKey(payload);
  const counts = countPayloadFacts(payload);

  const tx = db.transaction((): ImportResult => {
    const existing = db
      .prepare<[number, string, string, string], ExistingImport>(`
        SELECT id, payload_hash
        FROM imports
        WHERE schema_version = ?
          AND range_start = ?
          AND range_end = ?
          AND source_key = ?
      `)
      .get(payload.schemaVersion, payload.range.start, payload.range.end, sourceKey);

    if (existing && existing.payload_hash === payloadHash) {
      return {
        counts,
        importId: existing.id,
        payloadHash,
        sourceKey,
        status: "duplicate",
      };
    }

    const now = new Date().toISOString();
    const importId = existing
      ? replaceImport(db, existing.id, payload, sourceKey, payloadHash, rawJson, now)
      : createImport(db, payload, sourceKey, payloadHash, rawJson, now);

    if (existing) {
      deleteFactsForImport(db, importId);
    }

    insertNormalizedFacts(db, importId, sourceKey, payload, now);

    return {
      counts,
      importId,
      payloadHash,
      sourceKey,
      status: existing ? "replaced" : "created",
    };
  });

  return tx();
}

function createImport(
  db: HealthDatabase,
  payload: HealthPayload,
  sourceKey: string,
  payloadHash: string,
  rawJson: string,
  now: string,
): number {
  const result = db
    .prepare(`
      INSERT INTO imports (
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      payload.schemaVersion,
      payload.range.start,
      payload.range.end,
      payload.range.kind,
      payload.range.calendar,
      payload.range.timeZone,
      sourceKey,
      payload.source.app ?? null,
      payload.source.bundleIdentifier ?? null,
      payload.source.deviceIdentifier ?? null,
      payload.source.deviceName ?? null,
      payload.generatedAt,
      payloadHash,
      rawJson,
      now,
      now,
    );

  return Number(result.lastInsertRowid);
}

function replaceImport(
  db: HealthDatabase,
  importId: number,
  payload: HealthPayload,
  sourceKey: string,
  payloadHash: string,
  rawJson: string,
  now: string,
): number {
  db.prepare(`
    UPDATE imports
    SET
      range_kind = ?,
      range_calendar = ?,
      range_time_zone = ?,
      source_app = ?,
      source_bundle_identifier = ?,
      source_device_identifier = ?,
      source_device_name = ?,
      generated_at = ?,
      payload_hash = ?,
      raw_json = ?,
      updated_at = ?
    WHERE id = ?
      AND schema_version = ?
      AND range_start = ?
      AND range_end = ?
      AND source_key = ?
  `).run(
    payload.range.kind,
    payload.range.calendar,
    payload.range.timeZone,
    payload.source.app ?? null,
    payload.source.bundleIdentifier ?? null,
    payload.source.deviceIdentifier ?? null,
    payload.source.deviceName ?? null,
    payload.generatedAt,
    payloadHash,
    rawJson,
    now,
    importId,
    payload.schemaVersion,
    payload.range.start,
    payload.range.end,
    sourceKey,
  );

  return importId;
}

function deleteFactsForImport(db: HealthDatabase, importId: number): void {
  db.prepare("DELETE FROM daily_metrics WHERE import_id = ?").run(importId);
  db.prepare("DELETE FROM samples WHERE import_id = ?").run(importId);
  db.prepare("DELETE FROM workouts WHERE import_id = ?").run(importId);
  db.prepare("DELETE FROM sleep WHERE import_id = ?").run(importId);
}

function insertNormalizedFacts(
  db: HealthDatabase,
  importId: number,
  sourceKey: string,
  payload: HealthPayload,
  now: string,
): void {
  const statements = prepareStatements(db);

  insertDailyMetrics(statements, importId, sourceKey, payload, now);
  insertSamples(statements, importId, sourceKey, payload, now);
  insertWorkouts(statements, importId, sourceKey, payload, now);
  insertSleep(statements, importId, sourceKey, payload, now);
}

function prepareStatements(db: HealthDatabase) {
  return {
    upsertDailyMetric: db.prepare(`
    INSERT INTO daily_metrics (
      source_key,
      date,
      metric,
      value,
      unit,
      import_id,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source_key, date, metric)
    DO UPDATE SET
      value = excluded.value,
      unit = excluded.unit,
      import_id = excluded.import_id,
      updated_at = excluded.updated_at
  `),

    upsertSample: db.prepare(`
    INSERT INTO samples (
      source_key,
      type,
      start,
      end,
      value,
      unit,
      import_id,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source_key, type, start, end, unit)
    DO UPDATE SET
      value = excluded.value,
      import_id = excluded.import_id,
      updated_at = excluded.updated_at
  `),

    upsertWorkout: db.prepare(`
    INSERT INTO workouts (
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
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source_key, workout_key)
    DO UPDATE SET
      external_id = excluded.external_id,
      activity_type = excluded.activity_type,
      start = excluded.start,
      end = excluded.end,
      duration_value = excluded.duration_value,
      duration_unit = excluded.duration_unit,
      active_energy_value = excluded.active_energy_value,
      active_energy_unit = excluded.active_energy_unit,
      distance_value = excluded.distance_value,
      distance_unit = excluded.distance_unit,
      import_id = excluded.import_id,
      updated_at = excluded.updated_at
  `),

    upsertSleep: db.prepare(`
    INSERT INTO sleep (
      source_key,
      start,
      end,
      value,
      import_id,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source_key, start, end, value)
    DO UPDATE SET
      import_id = excluded.import_id,
      updated_at = excluded.updated_at
  `),
  };
}

function insertDailyMetrics(
  statements: PreparedStatements,
  importId: number,
  sourceKey: string,
  payload: HealthPayload,
  now: string,
): void {
  for (const dailyMetric of payload.dailyMetrics) {
    for (const [metric, quantity] of Object.entries(dailyMetric)) {
      if (metric === "date" || !isQuantityValue(quantity)) continue;
      statements.upsertDailyMetric.run(
        sourceKey,
        dailyMetric.date,
        metric,
        quantity.value,
        quantity.unit,
        importId,
        now,
        now,
      );
    }
  }
}

function insertSamples(
  statements: PreparedStatements,
  importId: number,
  sourceKey: string,
  payload: HealthPayload,
  now: string,
): void {
  for (const sample of payload.samples) {
    statements.upsertSample.run(
      sourceKey,
      sample.type,
      sample.start,
      sample.end,
      sample.value,
      sample.unit,
      importId,
      now,
      now,
    );
  }
}

function insertWorkouts(
  statements: PreparedStatements,
  importId: number,
  sourceKey: string,
  payload: HealthPayload,
  now: string,
): void {
  for (const workout of payload.workouts) {
    const workoutKey =
      workout.id?.trim() || `${workout.activityType}:${workout.start}:${workout.end}`;
    statements.upsertWorkout.run(
      sourceKey,
      workoutKey,
      workout.id ?? null,
      workout.activityType,
      workout.start,
      workout.end,
      quantityValue(workout.duration),
      quantityUnit(workout.duration),
      quantityValue(workout.activeEnergy),
      quantityUnit(workout.activeEnergy),
      quantityValue(workout.distance),
      quantityUnit(workout.distance),
      importId,
      now,
      now,
    );
  }
}

function insertSleep(
  statements: PreparedStatements,
  importId: number,
  sourceKey: string,
  payload: HealthPayload,
  now: string,
): void {
  for (const sleep of payload.sleep) {
    statements.upsertSleep.run(sourceKey, sleep.start, sleep.end, sleep.value, importId, now, now);
  }
}

function countPayloadFacts(payload: HealthPayload): ImportCounts {
  const dailyMetrics = payload.dailyMetrics.reduce((count, dailyMetric) => {
    return count + Object.values(dailyMetric).filter(isQuantityValue).length;
  }, 0);

  return {
    dailyMetrics,
    samples: payload.samples.length,
    sleep: payload.sleep.length,
    workouts: payload.workouts.length,
  };
}

function quantityValue(quantity: QuantityValue | undefined): number | null {
  return quantity?.value ?? null;
}

function quantityUnit(quantity: QuantityValue | undefined): string | null {
  return quantity?.unit ?? null;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}
