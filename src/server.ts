import Fastify, { type FastifyInstance } from "fastify";

import { type AppConfig, loadConfig } from "./config";
import type { HealthDatabase } from "./db";
import { openDatabase } from "./db";
import { registerAppleHealthRoutes } from "./routes/apple-health-routes";
import { registerNotFoundRoute } from "./routes/not-found-routes";
import { registerOpenApiRoutes } from "./routes/openapi-routes";
import type { MetadataLogger, ParsedJsonBody } from "./routes/shared";

interface ServerDependencies {
  config: AppConfig;
  db: HealthDatabase;
  logger?: MetadataLogger;
}

const DEFAULT_LOGGER: MetadataLogger = {
  error: (event) => console.error(JSON.stringify(event)),
  info: (event) => console.info(JSON.stringify(event)),
};

export function createHealthImportServer({
  config,
  db,
  logger = DEFAULT_LOGGER,
}: ServerDependencies): FastifyInstance {
  const server = Fastify({ bodyLimit: config.maxBodyBytes, logger: false });

  server.addContentTypeParser(
    "application/json",
    { bodyLimit: config.maxBodyBytes, parseAs: "string" },
    (_request, body, done) => {
      const raw = body.toString();
      try {
        done(null, { parsed: JSON.parse(raw), raw } satisfies ParsedJsonBody);
      } catch (error) {
        done(error as Error);
      }
    },
  );

  server.setErrorHandler((error, _request, reply) => {
    if (hasErrorCode(error, "FST_ERR_CTP_BODY_TOO_LARGE")) {
      void reply.code(413).send({
        error: { category: "body_too_large", message: "Request body too large" },
        ok: false,
      });
      return;
    }

    if (error instanceof SyntaxError) {
      void reply.code(400).send({
        error: { category: "invalid_payload", message: "Invalid JSON" },
        ok: false,
      });
      return;
    }

    void reply.code(500).send({
      error: { category: "server_error", message: "Import failed" },
      ok: false,
    });
  });

  registerOpenApiRoutes(server, config);
  registerAppleHealthRoutes(server, { config, db, logger });
  registerNotFoundRoute(server);

  return server;
}

export async function startServer(config: AppConfig = loadConfig()): Promise<FastifyInstance> {
  const db = openDatabase(config.dbPath);
  const server = createHealthImportServer({ config, db });
  await server.listen({ host: config.host, port: config.port });
  const address = server.server.address();
  const port = typeof address === "object" && address !== null ? address.port : config.port;

  console.info(
    JSON.stringify({
      dbPath: config.dbPath,
      event: "server_started",
      host: config.host,
      port,
    }),
  );

  return server;
}

function hasErrorCode(error: unknown, code: string): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

if (import.meta.main) {
  await startServer();
}
