import { describe, expect, test } from "vite-plus/test";

import { openDatabase } from "../src/db";
import { importHealthPayload } from "../src/importer";
import { validateHealthPayload } from "../src/payload";
import { samplePayloads } from "../src/sample-data";

describe("sample data", () => {
  const now = new Date("2026-11-05T09:30:00Z");

  test("produces valid weekly imports for both sources that load into the database", () => {
    const payloads = samplePayloads({ days: 60, now });
    const db = openDatabase(":memory:");
    for (const payload of payloads) {
      const result = validateHealthPayload(JSON.parse(JSON.stringify(payload)));
      expect(result).toMatchObject({ ok: true });
      expect(importHealthPayload(db, payload, JSON.stringify(payload)).status).toBe("created");
    }
    expect(new Set(payloads.map((payload) => payload.source.deviceName))).toEqual(
      new Set(["Sample iPhone", "Sample Apple Watch"]),
    );
    for (const key of ["samples", "sleep", "workouts"] as const)
      expect(payloads.some((payload) => payload[key].length)).toBe(true);
    // Whichever source the dashboard selects first, its overview has metrics to show.
    for (const name of ["Sample iPhone", "Sample Apple Watch"])
      expect(payloads.some((p) => p.source.deviceName === name && p.dailyMetrics.length)).toBe(
        true,
      );
    db.close();
  });

  test("keeps records in the past and is repeatable for the same seed", () => {
    const payloads = samplePayloads({ days: 30, now, seed: 7 });
    const records = payloads.flatMap((p) => [...p.sleep, ...p.workouts, ...p.samples]);
    expect(records.every((row) => Date.parse(row.end) <= +now)).toBe(true);
    expect(samplePayloads({ days: 30, now, seed: 7 })).toEqual(payloads);
  });
});
