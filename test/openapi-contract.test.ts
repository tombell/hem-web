import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020.js";
import type { LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { AppConfig } from "../src/config";
import { openDatabase, type HealthDatabase } from "../src/db";
import { OPENAPI_DOCUMENT } from "../src/openapi";
import { createHealthImportServer } from "../src/server";

const CONFIG: AppConfig = {
  bearerToken: "test-secret",
  dbPath: ":memory:",
  host: "127.0.0.1",
  maxBodyBytes: 5_242_880,
  port: 0,
  publicUrl: "https://hem.example.test",
  rateLimitMax: 1_000,
  rateLimitWindowMs: 60_000,
};

const MINIMAL_PAYLOAD = {
  generatedAt: "2026-06-24T10:15:00+01:00",
  range: {
    calendar: "gregorian",
    end: "2026-06-22T00:00:00+01:00",
    kind: "custom",
    start: "2026-06-15T00:00:00+01:00",
    timeZone: "Europe/London",
  },
  schemaVersion: 1,
  source: { deviceName: "Contract Test iPhone" },
};

const document = OPENAPI_DOCUMENT as any;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

let db: HealthDatabase;
let server: ReturnType<typeof createHealthImportServer>;

beforeEach(() => {
  db = openDatabase(":memory:");
  server = createHealthImportServer({ config: CONFIG, db });
});

afterEach(async () => {
  await server.close();
  if (db.open) db.close();
});

describe("OpenAPI runtime contract", () => {
  test("resolves every local reference and has unique operation IDs", () => {
    const references = collectValues(document, "$ref") as string[];
    for (const reference of references.filter((value) => value.startsWith("#/"))) {
      expect(resolveReference({ $ref: reference }), reference).toBeDefined();
    }

    const operationIds = Object.values(document.paths).flatMap((path: any) =>
      Object.values(path).flatMap((operation: any) => operation.operationId ?? []),
    );
    expect(operationIds).toHaveLength(13);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  test("accepts the documented import request schema", () => {
    expectSchema({ $ref: "#/components/schemas/AppleHealthImportPayload" }, MINIMAL_PAYLOAD);
  });

  test("matches representative runtime responses", async () => {
    const imported = await request("POST", "/apple-health/import", MINIMAL_PAYLOAD);
    expect(imported.statusCode).toBe(201);
    expectResponse("/apple-health/import", "post", imported);
    const importId = imported.json<{ importId: number }>().importId;

    const cases: Array<[path: string, method: "get", url: string]> = [
      ["/health", "get", "/health"],
      ["/ready", "get", "/ready"],
      ["/openapi.json", "get", "/openapi.json"],
      ["/apple-health/import/test", "get", "/apple-health/import/test"],
      ["/apple-health/sources", "get", "/apple-health/sources"],
      ["/apple-health/imports", "get", "/apple-health/imports"],
      ["/apple-health/imports/{id}/payload", "get", `/apple-health/imports/${importId}/payload`],
      ["/apple-health/daily-metrics", "get", "/apple-health/daily-metrics"],
      ["/apple-health/samples", "get", "/apple-health/samples"],
      ["/apple-health/category-samples", "get", "/apple-health/category-samples"],
      ["/apple-health/workouts", "get", "/apple-health/workouts"],
      ["/apple-health/sleep", "get", "/apple-health/sleep"],
    ];

    const responses = await Promise.all(cases.map(([, , url]) => request("GET", url)));
    for (const [[path, method, url], response] of cases.map(
      (item, index) => [item, responses[index]] as const,
    )) {
      expect(response.statusCode, url).toBe(200);
      expectResponse(path, method, response);
    }

    const unauthorized = await server.inject({ method: "GET", url: "/apple-health/samples" });
    expectResponse("/apple-health/samples", "get", unauthorized);

    const invalidQuery = await request("GET", "/apple-health/samples?limit=0");
    expectResponse("/apple-health/samples", "get", invalidQuery);

    const missingImport = await request("GET", "/apple-health/imports/999/payload");
    expectResponse("/apple-health/imports/{id}/payload", "get", missingImport);

    db.close();
    const notReady = await request("GET", "/ready");
    expectResponse("/ready", "get", notReady);
  });

  test("matches the documented rate-limit response", async () => {
    await server.close();
    server = createHealthImportServer({ config: { ...CONFIG, rateLimitMax: 1 }, db });

    expect((await request("GET", "/health")).statusCode).toBe(200);
    const limited = await request("GET", "/health");

    expect(limited.statusCode).toBe(429);
    expectResponse("/health", "get", limited);
  });
});

async function request(
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  return server.inject({
    headers: {
      authorization: "Bearer test-secret",
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    method,
    payload: payload === undefined ? undefined : JSON.stringify(payload),
    url,
  });
}

function expectResponse(
  path: string,
  method: "get" | "post",
  response: LightMyRequestResponse,
): void {
  const responseDefinition = resolveReference(
    document.paths[path][method].responses[String(response.statusCode)],
  );
  expect(
    responseDefinition,
    `${method.toUpperCase()} ${path} ${response.statusCode}`,
  ).toBeDefined();
  expectSchema(responseDefinition.content["application/json"].schema, response.json());
}

function expectSchema(schema: Record<string, unknown>, value: unknown): void {
  const validate = ajv.compile({ components: document.components, ...schema });
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
}

function resolveReference(value: any): any {
  if (!value?.$ref) return value;
  return value.$ref
    .slice(2)
    .split("/")
    .reduce((current: any, segment: string) => current[segment], document);
}

function collectValues(value: unknown, key: string): unknown[] {
  if (typeof value !== "object" || value === null) return [];

  const values: unknown[] = [];
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key) values.push(entryValue);
    values.push(...collectValues(entryValue, key));
  }
  return values;
}
