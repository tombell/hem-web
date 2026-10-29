import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.ts";
import openApiDocument from "../openapi.json" with { type: "json" };
import { registerMethodNotAllowed, sendJson } from "./shared.ts";

export function registerOpenApiRoutes(server: FastifyInstance, config: AppConfig): void {
  server.get("/openapi.json", async (_request, reply) => {
    return sendJson(reply, 200, {
      ...openApiDocument,
      servers: [{ url: config.publicUrl }],
    });
  });

  registerMethodNotAllowed(server, "/openapi.json", "GET");
}
