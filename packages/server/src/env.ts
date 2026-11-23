import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";

export type Env = Record<string, string | undefined>;

export function loadEnvFiles(startDirectory = process.cwd(), env: Env = process.env): Env {
  for (const path of findEnvFiles(startDirectory)) {
    applyEnvFile(path, env);
  }

  return env;
}

function findEnvFiles(startDirectory: string): string[] {
  const paths: string[] = [];
  let directory = startDirectory;

  while (true) {
    const path = join(directory, ".env");
    if (existsSync(path)) {
      paths.unshift(path);
    }

    const parent = dirname(directory);
    if (parent === directory || directory === parse(directory).root) {
      return paths;
    }

    directory = parent;
  }
}

function applyEnvFile(path: string, env: Env): void {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const entry = parseEnvLine(line);
    if (!entry || env[entry.key] !== undefined) {
      continue;
    }

    env[entry.key] = entry.value;
  }
}

function parseEnvLine(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }

  const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7).trimStart() : trimmed;
  const equalsIndex = withoutExport.indexOf("=");
  if (equalsIndex <= 0) {
    return undefined;
  }

  const key = withoutExport.slice(0, equalsIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
    return undefined;
  }

  return { key, value: parseEnvValue(withoutExport.slice(equalsIndex + 1).trim()) };
}

function parseEnvValue(rawValue: string): string {
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    return rawValue.slice(1, -1).replaceAll("\\n", "\n").replaceAll("\\r", "\r");
  }

  if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
    return rawValue.slice(1, -1);
  }

  const commentIndex = rawValue.search(/\s#/u);
  return (commentIndex === -1 ? rawValue : rawValue.slice(0, commentIndex)).trimEnd();
}
