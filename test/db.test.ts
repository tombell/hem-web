import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

import {
  LATEST_DATABASE_VERSION,
  migrateDatabase,
  openDatabase,
  type HealthDatabase,
} from "../src/db";

let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) rmSync(temporaryDirectory, { force: true, recursive: true });
  temporaryDirectory = undefined;
});

describe("database migrations", () => {
  test("migrates a new database to the latest version", () => {
    const db = openDatabase(temporaryDatabasePath());

    expect(db.pragma("user_version", { simple: true })).toBe(LATEST_DATABASE_VERSION);
    expect(
      db
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'imports'",
        )
        .get(),
    ).toEqual({ name: "imports" });

    db.close();
  });

  test.each(Array.from({ length: LATEST_DATABASE_VERSION }, (_, index) => index + 1))(
    "resumes migration from version %i",
    (version) => {
      const database = new Database(temporaryDatabasePath());
      migrateDatabase(database, version);
      expect(database.pragma("user_version", { simple: true })).toBe(version);

      migrateDatabase(database);
      expect(database.pragma("user_version", { simple: true })).toBe(LATEST_DATABASE_VERSION);
      database.close();
    },
  );

  test("preserves and normalizes data while adopting an unversioned database", () => {
    const path = temporaryDatabasePath();
    const legacy = new Database(path);
    migrateDatabase(legacy, 1);
    insertLegacyImport(legacy, "2026-06-15T00:00:00+01:00");
    legacy.pragma("user_version = 0");
    legacy.close();

    const migrated = openDatabase(path);

    expect(migrated.pragma("user_version", { simple: true })).toBe(LATEST_DATABASE_VERSION);
    expect(
      migrated
        .prepare<[], { range_start: string; range_start_ms: number }>(
          "SELECT range_start, range_start_ms FROM imports",
        )
        .get(),
    ).toEqual({
      range_start: "2026-06-15T00:00:00+01:00",
      range_start_ms: Date.parse("2026-06-15T00:00:00+01:00"),
    });

    migrated.close();
  });

  test("rolls back normalization when legacy timestamps are invalid", () => {
    const legacy = new Database(temporaryDatabasePath());
    migrateDatabase(legacy, 1);
    insertLegacyImport(legacy, "not-a-timestamp");

    expect(() => migrateDatabase(legacy)).toThrow(
      "Cannot migrate invalid timestamp in imports.range_start for row 1",
    );
    expect(legacy.pragma("user_version", { simple: true })).toBe(1);
    const columns = legacy.pragma("table_info(imports)") as Array<{ name: string }>;
    expect(columns.some((column) => column.name === "range_start_ms")).toBe(false);

    legacy.close();
  });

  test("rejects databases created by a newer application version", () => {
    const path = temporaryDatabasePath();
    const newer = openDatabase(path);
    newer.pragma(`user_version = ${LATEST_DATABASE_VERSION + 1}`);
    newer.close();

    expect(() => openDatabase(path)).toThrow(
      `Database version ${LATEST_DATABASE_VERSION + 1} is newer than supported version ${LATEST_DATABASE_VERSION}`,
    );
  });
});

function insertLegacyImport(db: HealthDatabase, rangeStart: string): void {
  db.prepare(`
    INSERT INTO imports (
      schema_version, range_start, range_end, range_kind, range_calendar, range_time_zone,
      source_key, generated_at, payload_hash, raw_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    1,
    rangeStart,
    "2026-06-22T00:00:00+01:00",
    "custom",
    "gregorian",
    "Europe/London",
    "Test iPhone",
    "2026-06-24T10:15:00+01:00",
    "hash",
    "{}",
    "2026-06-24T09:15:00.000Z",
    "2026-06-24T09:15:00.000Z",
  );
}

function temporaryDatabasePath(): string {
  temporaryDirectory ??= mkdtempSync(join(tmpdir(), "hem-web-db-test-"));
  return join(temporaryDirectory, "hem.sqlite");
}
