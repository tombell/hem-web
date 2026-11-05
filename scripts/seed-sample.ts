// Rebuilds data/sample.sqlite with fictional health data for dashboard development.
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { openDatabase } from "../src/db.ts";
import { importHealthPayload } from "../src/importer.ts";
import { validateHealthPayload } from "../src/payload.ts";
import { samplePayloads } from "../src/sample-data.ts";

const { values } = parseArgs({
  // pnpm forwards a literal "--" separator; ignore it so either spelling works.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { days: { type: "string", default: "120" }, seed: { type: "string", default: "1" } },
});
const days = Number(values.days);
const seed = Number(values.seed);
if (!Number.isInteger(days) || days < 1 || days > 1000) throw new Error("--days must be 1–1000");
if (!Number.isInteger(seed)) throw new Error("--seed must be an integer");

const dbPath = resolve(dirname(fileURLToPath(import.meta.url)), "../data/sample.sqlite");
for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });

const db = openDatabase(dbPath);
const totals: Record<string, number> = {};
let imports = 0;
for (const payload of samplePayloads({ days, seed })) {
  const result = validateHealthPayload(JSON.parse(JSON.stringify(payload)));
  if (!result.ok) throw new Error(`Generated payload is invalid: ${result.error}`);
  const raw = JSON.stringify(result.payload);
  const { counts } = importHealthPayload(db, result.payload, raw);
  for (const [key, count] of Object.entries(counts)) totals[key] = (totals[key] ?? 0) + count;
  imports++;
}
db.close();

console.log(`Wrote ${imports} imports covering ${days} days to ${dbPath}`);
console.log(totals);
