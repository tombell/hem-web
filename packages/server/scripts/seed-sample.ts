// Rebuilds data/sample.sqlite with fictional health data for dashboard development.
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { openDatabase } from "../src/db.ts";
import { importHealthPayload } from "../src/importer.ts";
import type { ImportCounts } from "../src/importer.ts";
import { validateHealthPayload } from "../src/payload.ts";
import { samplePayloads } from "../src/sample-data.ts";

const { values } = parseArgs({
  // pnpm forwards a literal "--" separator; ignore it so either spelling works.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { days: { type: "string", default: "120" }, seed: { type: "string", default: "1" } },
});
const days = Number(values.days);
const seed = Number(values.seed);
if (!Number.isInteger(days) || days < 1 || days > 1000) {
  throw new Error("--days must be 1–1000");
}
if (!Number.isInteger(seed)) {
  throw new Error("--seed must be an integer");
}

const dbPath = resolve(import.meta.dirname, "../data/sample.sqlite");
for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(`${dbPath}${suffix}`, { force: true });
}

const db = openDatabase(dbPath);
const totals: ImportCounts = {
  categorySamples: 0,
  dailyMetrics: 0,
  samples: 0,
  sleep: 0,
  workouts: 0,
};
let imports = 0;
for (const payload of samplePayloads({ days, seed })) {
  // Round-trip through JSON to validate the payload as the API receives it.
  // eslint-disable-next-line unicorn/prefer-structured-clone
  const result = validateHealthPayload(JSON.parse(JSON.stringify(payload)));
  if (!result.ok) {
    throw new Error(`Generated payload is invalid: ${result.error}`);
  }
  const raw = JSON.stringify(result.payload);
  const { counts } = importHealthPayload(db, result.payload, raw);
  totals.categorySamples += counts.categorySamples;
  totals.dailyMetrics += counts.dailyMetrics;
  totals.samples += counts.samples;
  totals.sleep += counts.sleep;
  totals.workouts += counts.workouts;
  imports++;
}
db.close();

console.log(`Wrote ${imports} imports covering ${days} days to ${dbPath}`);
console.log(totals);
