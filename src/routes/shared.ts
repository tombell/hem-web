import { timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

export interface MetadataLogger {
  error: (event: Record<string, unknown>) => void;
  info: (event: Record<string, unknown>) => void;
}

export interface ParsedJsonBody {
  parsed: unknown;
  raw: string;
}

export function isAuthorized(request: FastifyRequest, bearerToken: string): boolean {
  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  const actual = Buffer.from(match[1]);
  const expected = Buffer.from(bearerToken);
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

export function isJsonRequest(request: FastifyRequest): boolean {
  return (
    request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() === "application/json"
  );
}

export function sendJson(
  reply: FastifyReply,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): FastifyReply {
  return reply.headers(headers).code(status).send(body);
}

export function logError(logger: MetadataLogger, startedAt: number, category: string): void {
  logger.error({
    category,
    durationMs: elapsedMs(startedAt),
    event: "apple_health_import_error",
  });
}

export function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}
