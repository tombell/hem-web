import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { LATEST_DATABASE_VERSION, openDatabase } from "../src/db";

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

  test("preserves data while adopting an unversioned database", () => {
    const path = temporaryDatabasePath();
    const legacy = openDatabase(path);
    legacy.exec("CREATE TABLE migration_sentinel (value TEXT NOT NULL)");
    legacy.prepare("INSERT INTO migration_sentinel (value) VALUES (?)").run("preserved");
    legacy.pragma("user_version = 0");
    legacy.close();

    const migrated = openDatabase(path);

    expect(migrated.pragma("user_version", { simple: true })).toBe(LATEST_DATABASE_VERSION);
    expect(
      migrated.prepare<[], { value: string }>("SELECT value FROM migration_sentinel").get(),
    ).toEqual({ value: "preserved" });

    migrated.close();
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

function temporaryDatabasePath(): string {
  temporaryDirectory ??= mkdtempSync(join(tmpdir(), "hem-web-db-test-"));
  return join(temporaryDirectory, "hem.sqlite");
}
