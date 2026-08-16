import type { FastifyInstance } from "fastify";

import type { HealthDatabase } from "../db.ts";
import { elapsedMs, type MetadataLogger, sendJson } from "./shared.ts";

interface HealthRouteDependencies {
  db: HealthDatabase;
  logger: MetadataLogger;
}

export function registerHealthRoutes(
  server: FastifyInstance,
  { db, logger }: HealthRouteDependencies,
): void {
  server.get("/health", async (_request, reply) => sendJson(reply, 200, { ok: true }));

  server.get("/ready", async (_request, reply) => {
    const startedAt = performance.now();
    try {
      db.prepare("SELECT 1").get();
      return sendJson(reply, 200, { ok: true });
    } catch {
      logger.error({
        durationMs: elapsedMs(startedAt),
        event: "service_not_ready",
      });
      return sendJson(reply, 503, {
        error: { category: "not_ready", message: "Service not ready" },
        ok: false,
      });
    }
  });

  for (const url of ["/health", "/ready"]) {
    server.route({
      handler: async (_request, reply) =>
        sendJson(
          reply,
          405,
          { error: { category: "method_not_allowed", message: "Method not allowed" }, ok: false },
          { Allow: "GET" },
        ),
      method: ["DELETE", "PATCH", "POST", "PUT"],
      url,
    });
  }
}
