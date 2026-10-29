import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.ts";
import openApiDocument from "../openapi.json" with { type: "json" };
import { sendJson } from "./shared.ts";

export function registerOpenApiRoutes(server: FastifyInstance, config: AppConfig): void {
  server.get("/openapi.json", async (_request, reply) => {
    return sendJson(reply, 200, {
      ...openApiDocument,
      servers: [{ url: config.publicUrl }],
    });
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
    url: "/openapi.json",
  });
}
