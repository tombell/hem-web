import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database, { type Database as HealthDatabase } from "better-sqlite3";

import { parseRfc3339 } from "./date-time.ts";

export type { HealthDatabase };

export const LATEST_DATABASE_VERSION = 5;

interface DatabaseMigration {
  migrate: (db: HealthDatabase) => void;
  version: number;
}

export function openDatabase(dbPath: string): HealthDatabase {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  try {
    configureDatabase(db);
    migrateDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function configureDatabase(db: HealthDatabase): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
}

export function migrateDatabase(db: HealthDatabase, targetVersion = LATEST_DATABASE_VERSION): void {
  if (targetVersion < 0 || targetVersion > LATEST_DATABASE_VERSION) {
    throw new Error(`Unsupported target database version ${targetVersion}`);
  }

  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  if (currentVersion > LATEST_DATABASE_VERSION) {
    throw new Error(
      `Database version ${currentVersion} is newer than supported version ${LATEST_DATABASE_VERSION}`,
    );
  }

  let migratedVersion = currentVersion;
  for (const migration of DATABASE_MIGRATIONS) {
    if (migration.version <= migratedVersion) continue;
    if (migration.version > targetVersion) break;
    if (migration.version !== migratedVersion + 1) {
      throw new Error(`Missing database migration after version ${migratedVersion}`);
    }

    db.transaction(() => {
      migration.migrate(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
    migratedVersion = migration.version;
  }

  if (migratedVersion !== targetVersion) {
    throw new Error(`Missing database migration after version ${migratedVersion}`);
  }
}

const DATABASE_MIGRATIONS: DatabaseMigration[] = [
  {
    version: 1,
    migrate: (db) =>
      db.exec(`
      CREATE TABLE IF NOT EXISTS imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schema_version INTEGER NOT NULL,
        range_start TEXT NOT NULL,
        range_end TEXT NOT NULL,
        range_kind TEXT NOT NULL,
        range_calendar TEXT NOT NULL,
        range_time_zone TEXT NOT NULL,
        source_key TEXT NOT NULL,
        source_app TEXT,
        source_bundle_identifier TEXT,
        source_device_identifier TEXT,
        source_device_name TEXT,
        generated_at TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (schema_version, range_start, range_end, source_key)
      );

      CREATE TABLE IF NOT EXISTS daily_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL,
        date TEXT NOT NULL,
        metric TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT NOT NULL,
        import_id INTEGER NOT NULL REFERENCES imports(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (source_key, date, metric)
      );

      CREATE TABLE IF NOT EXISTS samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL,
        type TEXT NOT NULL,
        start TEXT NOT NULL,
        end TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT NOT NULL,
        import_id INTEGER NOT NULL REFERENCES imports(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (source_key, type, start, end, unit)
      );

      CREATE TABLE IF NOT EXISTS category_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL,
        type TEXT NOT NULL,
        start TEXT NOT NULL,
        end TEXT NOT NULL,
        value TEXT NOT NULL,
        import_id INTEGER NOT NULL REFERENCES imports(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (source_key, type, start, end, value)
      );

      CREATE TABLE IF NOT EXISTS workouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL,
        workout_key TEXT NOT NULL,
        external_id TEXT,
        activity_type TEXT NOT NULL,
        start TEXT NOT NULL,
        end TEXT NOT NULL,
        duration_value REAL,
        duration_unit TEXT,
        active_energy_value REAL,
        active_energy_unit TEXT,
        distance_value REAL,
        distance_unit TEXT,
        import_id INTEGER NOT NULL REFERENCES imports(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (source_key, workout_key)
      );

      CREATE TABLE IF NOT EXISTS sleep (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL,
        start TEXT NOT NULL,
        end TEXT NOT NULL,
        value TEXT NOT NULL,
        import_id INTEGER NOT NULL REFERENCES imports(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (source_key, start, end, value)
      );

      CREATE INDEX IF NOT EXISTS imports_source_range_idx
      ON imports (source_key, range_start, range_end, id);

      CREATE INDEX IF NOT EXISTS daily_metrics_source_metric_date_idx
      ON daily_metrics (source_key, metric, date);

      CREATE INDEX IF NOT EXISTS samples_source_type_interval_idx
      ON samples (source_key, type, start, end);

      CREATE INDEX IF NOT EXISTS category_samples_source_type_value_interval_idx
      ON category_samples (source_key, type, value, start, end);

      CREATE INDEX IF NOT EXISTS workouts_source_activity_interval_idx
      ON workouts (source_key, activity_type, start, end);

      CREATE INDEX IF NOT EXISTS sleep_source_value_interval_idx
      ON sleep (source_key, value, start, end);
    `),
  },
  {
    version: 2,
    migrate: addNormalizedTimestampColumns,
  },
  {
    version: 3,
    migrate: addStableRecordIdentifiers,
  },
  {
    version: 4,
    migrate: addPaginationIndexes,
  },
  {
    version: 5,
    migrate: addLatestSourceIndex,
  },
];

function addLatestSourceIndex(db: HealthDatabase): void {
  db.exec(`
    CREATE INDEX imports_source_updated_idx
    ON imports (source_key, updated_at DESC, id DESC);
  `);
}

function addPaginationIndexes(db: HealthDatabase): void {
  db.exec(`
    CREATE INDEX imports_page_idx
    ON imports (range_start_ms DESC, id DESC);

    CREATE INDEX daily_metrics_page_idx
    ON daily_metrics (date, metric, id);

    CREATE INDEX samples_page_idx
    ON samples (start_ms, type, id);

    CREATE INDEX category_samples_page_idx
    ON category_samples (start_ms, type, value, id);

    CREATE INDEX workouts_page_idx
    ON workouts (start_ms, activity_type, id);

    CREATE INDEX sleep_page_idx
    ON sleep (start_ms, value, id);
  `);
}

function addStableRecordIdentifiers(db: HealthDatabase): void {
  db.exec(`
    ALTER TABLE samples ADD COLUMN external_id TEXT;
    ALTER TABLE category_samples ADD COLUMN external_id TEXT;
    ALTER TABLE sleep ADD COLUMN external_id TEXT;

    CREATE UNIQUE INDEX samples_source_external_id_idx
    ON samples (source_key, external_id)
    WHERE external_id IS NOT NULL;

    CREATE UNIQUE INDEX category_samples_source_external_id_idx
    ON category_samples (source_key, external_id)
    WHERE external_id IS NOT NULL;

    CREATE UNIQUE INDEX sleep_source_external_id_idx
    ON sleep (source_key, external_id)
    WHERE external_id IS NOT NULL;
  `);
}

function addNormalizedTimestampColumns(db: HealthDatabase): void {
  db.exec(`
    ALTER TABLE imports ADD COLUMN range_start_ms INTEGER;
    ALTER TABLE imports ADD COLUMN range_end_ms INTEGER;
    ALTER TABLE samples ADD COLUMN start_ms INTEGER;
    ALTER TABLE samples ADD COLUMN end_ms INTEGER;
    ALTER TABLE category_samples ADD COLUMN start_ms INTEGER;
    ALTER TABLE category_samples ADD COLUMN end_ms INTEGER;
    ALTER TABLE workouts ADD COLUMN start_ms INTEGER;
    ALTER TABLE workouts ADD COLUMN end_ms INTEGER;
    ALTER TABLE sleep ADD COLUMN start_ms INTEGER;
    ALTER TABLE sleep ADD COLUMN end_ms INTEGER;
  `);

  backfillTimestampColumns(db, "imports", ["range_start", "range_end"]);
  backfillTimestampColumns(db, "samples", ["start", "end"]);
  backfillTimestampColumns(db, "category_samples", ["start", "end"]);
  backfillTimestampColumns(db, "workouts", ["start", "end"]);
  backfillTimestampColumns(db, "sleep", ["start", "end"]);

  db.exec(`
    DROP INDEX IF EXISTS imports_source_range_idx;
    DROP INDEX IF EXISTS samples_source_type_interval_idx;
    DROP INDEX IF EXISTS category_samples_source_type_value_interval_idx;
    DROP INDEX IF EXISTS workouts_source_activity_interval_idx;
    DROP INDEX IF EXISTS sleep_source_value_interval_idx;

    CREATE INDEX imports_source_range_idx
    ON imports (source_key, range_start_ms, range_end_ms, id);

    CREATE INDEX samples_source_type_interval_idx
    ON samples (source_key, type, start_ms, end_ms);

    CREATE INDEX category_samples_source_type_value_interval_idx
    ON category_samples (source_key, type, value, start_ms, end_ms);

    CREATE INDEX workouts_source_activity_interval_idx
    ON workouts (source_key, activity_type, start_ms, end_ms);

    CREATE INDEX sleep_source_value_interval_idx
    ON sleep (source_key, value, start_ms, end_ms);
  `);
}

function backfillTimestampColumns(db: HealthDatabase, table: string, columns: string[]): void {
  const rows = db
    .prepare<[], Record<string, number | string>>(`SELECT id, ${columns.join(", ")} FROM ${table}`)
    .all();
  const update = db.prepare(
    `UPDATE ${table} SET ${columns.map((column) => `${column}_ms = ?`).join(", ")} WHERE id = ?`,
  );

  for (const row of rows) {
    const timestamps = columns.map((column) => {
      const rawValue = row[column];
      const value = typeof rawValue === "string" ? parseRfc3339(rawValue) : undefined;
      if (value === undefined) {
        throw new Error(`Cannot migrate invalid timestamp in ${table}.${column} for row ${row.id}`);
      }
      return value;
    });
    update.run(...timestamps, row.id);
  }
}
