import type { FastifyInstance, FastifyReply } from "fastify";

import type { AppConfig } from "../config.ts";
import type { HealthDatabase } from "../db.ts";
import { importHealthPayload } from "../importer.ts";
import { validateHealthPayload } from "../payload.ts";
import { handleHealthQueryRequest } from "../query-api.ts";
import {
  elapsedMs,
  isAuthorized,
  isJsonRequest,
  logError,
  type MetadataLogger,
  type ParsedJsonBody,
  sendJson,
} from "./shared.ts";

interface AppleHealthRouteDependencies {
  config: AppConfig;
  db: HealthDatabase;
  logger: MetadataLogger;
}

export function registerAppleHealthRoutes(
  server: FastifyInstance,
  { config, db, logger }: AppleHealthRouteDependencies,
): void {
  server.post("/apple-health/import", async (request, reply) => {
    const startedAt = performance.now();

    if (!isAuthorized(request, config.bearerToken)) {
      logError(logger, startedAt, "auth");
      return sendUnauthorized(reply);
    }

    if (!isJsonRequest(request)) {
      logError(logger, startedAt, "invalid_content_type");
      return sendJson(reply, 400, {
        error: { category: "invalid_payload", message: "Content-Type must be application/json" },
        ok: false,
      });
    }

    const contentLength = request.headers["content-length"];
    if (contentLength !== undefined && Number(contentLength) > config.maxBodyBytes) {
      logError(logger, startedAt, "body_too_large");
      return sendJson(reply, 413, {
        error: { category: "body_too_large", message: "Request body too large" },
        ok: false,
      });
    }

    const body = request.body as ParsedJsonBody;
    const parsed = body.parsed;
    const rawBody = body.raw;

    const validation = validateHealthPayload(parsed);
    if (!validation.ok) {
      logError(logger, startedAt, "invalid_payload");
      return sendJson(reply, 400, {
        error: { category: "invalid_payload", message: validation.error },
        ok: false,
      });
    }

    try {
      const result = importHealthPayload(db, validation.payload, rawBody);
      const status = result.status === "created" ? 201 : 200;

      logger.info({
        counts: result.counts,
        durationMs: elapsedMs(startedAt),
        event: "apple_health_import",
        importId: result.importId,
        rangeEnd: validation.payload.range.end,
        rangeStart: validation.payload.range.start,
        sourceKey: result.sourceKey,
        status: result.status,
      });

      return sendJson(reply, status, {
        counts: result.counts,
        importId: result.importId,
        ok: true,
        status: result.status,
      });
    } catch {
      logError(logger, startedAt, "server_error");
      return sendJson(reply, 500, {
        error: { category: "server_error", message: "Import failed" },
        ok: false,
      });
    }
  });

  server.route({
    handler: async (_request, reply) => {
      return sendJson(
        reply,
        405,
        { error: { category: "method_not_allowed", message: "Method not allowed" }, ok: false },
        { Allow: "POST" },
      );
    },
    method: ["DELETE", "GET", "PATCH", "PUT"],
    url: "/apple-health/import",
  });

  server.get("/apple-health/import/test", async (request, reply) => {
    const startedAt = performance.now();

    if (!isAuthorized(request, config.bearerToken)) {
      logError(logger, startedAt, "auth", "apple_health_import_test_error");
      return sendUnauthorized(reply);
    }

    logger.info({
      durationMs: elapsedMs(startedAt),
      event: "apple_health_import_test",
    });

    return sendJson(reply, 200, { ok: true });
  });

  server.get("/apple-health/*", async (request, reply) => {
    const startedAt = performance.now();

    if (!isAuthorized(request, config.bearerToken)) {
      logError(logger, startedAt, "auth", "apple_health_query_error");
      return sendUnauthorized(reply);
    }

    const url = new URL(request.url, "http://localhost");
    const result = handleHealthQueryRequest(db, url);
    logger.info({
      durationMs: elapsedMs(startedAt),
      event: "apple_health_query",
      method: request.method,
      path: url.pathname,
      status: result.status,
    });
    return sendJson(reply, result.status, result.body, result.headers);
  });

  server.route({
    handler: async (_request, reply) => {
      return sendJson(
        reply,
        405,
        { error: { category: "method_not_allowed", message: "Method not allowed" }, ok: false },
        { Allow: "GET" },
      );
    },
    method: ["DELETE", "PATCH", "POST", "PUT"],
    url: "/apple-health/*",
  });
}

function sendUnauthorized(reply: FastifyReply): FastifyReply {
  return sendJson(
    reply,
    401,
    {
      error: { category: "auth", message: "Unauthorized" },
      ok: false,
    },
    { "WWW-Authenticate": 'Bearer realm="hem-web"' },
  );
}
