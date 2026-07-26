import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database, { type Database as HealthDatabase } from "better-sqlite3";

export type { HealthDatabase };

export const LATEST_DATABASE_VERSION = 1;

interface DatabaseMigration {
  sql: string;
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

function migrateDatabase(db: HealthDatabase): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  if (currentVersion > LATEST_DATABASE_VERSION) {
    throw new Error(
      `Database version ${currentVersion} is newer than supported version ${LATEST_DATABASE_VERSION}`,
    );
  }

  let migratedVersion = currentVersion;
  for (const migration of DATABASE_MIGRATIONS) {
    if (migration.version <= migratedVersion) continue;
    if (migration.version !== migratedVersion + 1) {
      throw new Error(`Missing database migration after version ${migratedVersion}`);
    }

    db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    })();
    migratedVersion = migration.version;
  }

  if (migratedVersion !== LATEST_DATABASE_VERSION) {
    throw new Error(`Missing database migration after version ${migratedVersion}`);
  }
}

const DATABASE_MIGRATIONS: DatabaseMigration[] = [
  {
    version: 1,
    sql: `
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
    `,
  },
];
