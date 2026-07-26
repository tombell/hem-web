import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, expect, test } from "vitest";

let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) rmSync(temporaryDirectory, { force: true, recursive: true });
  temporaryDirectory = undefined;
});

test("launch script supports configurable paths and environment precedence", () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "hem-web-launch-test-"));
  const externalEnv = join(temporaryDirectory, "external.env");
  const projectEnv = join(temporaryDirectory, "project.env");
  const fakePnpm = join(temporaryDirectory, "pnpm");
  const capture = join(temporaryDirectory, "capture");

  writeFileSync(externalEnv, "HEM_TEST_VALUE=external\n");
  writeFileSync(projectEnv, "HEM_TEST_VALUE=project\n");
  writeFileSync(
    fakePnpm,
    '#!/usr/bin/env bash\nprintf "%s\\n%s\\n%s\\n" "$PWD" "$HEM_TEST_VALUE" "$1" > "$CAPTURE_PATH"\n',
  );
  chmodSync(fakePnpm, 0o755);

  const result = spawnSync("bash", [resolve("scripts/start-launchd.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      CAPTURE_PATH: capture,
      HEM_WEB_ENV_FILE: externalEnv,
      HEM_WEB_PROJECT_DIR: process.cwd(),
      HEM_WEB_PROJECT_ENV_FILE: projectEnv,
      PNPM_BIN: fakePnpm,
    },
  });

  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(readFileSync(capture, "utf8").trim().split("\n")).toEqual([
    process.cwd(),
    "project",
    "start",
  ]);
});
