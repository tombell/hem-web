import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

test("container entrypoint restricts new file permissions and execs its command", () => {
  const output = execFileSync("/bin/sh", [
    "scripts/container-entrypoint.sh",
    process.execPath,
    "-e",
    "console.log(process.umask().toString(8)); console.log(process.argv[1]);",
    "literal argument",
  ]).toString();
  expect(output.trim().split("\n")).toEqual(["77", "literal argument"]);
});

test("watchdog recovery and refusal paths pass without touching real services", () => {
  execFileSync("python3", ["scripts/test-container-watchdog.py"], { stdio: "pipe" });
});

test("runtime Dockerfile stays non-root and lockfile-based with Linux-built production deps", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  expect(dockerfile).toContain("pnpm install --frozen-lockfile --prod");
  expect(dockerfile).toContain("npm_config_build_from_source=true");
  expect(dockerfile).toContain("USER 1000:1000");
  expect(dockerfile).toContain("STOPSIGNAL SIGTERM");
  expect(dockerfile).not.toContain("COPY node_modules");
  // oxlint/oxfmt rely on Git ignores to exclude dependency directories.
  expect(dockerfile).toContain("Dockerfile .dockerignore .gitignore ./");
  expect(readFileSync(".dockerignore", "utf8")).toContain("!.gitignore");
});
