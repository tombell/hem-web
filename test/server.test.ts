import type { LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { AppConfig } from "../src/config";
import { openDatabase, type HealthDatabase } from "../src/db";
import type { HealthPayload, QuantityValue } from "../src/payload";
import { createHealthImportServer, startServer } from "../src/server";

const BASE_CONFIG: AppConfig = {
  bearerToken: "test-secret",
  dbPath: ":memory:",
  host: "127.0.0.1",
  maxBodyBytes: 5_242_880,
  port: 0,
  publicUrl: "https://hem.example.test",
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

afterEach(async () => {
  await server.close();
  if (db.open) db.close();
});

describe("server lifecycle", () => {
  test("closes an owned database when the server closes", async () => {
    const ownedDatabase = openDatabase(":memory:");
    const ownedServer = createHealthImportServer({
      closeDatabaseOnClose: true,
      config: BASE_CONFIG,
      db: ownedDatabase,
    });

    await ownedServer.close();

    expect(ownedDatabase.open).toBe(false);
  });

  test("closes the database when listening fails", async () => {
    const ownedDatabase = openDatabase(":memory:");

    await expect(
      startServer(
        { ...BASE_CONFIG, port: -1 },
        {
          openDatabase: () => ownedDatabase,
        },
      ),
    ).rejects.toThrow();

    expect(ownedDatabase.open).toBe(false);
  });
});

describe("GET /openapi.json", () => {
  test("serves an OpenAPI 3.1 document without auth", async () => {
    const response = await getPath("/openapi.json", { authorization: undefined });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");

    const document = response.json<{
      components: {
        parameters: Record<string, any>;
        schemas: Record<string, any>;
        securitySchemes: Record<string, unknown>;
      };
      openapi: string;
      paths: Record<string, any>;
      servers: Array<{ url: string }>;
    }>();
    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([{ url: "https://hem.example.test" }]);
    expect(document.paths["/apple-health/import"].post.security).toEqual([{ bearerAuth: [] }]);
    expect(document.paths["/apple-health/import/test"].get.security).toEqual([{ bearerAuth: [] }]);
    expect(document.paths["/apple-health/category-samples"].get.security).toEqual([
      { bearerAuth: [] },
    ]);
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
    expect(document.components.schemas.AppleHealthImportPayload.properties.categorySamples).toEqual(
      {
        default: [],
        items: { $ref: "#/components/schemas/CategorySampleRecord" },
        type: "array",
      },
    );
    expect(document.components.schemas.SampleRecord.properties.id).toEqual({
      minLength: 1,
      type: "string",
    });
    expect(document.components.schemas.SampleQueryRow.required).toContain("externalId");
    expect(document.components.schemas.SamplesResponse.required).toEqual([
      "samples",
      "hasMore",
      "nextCursor",
    ]);
    expect(document.components.parameters.Cursor.name).toBe("cursor");
    expect(document.paths["/apple-health/samples"].get.parameters).toContainEqual({
      $ref: "#/components/parameters/Cursor",
    });
  });

  test("rejects non-GET OpenAPI document requests", async () => {
    const response = await server.inject({ method: "POST", url: "/openapi.json" });

    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe("GET");
  });
});

describe("GET /apple-health/import/test", () => {
  test("requires bearer auth", async () => {
    const response = await getPath("/apple-health/import/test", { authorization: undefined });

    expect(response.statusCode).toBe(401);
  });

  test("returns ok for valid bearer auth", async () => {
    const response = await getPath("/apple-health/import/test");

    expect(response.statusCode).toBe(200);
    expect(response.json<{ ok: boolean }>()).toEqual({ ok: true });
    expect(logs).toMatchObject([
      {
        event: "apple_health_import_test",
      },
    ]);
    expect(logs[0].durationMs).toEqual(expect.any(Number));
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
    expect(sources).toMatchObject({ hasMore: false, nextCursor: null });
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
    expect(body.payload.categorySamples).toEqual(payload.categorySamples);
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

  test("returns filtered samples, category samples, workouts, and sleep", async () => {
    await postPayload(validPayload());

    const samples = await getJson<{ samples: Array<Record<string, any>> }>(
      "/apple-health/samples?type=restingHeartRate&start=2026-06-15T12:00:00%2B01:00",
    );
    const categorySamples = await getJson<{ categorySamples: Array<Record<string, any>> }>(
      "/apple-health/category-samples?type=mindfulSession&value=notApplicable&start=2026-06-18T07:05:00%2B01:00&end=2026-06-18T07:06:00%2B01:00",
    );
    const workouts = await getJson<{ workouts: Array<Record<string, any>> }>(
      "/apple-health/workouts?activityType=running&start=2026-06-17T07:00:00%2B01:00&end=2026-06-17T09:00:00%2B01:00",
    );
    const sleep = await getJson<{ sleep: Array<Record<string, any>> }>(
      "/apple-health/sleep?value=asleepCore&start=2026-06-17T00:00:00%2B01:00",
    );

    expect(samples.samples).toHaveLength(1);
    expect(samples.samples[0].value).toBe(58);
    expect(categorySamples.categorySamples).toHaveLength(1);
    expect(categorySamples.categorySamples[0]).toMatchObject({
      type: "mindfulSession",
      value: "notApplicable",
    });
    expect(workouts.workouts).toHaveLength(1);
    expect(workouts.workouts[0].activityType).toBe("running");
    expect(workouts.workouts[0].distance).toEqual({ unit: "km", value: 5.2 });
    expect(sleep.sleep).toHaveLength(1);
    expect(sleep.sleep[0].value).toBe("asleepCore");
  });

  test("orders and filters timestamps by instant across UTC offsets", async () => {
    const payload = validPayload({
      categorySamples: [],
      dailyMetrics: [],
      range: {
        calendar: "gregorian",
        end: "2026-06-15T01:00:00Z",
        kind: "custom",
        start: "2026-06-14T23:00:00Z",
        timeZone: "Europe/London",
      },
      samples: [
        {
          end: "2026-06-15T00:35:00+01:00",
          start: "2026-06-15T00:30:00+01:00",
          type: "heartRate",
          unit: "count/min",
          value: 60,
        },
        {
          end: "2026-06-14T23:50:00Z",
          start: "2026-06-14T23:45:00Z",
          type: "heartRate",
          unit: "count/min",
          value: 61,
        },
      ],
      sleep: [],
      workouts: [],
    });
    await postPayload(payload);

    const all = await getJson<{ samples: Array<{ start: string }> }>("/apple-health/samples");
    const filtered = await getJson<{ samples: Array<{ start: string }> }>(
      "/apple-health/samples?start=2026-06-14T23:40:00Z",
    );

    expect(all.samples.map((sample) => sample.start)).toEqual([
      "2026-06-15T00:30:00+01:00",
      "2026-06-14T23:45:00Z",
    ]);
    expect(filtered.samples.map((sample) => sample.start)).toEqual(["2026-06-14T23:45:00Z"]);
  });

  test("paginates deterministically without duplicate rows", async () => {
    const payload = validPayload({
      categorySamples: [],
      dailyMetrics: [],
      samples: Array.from({ length: 5 }, (_, index) => ({
        end: `2026-06-15T00:00:0${index + 1}+01:00`,
        id: `sample-${index + 1}`,
        start: "2026-06-15T00:00:00+01:00",
        type: "heartRate",
        unit: "count/min",
        value: 60 + index,
      })),
      sleep: [],
      workouts: [],
    });
    await postPayload(payload);

    const first = await getJson<{
      hasMore: boolean;
      nextCursor: string | null;
      samples: Array<{ externalId: string }>;
    }>("/apple-health/samples?type=heartRate&limit=2");
    const second = await getJson<typeof first>(
      `/apple-health/samples?type=heartRate&limit=2&cursor=${first.nextCursor}`,
    );
    const third = await getJson<typeof first>(
      `/apple-health/samples?type=heartRate&limit=2&cursor=${second.nextCursor}`,
    );

    expect(first).toMatchObject({ hasMore: true });
    expect(second).toMatchObject({ hasMore: true });
    expect(third).toMatchObject({ hasMore: false, nextCursor: null });
    expect(
      [...first.samples, ...second.samples, ...third.samples].map((row) => row.externalId),
    ).toEqual(["sample-1", "sample-2", "sample-3", "sample-4", "sample-5"]);
  });

  test("paginates imports in descending deterministic order", async () => {
    const firstPayload = validPayload();
    const secondPayload = validPayload();
    secondPayload.range.end = "2026-06-23T00:00:00+01:00";
    const thirdPayload = validPayload();
    thirdPayload.range.end = "2026-06-24T00:00:00+01:00";

    expect((await postPayload(firstPayload)).statusCode).toBe(201);
    expect((await postPayload(secondPayload)).statusCode).toBe(201);
    expect((await postPayload(thirdPayload)).statusCode).toBe(201);

    const first = await getJson<{
      hasMore: boolean;
      imports: Array<{ id: number }>;
      nextCursor: string | null;
    }>("/apple-health/imports?limit=2");
    const second = await getJson<typeof first>(
      `/apple-health/imports?limit=2&cursor=${first.nextCursor}`,
    );

    expect(first.hasMore).toBe(true);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    expect([...first.imports, ...second.imports].map((row) => row.id)).toEqual([3, 2, 1]);
  });

  test("rejects malformed and cross-endpoint cursors", async () => {
    await postPayload(validPayload());
    const page = await getJson<{ nextCursor: string }>("/apple-health/category-samples?limit=1");

    const malformed = await getPath("/apple-health/samples?cursor=not-a-cursor");
    const wrongEndpoint = await getPath(`/apple-health/sleep?cursor=${page.nextCursor}`);

    expect(malformed.statusCode).toBe(400);
    expect(wrongEndpoint.statusCode).toBe(400);
  });

  test("rejects invalid query values", async () => {
    await postPayload(validPayload());

    const badLimit = await getPath("/apple-health/samples?limit=0");
    const badDate = await getPath("/apple-health/daily-metrics?startDate=2026-02-30");
    const badDateTime = await getPath("/apple-health/samples?start=2026-06-15");

    expect(badLimit.statusCode).toBe(400);
    expect(badDate.statusCode).toBe(400);
    expect(badDateTime.statusCode).toBe(400);
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
    expect(countRows("category_samples")).toBe(2);
    expect(countRows("daily_metrics")).toBe(4);
    expect(countRows("samples")).toBe(1);
    expect(countRows("workouts")).toBe(1);
    expect(countRows("sleep")).toBe(1);
    expect(logs[0]).toMatchObject({ counts: { categorySamples: 2 } });
  });

  test("imports payloads missing categorySamples as an empty array", async () => {
    const payload: Partial<HealthPayload> = structuredClone(validPayload());
    delete payload.categorySamples;

    const response = await postRaw(JSON.stringify(payload));

    expect(response.statusCode).toBe(201);
    expect(countRows("imports")).toBe(1);
    expect(countRows("category_samples")).toBe(0);
    expect(logs[0]).toMatchObject({ counts: { categorySamples: 0 } });
  });

  test("does not duplicate an exact repeated import", async () => {
    const payload = validPayload();

    expect((await postPayload(payload)).statusCode).toBe(201);
    expect((await postPayload(payload)).statusCode).toBe(200);

    expect(countRows("imports")).toBe(1);
    expect(countRows("category_samples")).toBe(2);
    expect(countRows("daily_metrics")).toBe(4);
    expect(countRows("samples")).toBe(1);
    expect(countRows("workouts")).toBe(1);
    expect(countRows("sleep")).toBe(1);
  });

  test("replaces changed payload for the same import key", async () => {
    const payload = validPayload();
    const changedPayload = structuredClone(payload);
    changedPayload.categorySamples[0].value = "logged";
    (changedPayload.dailyMetrics[0].steps as QuantityValue).value = 9001;
    changedPayload.samples[0].value = 57;

    expect((await postPayload(payload)).statusCode).toBe(201);
    expect((await postPayload(changedPayload)).statusCode).toBe(200);

    expect(countRows("imports")).toBe(1);
    expect(countRows("category_samples")).toBe(2);
    expect(countRows("daily_metrics")).toBe(4);
    expect(countRows("samples")).toBe(1);
    expect(categorySampleValues("mindfulSession")).toEqual(["logged"]);
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
        start: "2026-06-15T00:00:00+01:00",
        timeZone: "Europe/London",
      },
    });

    expect((await postPayload(firstPayload)).statusCode).toBe(201);
    expect((await postPayload(overlappingPayload)).statusCode).toBe(201);

    expect(countRows("imports")).toBe(2);
    expect(countRows("category_samples")).toBe(2);
    expect(countRows("daily_metrics")).toBe(4);
    expect(countRows("samples")).toBe(1);
    expect(countRows("workouts")).toBe(1);
    expect(countRows("sleep")).toBe(1);
  });

  test("adopts stable IDs and applies revisions across overlapping imports", async () => {
    const firstPayload = validPayload();
    const identifiedPayload = structuredClone(firstPayload);
    identifiedPayload.range.end = "2026-06-23T00:00:00+01:00";
    identifiedPayload.samples[0].id = " sample-1 ";
    identifiedPayload.categorySamples[0].id = "category-1";
    identifiedPayload.sleep[0].id = "sleep-1";

    const revisedPayload = structuredClone(identifiedPayload);
    revisedPayload.range.end = "2026-06-24T00:00:00+01:00";
    revisedPayload.samples[0].start = "2026-06-15T01:00:00+01:00";
    revisedPayload.samples[0].end = "2026-06-16T01:00:00+01:00";
    revisedPayload.samples[0].value = 57;
    revisedPayload.categorySamples[0].value = "logged";
    revisedPayload.sleep[0].value = "asleepDeep";
    revisedPayload.workouts[0].distance = { unit: "km", value: 5.5 };

    expect((await postPayload(firstPayload)).statusCode).toBe(201);
    expect((await postPayload(identifiedPayload)).statusCode).toBe(201);
    expect((await postPayload(revisedPayload)).statusCode).toBe(201);

    expect(countRows("samples")).toBe(1);
    expect(countRows("category_samples")).toBe(2);
    expect(countRows("sleep")).toBe(1);
    expect(countRows("workouts")).toBe(1);

    const samples = await getJson<{ samples: Array<Record<string, any>> }>("/apple-health/samples");
    const categorySamples = await getJson<{ categorySamples: Array<Record<string, any>> }>(
      "/apple-health/category-samples?type=mindfulSession",
    );
    const sleep = await getJson<{ sleep: Array<Record<string, any>> }>("/apple-health/sleep");

    expect(samples.samples[0]).toMatchObject({ externalId: "sample-1", value: 57 });
    expect(categorySamples.categorySamples[0]).toMatchObject({
      externalId: "category-1",
      value: "logged",
    });
    expect(sleep.sleep[0]).toMatchObject({ externalId: "sleep-1", value: "asleepDeep" });
  });

  test("rejects blank stable IDs", async () => {
    const payload = validPayload();
    payload.samples[0].id = "   ";

    expect((await postPayload(payload)).statusCode).toBe(400);
    expect(countRows("imports")).toBe(0);
  });

  test("rejects payloads without source identity", async () => {
    const payload = validPayload();
    delete payload.source.deviceName;

    const response = await postPayload(payload);

    expect(response.statusCode).toBe(400);
    expect(countRows("imports")).toBe(0);
  });

  test("rejects invalid dates, unordered ranges, and out-of-range records", async () => {
    const invalidTimestamp = validPayload();
    invalidTimestamp.generatedAt = "2026-02-30T00:00:00Z";

    const invalidDate = validPayload();
    invalidDate.dailyMetrics[0].date = "2026-02-30";

    const unorderedRange = validPayload();
    unorderedRange.range.end = unorderedRange.range.start;

    const unorderedSample = validPayload();
    unorderedSample.samples[0].end = unorderedSample.samples[0].start;

    const outOfRangeSample = validPayload();
    outOfRangeSample.samples[0].start = "2026-06-14T23:00:00+01:00";

    const responses = await Promise.all(
      [invalidTimestamp, invalidDate, unorderedRange, unorderedSample, outOfRangeSample].map(
        (payload) => postPayload(payload),
      ),
    );

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 400]);
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

function categorySampleValues(type: string): string[] {
  return db
    .prepare<[string], { value: string }>(
      "SELECT value FROM category_samples WHERE type = ? ORDER BY value ASC",
    )
    .all(type)
    .map((row) => row.value);
}

function validPayload(overrides: Partial<HealthPayload> = {}): HealthPayload {
  return {
    categorySamples: [
      {
        end: "2026-06-18T07:10:00+01:00",
        start: "2026-06-18T07:00:00+01:00",
        type: "mindfulSession",
        value: "notApplicable",
      },
      {
        end: "2026-06-19T13:15:00+01:00",
        start: "2026-06-19T13:00:00+01:00",
        type: "headache",
        value: "present",
      },
    ],
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
