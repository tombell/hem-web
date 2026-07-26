import { describe, expect, test } from "vitest";

import { loadConfig } from "../src/config";

const REQUIRED_ENV = { HERMES_HEALTH_BEARER_TOKEN: "test-secret" };

describe("loadConfig", () => {
  test("loads bounded defaults", () => {
    const config = loadConfig(REQUIRED_ENV);

    expect(config).toMatchObject({
      host: "127.0.0.1",
      maxBodyBytes: 5_242_880,
      port: 3000,
      publicUrl: "/",
      rateLimitMax: 300,
      rateLimitWindowMs: 60_000,
    });
  });

  test("accepts absolute HTTP URLs and absolute paths", () => {
    expect(
      loadConfig({ ...REQUIRED_ENV, HERMES_HEALTH_PUBLIC_URL: "https://hem.example.test/api" })
        .publicUrl,
    ).toBe("https://hem.example.test/api");
    expect(loadConfig({ ...REQUIRED_ENV, HERMES_HEALTH_PUBLIC_URL: "/api" }).publicUrl).toBe(
      "/api",
    );
  });

  test.each([
    ["PORT", "0"],
    ["PORT", "65536"],
    ["PORT", "1.5"],
    ["HERMES_HEALTH_MAX_BODY_BYTES", "9007199254740992"],
    ["HERMES_HEALTH_RATE_LIMIT_MAX", "100001"],
    ["HERMES_HEALTH_RATE_LIMIT_WINDOW_MS", "86400001"],
  ])("rejects invalid integer bound for %s", (name, value) => {
    expect(() => loadConfig({ ...REQUIRED_ENV, [name]: value })).toThrow(name);
  });

  test.each([
    "relative/path",
    "//example.test/api",
    "ftp://example.test/api",
    "https://user:secret@example.test/api",
    "https://example.test/api?secret=value",
    "https://example.test/api#fragment",
  ])("rejects unsafe public URL %s", (publicUrl) => {
    expect(() => loadConfig({ ...REQUIRED_ENV, HERMES_HEALTH_PUBLIC_URL: publicUrl })).toThrow(
      "HERMES_HEALTH_PUBLIC_URL",
    );
  });
});
