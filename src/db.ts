import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database, { type Database as HealthDatabase } from "better-sqlite3";

export type { HealthDatabase };

export function openDatabase(dbPath: string): HealthDatabase {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  configureDatabase(db);
  migrateDatabase(db);
  return db;
}

function configureDatabase(db: HealthDatabase): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
}

function migrateDatabase(db: HealthDatabase): void {
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
    )
  `);

  db.exec(`
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
    )
  `);

  db.exec(`
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
    )
  `);

  db.exec(`
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
    )
  `);

  db.exec(`
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
    )
  `);

  db.exec(`
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
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS imports_source_range_idx
    ON imports (source_key, range_start, range_end, id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS daily_metrics_source_metric_date_idx
    ON daily_metrics (source_key, metric, date)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS samples_source_type_interval_idx
    ON samples (source_key, type, start, end)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS category_samples_source_type_value_interval_idx
    ON category_samples (source_key, type, value, start, end)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS workouts_source_activity_interval_idx
    ON workouts (source_key, activity_type, start, end)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS sleep_source_value_interval_idx
    ON sleep (source_key, value, start, end)
  `);
}
