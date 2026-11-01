import { afterEach, expect, test } from "vite-plus/test";

import { loadConfig } from "../src/config";
import { openDatabase } from "../src/db";
import { createHealthImportServer } from "../src/server";

const servers: ReturnType<typeof createHealthImportServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
function create(dashboardToken: string | undefined = "read-secret") {
  const config = loadConfig({
    HERMES_HEALTH_BEARER_TOKEN: "write-secret",
    HERMES_HEALTH_DASHBOARD_TOKEN: dashboardToken,
  });
  const server = createHealthImportServer({
    config,
    db: openDatabase(":memory:"),
    closeDatabaseOnClose: true,
    logger: { info() {}, error() {} },
  });
  servers.push(server);
  return server;
}

test("read-only token reads collections but cannot import", async () => {
  const server = create();
  const headers = { authorization: "Bearer read-secret" };
  await Promise.all(
    ["sources", "daily-metrics", "samples", "category-samples", "workouts", "sleep", "imports"].map(
      async (path) => {
        const response = await server.inject({ url: `/apple-health/${path}`, headers });
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
      },
    ),
  );
  const denied = await server.inject({
    method: "POST",
    url: "/apple-health/import",
    headers,
    payload: {},
  });
  expect(denied.statusCode).toBe(401);
  const original = await server.inject({
    method: "POST",
    url: "/apple-health/import",
    headers: { authorization: "Bearer write-secret" },
    payload: {},
  });
  expect(original.statusCode).toBe(400);
});

test("unknown and unconfigured dashboard tokens are rejected", async () => {
  const server = create("");
  const response = await server.inject({
    url: "/apple-health/sources",
    headers: { authorization: "Bearer read-secret" },
  });
  expect(response.statusCode).toBe(401);
});

test("dashboard credentials must differ from the import credential", () => {
  expect(() =>
    loadConfig({ HERMES_HEALTH_BEARER_TOKEN: "same", HERMES_HEALTH_DASHBOARD_TOKEN: "same" }),
  ).toThrow("must differ");
});
