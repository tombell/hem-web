import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";

import { type AppConfig, loadConfig } from "./config.ts";
import type { HealthDatabase } from "./db.ts";
import { openDatabase } from "./db.ts";
import { registerAppleHealthRoutes } from "./routes/apple-health-routes.ts";
import { registerHealthRoutes } from "./routes/health-routes.ts";
import { registerNotFoundRoute } from "./routes/not-found-routes.ts";
import { registerOpenApiRoutes } from "./routes/openapi-routes.ts";
import type { MetadataLogger, ParsedJsonBody } from "./routes/shared.ts";

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
  const requestStartedAt = new WeakMap<object, number>();

  server.addHook("onRequest", async (request, reply) => {
    requestStartedAt.set(request, performance.now());
    reply.header("X-Content-Type-Options", "nosniff");
    const path = request.url.split("?", 1)[0];
    if (path.startsWith("/apple-health/") || path === "/health" || path === "/ready") {
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

  server.setErrorHandler((error, request, reply) => {
    let category = "server_error";
    let message = "Request failed";
    let status = 500;

    if (hasStatusCode(error, 429)) {
      category = "rate_limit";
      message = "Rate limit exceeded";
      status = 429;
    } else if (hasErrorCode(error, "FST_ERR_CTP_BODY_TOO_LARGE")) {
      category = "body_too_large";
      message = "Request body too large";
      status = 413;
    } else if (error instanceof SyntaxError) {
      category = "invalid_payload";
      message = "Invalid JSON";
      status = 400;
    }

    logger.error({
      category,
      durationMs: elapsedSince(requestStartedAt.get(request)),
      errorCode: getErrorCode(error),
      errorName: error instanceof Error ? error.name : "UnknownError",
      event: "http_request_error",
      method: request.method,
      route: request.routeOptions.url,
      status,
    });

    void reply.code(status).send({ error: { category, message }, ok: false });
  });

  void server.register(async (routes) => {
    registerOpenApiRoutes(routes, config);
    registerHealthRoutes(routes, { db, logger });
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

function elapsedSince(startedAt: number | undefined): number {
  if (startedAt === undefined) return 0;
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
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
