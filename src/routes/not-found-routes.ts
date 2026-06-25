import type { FastifyInstance } from "fastify";

import { sendJson } from "./shared";

export function registerNotFoundRoute(server: FastifyInstance): void {
  server.setNotFoundHandler(async (_request, reply) => {
    return sendJson(reply, 404, {
      error: { category: "not_found", message: "Not found" },
      ok: false,
    });
  });
}
