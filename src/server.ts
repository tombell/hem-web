import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";

import { type AppConfig, loadConfig } from "./config";
import type { HealthDatabase } from "./db";
import { openDatabase } from "./db";
import { registerAppleHealthRoutes } from "./routes/apple-health-routes";
import { registerNotFoundRoute } from "./routes/not-found-routes";
import { registerOpenApiRoutes } from "./routes/openapi-routes";
import type { MetadataLogger, ParsedJsonBody } from "./routes/shared";

interface ServerDependencies {
  closeDatabaseOnClose?: boolean;
  config: AppConfig;
  db: HealthDatabase;
  logger?: MetadataLogger;
}

interface StartServerOptions {
  openDatabase?: (dbPath: string) => HealthDatabase;
  registerSignalHandlers?: boolean;
}

const DEFAULT_LOGGER: MetadataLogger = {
  error: (event) => console.error(JSON.stringify(event)),
  info: (event) => console.info(JSON.stringify(event)),
};

export function createHealthImportServer({
  closeDatabaseOnClose = false,
  config,
  db,
  logger = DEFAULT_LOGGER,
}: ServerDependencies): FastifyInstance {
  const server = Fastify({ bodyLimit: config.maxBodyBytes, logger: false });

  server.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    if (request.url.startsWith("/apple-health/")) {
      reply.header("Cache-Control", "no-store");
    }
  });

  void server.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
  });

  if (closeDatabaseOnClose) {
    server.addHook("onClose", async () => {
      if (db.open) db.close();
    });
  }

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
    if (hasStatusCode(error, 429)) {
      void reply.code(429).send({
        error: { category: "rate_limit", message: "Rate limit exceeded" },
        ok: false,
      });
      return;
    }

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

  void server.register(async (routes) => {
    registerOpenApiRoutes(routes, config);
    registerAppleHealthRoutes(routes, { config, db, logger });
    registerNotFoundRoute(routes);
  });

  return server;
}

export async function startServer(
  config: AppConfig = loadConfig(),
  options: StartServerOptions = {},
): Promise<FastifyInstance> {
  const db = (options.openDatabase ?? openDatabase)(config.dbPath);
  let server: FastifyInstance | undefined;

  try {
    server = createHealthImportServer({ closeDatabaseOnClose: true, config, db });
    if (options.registerSignalHandlers) registerGracefulShutdown(server);

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
  } catch (error) {
    if (server) await server.close().catch(() => undefined);
    if (db.open) db.close();
    throw error;
  }
}

function registerGracefulShutdown(server: FastifyInstance): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(JSON.stringify({ event: "server_stopping", signal }));

    try {
      await server.close();
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          event: "server_stop_failed",
          signal,
        }),
      );
      process.exitCode = 1;
    }
  };

  const onSigint = (): void => void shutdown("SIGINT");
  const onSigterm = (): void => void shutdown("SIGTERM");

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  server.addHook("onClose", async () => {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  });
}

function hasErrorCode(error: unknown, code: string): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function hasStatusCode(error: unknown, statusCode: number): error is { statusCode: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === statusCode
  );
}

if (import.meta.main) {
  await startServer(loadConfig(), { registerSignalHandlers: true });
}
