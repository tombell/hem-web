import type { LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { AppConfig } from "../src/config";
import { openDatabase, type HealthDatabase } from "../src/db";
import type { HealthPayload, QuantityValue } from "../src/payload";
import { createHealthImportServer } from "../src/server";

const BASE_CONFIG: AppConfig = {
  bearerToken: "test-secret",
  dbPath: ":memory:",
  host: "127.0.0.1",
  maxBodyBytes: 5_242_880,
  port: 0,
};

let db: HealthDatabase;
let logs: Record<string, unknown>[];
let server: ReturnType<typeof createHealthImportServer>;

beforeEach(() => {
  db = openDatabase(":memory:");
  logs = [];
  server = createHealthImportServer({
    config: BASE_CONFIG,
    db,
    logger: {
      error: (event) => logs.push(event),
      info: (event) => logs.push(event),
    },
  });
});

afterEach(() => {
  void server.close();
  db.close();
});

describe("GET /openapi.json", () => {
  test("serves an OpenAPI 3.1 document without auth", async () => {
    const response = await getPath("/openapi.json", { authorization: undefined });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");

    const document = response.json<{
      components: { securitySchemes: Record<string, unknown> };
      openapi: string;
      paths: Record<string, any>;
    }>();
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/apple-health/import"].post.security).toEqual([{ bearerAuth: [] }]);
    expect(document.paths["/apple-health/daily-metrics"].get.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(document.paths["/apple-health/imports/{id}/payload"].get.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(
      document.paths["/apple-health/import"].post.requestBody.content["application/json"].schema,
    ).toEqual({
      $ref: "#/components/schemas/AppleHealthImportPayload",
    });
    expect(document.components.securitySchemes.bearerAuth).toEqual({
      scheme: "bearer",
      type: "http",
    });
  });

  test("rejects non-GET OpenAPI document requests", async () => {
    const response = await server.inject({ method: "POST", url: "/openapi.json" });

    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe("GET");
  });
});

describe("GET Apple Health query endpoints", () => {
  test("requires bearer auth", async () => {
    await postPayload(validPayload());

    const response = await getPath("/apple-health/daily-metrics", { authorization: undefined });

    expect(response.statusCode).toBe(401);
  });

  test("lists sources, import metadata, and raw payload by import id", async () => {
    const payload = validPayload();
    expect((await postPayload(payload)).statusCode).toBe(201);

    const sourcesResponse = await getPath("/apple-health/sources");
    const sources = sourcesResponse.json<{ sources: Array<Record<string, any>> }>();
    expect(sourcesResponse.statusCode).toBe(200);
    expect(sources.sources).toHaveLength(1);
    expect(sources.sources[0].sourceKey).toBe("Test iPhone");
    expect(sources.sources[0].importCount).toBe(1);

    const importsResponse = await getPath("/apple-health/imports?sourceKey=Test%20iPhone");
    const imports = importsResponse.json<{ imports: Array<Record<string, any>> }>();
    expect(importsResponse.statusCode).toBe(200);
    expect(imports.imports).toHaveLength(1);
    expect(imports.imports[0].range.start).toBe("2026-06-15T00:00:00+01:00");
    expect(imports.imports[0].rawJson).toBeUndefined();

    const payloadResponse = await getPath(`/apple-health/imports/${imports.imports[0].id}/payload`);
    const body = payloadResponse.json<{ payload: HealthPayload }>();
    expect(payloadResponse.statusCode).toBe(200);
    expect(body.payload.dailyMetrics[0].date).toBe(payload.dailyMetrics[0].date);
    expect(body.payload.source.deviceName).toBe("Test iPhone");
  });

  test("returns filtered daily metrics", async () => {
    await postPayload(validPayload());

    const response = await getPath(
      "/apple-health/daily-metrics?metric=steps&startDate=2026-06-15&endDate=2026-06-15",
    );
    const body = response.json<{ dailyMetrics: Array<Record<string, any>> }>();

    expect(response.statusCode).toBe(200);
    expect(body.dailyMetrics).toHaveLength(1);
    expect(body.dailyMetrics[0]).toMatchObject({
      date: "2026-06-15",
      metric: "steps",
      sourceKey: "Test iPhone",
      unit: "count",
      value: 8421,
    });
  });

  test("returns filtered samples, workouts, and sleep", async () => {
    await postPayload(validPayload());

    const samples = await getJson<{ samples: Array<Record<string, any>> }>(
      "/apple-health/samples?type=restingHeartRate&start=2026-06-15T12:00:00%2B01:00",
    );
    const workouts = await getJson<{ workouts: Array<Record<string, any>> }>(
      "/apple-health/workouts?activityType=running&start=2026-06-17T07:00:00%2B01:00&end=2026-06-17T09:00:00%2B01:00",
    );
    const sleep = await getJson<{ sleep: Array<Record<string, any>> }>(
      "/apple-health/sleep?value=asleepCore&start=2026-06-17T00:00:00%2B01:00",
    );

    expect(samples.samples).toHaveLength(1);
    expect(samples.samples[0].value).toBe(58);
    expect(workouts.workouts).toHaveLength(1);
    expect(workouts.workouts[0].activityType).toBe("running");
    expect(workouts.workouts[0].distance).toEqual({ unit: "km", value: 5.2 });
    expect(sleep.sleep).toHaveLength(1);
    expect(sleep.sleep[0].value).toBe("asleepCore");
  });

  test("rejects invalid query values", async () => {
    await postPayload(validPayload());

    const badLimit = await getPath("/apple-health/samples?limit=0");
    const badDate = await getPath("/apple-health/daily-metrics?startDate=2026-6-15");

    expect(badLimit.statusCode).toBe(400);
    expect(badDate.statusCode).toBe(400);
  });

  test("returns 404 for unknown import payload", async () => {
    const response = await getPath("/apple-health/imports/999/payload");

    expect(response.statusCode).toBe(404);
  });
});

describe("POST /apple-health/import", () => {
  test("requires bearer auth", async () => {
    const response = await postPayload(validPayload(), { authorization: undefined });

    expect(response.statusCode).toBe(401);
    expect(countRows("imports")).toBe(0);
  });

  test("requires application/json", async () => {
    const response = await server.inject({
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "text/plain",
      },
      method: "POST",
      payload: JSON.stringify(validPayload()),
      url: "/apple-health/import",
    });

    expect(response.statusCode).toBe(400);
    expect(countRows("imports")).toBe(0);
  });

  test("rejects oversized request bodies", async () => {
    await server.close();
    server = createHealthImportServer({
      config: { ...BASE_CONFIG, maxBodyBytes: 8 },
      db,
      logger: {
        error: (event) => logs.push(event),
        info: (event) => logs.push(event),
      },
    });

    const response = await postRaw('{"too":"large"}');

    expect(response.statusCode).toBe(413);
    expect(countRows("imports")).toBe(0);
  });

  test("rejects invalid JSON", async () => {
    const response = await postRaw("{not-json");

    expect(response.statusCode).toBe(400);
    expect(countRows("imports")).toBe(0);
  });

  test("imports a minimal valid payload", async () => {
    const response = await postPayload(validPayload());

    expect(response.statusCode).toBe(201);
    expect(response.json<{ ok: boolean }>()).toEqual({ ok: true });
    expect(countRows("imports")).toBe(1);
    expect(countRows("daily_metrics")).toBe(4);
    expect(countRows("samples")).toBe(1);
    expect(countRows("workouts")).toBe(1);
    expect(countRows("sleep")).toBe(1);
  });

  test("does not duplicate an exact repeated import", async () => {
    const payload = validPayload();

    expect((await postPayload(payload)).statusCode).toBe(201);
    expect((await postPayload(payload)).statusCode).toBe(200);

    expect(countRows("imports")).toBe(1);
    expect(countRows("daily_metrics")).toBe(4);
    expect(countRows("samples")).toBe(1);
    expect(countRows("workouts")).toBe(1);
    expect(countRows("sleep")).toBe(1);
  });

  test("replaces changed payload for the same import key", async () => {
    const payload = validPayload();
    const changedPayload = structuredClone(payload);
    (changedPayload.dailyMetrics[0].steps as QuantityValue).value = 9001;
    changedPayload.samples[0].value = 57;

    expect((await postPayload(payload)).statusCode).toBe(201);
    expect((await postPayload(changedPayload)).statusCode).toBe(200);

    expect(countRows("imports")).toBe(1);
    expect(countRows("daily_metrics")).toBe(4);
    expect(countRows("samples")).toBe(1);
    expect(metricValue("steps")).toBe(9001);
    expect(sampleValue("restingHeartRate")).toBe(57);
  });

  test("does not duplicate facts across overlapping imports", async () => {
    const firstPayload = validPayload();
    const overlappingPayload = validPayload({
      range: {
        calendar: "gregorian",
        end: "2026-06-23T00:00:00+01:00",
        kind: "custom",
        start: "2026-06-16T00:00:00+01:00",
        timeZone: "Europe/London",
      },
    });

    expect((await postPayload(firstPayload)).statusCode).toBe(201);
    expect((await postPayload(overlappingPayload)).statusCode).toBe(201);

    expect(countRows("imports")).toBe(2);
    expect(countRows("daily_metrics")).toBe(4);
    expect(countRows("samples")).toBe(1);
    expect(countRows("workouts")).toBe(1);
    expect(countRows("sleep")).toBe(1);
  });

  test("rejects payloads without source identity", async () => {
    const payload = validPayload();
    delete payload.source.deviceName;

    const response = await postPayload(payload);

    expect(response.statusCode).toBe(400);
    expect(countRows("imports")).toBe(0);
  });

  test("does not log health payload values", async () => {
    const payload = validPayload();
    (payload.dailyMetrics[0].steps as QuantityValue).value = 123456789;

    const response = await postPayload(payload);

    expect(response.statusCode).toBe(201);
    expect(JSON.stringify(logs)).not.toContain("123456789");
    expect(JSON.stringify(logs)).not.toContain("raw_json");
    expect(JSON.stringify(logs)).not.toContain('dailyMetrics":[');
  });
});

async function postPayload(
  payload: HealthPayload,
  headers: { authorization?: string } = {},
): Promise<LightMyRequestResponse> {
  return postRaw(JSON.stringify(payload), headers);
}

async function postRaw(
  rawBody: string,
  headers: { authorization?: string } = {},
): Promise<LightMyRequestResponse> {
  const authorization = Object.hasOwn(headers, "authorization")
    ? headers.authorization
    : "Bearer test-secret";
  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
  };

  if (authorization !== undefined) {
    requestHeaders.authorization = authorization;
  }

  return server.inject({
    headers: requestHeaders,
    method: "POST",
    payload: rawBody,
    url: "/apple-health/import",
  });
}

async function getPath(
  path: string,
  headers: { authorization?: string } = {},
): Promise<LightMyRequestResponse> {
  const authorization = Object.hasOwn(headers, "authorization")
    ? headers.authorization
    : "Bearer test-secret";
  const requestHeaders: Record<string, string> = {};

  if (authorization !== undefined) {
    requestHeaders.authorization = authorization;
  }

  return server.inject({
    headers: requestHeaders,
    method: "GET",
    url: path,
  });
}

async function getJson<T>(path: string): Promise<T> {
  const response = await getPath(path);
  expect(response.statusCode).toBe(200);
  return response.json<T>();
}

function countRows(table: string): number {
  const result = db.prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${table}`).get();
  return result?.count ?? 0;
}

function metricValue(metric: string): number | undefined {
  return db
    .prepare<[string], { value: number }>("SELECT value FROM daily_metrics WHERE metric = ?")
    .get(metric)?.value;
}

function sampleValue(type: string): number | undefined {
  return db
    .prepare<[string], { value: number }>("SELECT value FROM samples WHERE type = ?")
    .get(type)?.value;
}

function validPayload(overrides: Partial<HealthPayload> = {}): HealthPayload {
  return {
    dailyMetrics: [
      {
        activeEnergy: { unit: "kcal", value: 512.4 },
        date: "2026-06-15",
        exerciseTime: { unit: "min", value: 42 },
        steps: { unit: "count", value: 8421 },
        walkingRunningDistance: { unit: "km", value: 6.3 },
      },
    ],
    generatedAt: "2026-06-24T10:15:00+01:00",
    range: {
      calendar: "gregorian",
      end: "2026-06-22T00:00:00+01:00",
      kind: "previousFullWeek",
      start: "2026-06-15T00:00:00+01:00",
      timeZone: "Europe/London",
    },
    samples: [
      {
        end: "2026-06-16T00:00:00+01:00",
        start: "2026-06-15T00:00:00+01:00",
        type: "restingHeartRate",
        unit: "count/min",
        value: 58,
      },
    ],
    schemaVersion: 1 as const,
    sleep: [
      {
        end: "2026-06-17T06:44:00+01:00",
        start: "2026-06-16T23:12:00+01:00",
        value: "asleepCore",
      },
    ],
    source: {
      app: "Hermes Health Bridge",
      bundleIdentifier: "com.tombell.hermes-health-bridge",
      deviceName: "Test iPhone",
      deviceSystemName: "iOS",
      deviceSystemVersion: "18.0",
    },
    workouts: [
      {
        activeEnergy: { unit: "kcal", value: 390 },
        activityType: "running",
        distance: { unit: "km", value: 5.2 },
        duration: { unit: "min", value: 34 },
        end: "2026-06-17T08:05:00+01:00",
        id: "workout-1",
        start: "2026-06-17T07:31:00+01:00",
      },
    ],
    ...overrides,
  };
}
