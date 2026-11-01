import { existsSync } from "node:fs";

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

test("serves dashboard assets without changing API or unknown routes", async () => {
  const server = create();
  const redirect = (await server.inject("/dashboard")).headers.location!;
  for (const prefix of ["", "/hem"]) {
    expect(new URL(redirect, `http://local${prefix}/dashboard`).pathname).toBe(
      `${prefix}/dashboard/`,
    );
  }
  const response = await server.inject("/dashboard/");
  if (existsSync(new URL("../packages/dashboard/dist/index.html", import.meta.url))) {
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    const asset = response.body.match(/src="([^"]+\.js)"/)![1];
    for (const prefix of ["", "/hem"]) {
      const page = `http://local${prefix}/dashboard/`;
      for (const match of response.body.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
        expect(new URL(match[1], page).pathname).toMatch(
          new RegExp(`^${prefix}/dashboard/assets/`),
        );
      }
    }
    const script = await server.inject(new URL(asset, "http://local/dashboard/").pathname);
    expect(script.statusCode).toBe(200);
    expect(script.headers["content-type"]).toContain("javascript");
    expect(script.body).not.toContain("write-secret");
  } else {
    expect(response.statusCode).toBe(503);
  }
  expect((await server.inject("/apple-health/sources")).statusCode).toBe(401);
  expect((await server.inject("/unknown")).statusCode).toBe(404);
  expect((await server.inject("/dashboard/missing.js")).statusCode).toBe(404);
});
