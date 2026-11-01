import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

export async function registerDashboardRoutes(server: FastifyInstance): Promise<void> {
  const root = fileURLToPath(new URL("../../packages/dashboard/dist/", import.meta.url));
  server.get("/dashboard", async (_request, reply) => reply.redirect("./dashboard/"));
  if (!existsSync(root)) {
    server.get("/dashboard/", async (_request, reply) =>
      reply.code(503).send({ error: { message: "Build the dashboard with pnpm build first" } }),
    );
    return;
  }
  await server.register(fastifyStatic, {
    root,
    prefix: "/dashboard/",
    setHeaders(response) {
      response.header("Cache-Control", "no-store");
      response.header("Referrer-Policy", "no-referrer");
      response.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
    },
  });
}
