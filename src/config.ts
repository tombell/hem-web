import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFiles, type Env } from "./env";

export interface AppConfig {
  bearerToken: string;
  dbPath: string;
  host: string;
  maxBodyBytes: number;
  port: number;
}

const DEFAULT_DB_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../data/hem.sqlite");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_MAX_BODY_BYTES = 5_242_880;
const DEFAULT_PORT = 3000;

export function loadConfig(env: Env = loadEnvFiles()): AppConfig {
  const bearerToken = env.HERMES_HEALTH_BEARER_TOKEN?.trim();
  if (!bearerToken) {
    throw new Error("HERMES_HEALTH_BEARER_TOKEN is required");
  }

  return {
    bearerToken,
    dbPath: env.HERMES_HEALTH_DB_PATH?.trim() || DEFAULT_DB_PATH,
    host: env.HOST?.trim() || DEFAULT_HOST,
    maxBodyBytes: parsePositiveInteger(
      env.HERMES_HEALTH_MAX_BODY_BYTES,
      DEFAULT_MAX_BODY_BYTES,
      "HERMES_HEALTH_MAX_BODY_BYTES",
    ),
    port: parsePositiveInteger(env.PORT, DEFAULT_PORT, "PORT"),
  };
}

function parsePositiveInteger(
  rawValue: string | undefined,
  defaultValue: number,
  name: string,
): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}
