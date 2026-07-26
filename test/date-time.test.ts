import { describe, expect, test } from "vitest";

import { parseIsoDate, parseRfc3339, requireEpochMilliseconds } from "../src/date-time";

describe("date and time parsing", () => {
  test("normalizes equivalent RFC 3339 offsets", () => {
    expect(parseRfc3339("2026-06-15T00:30:00+01:00")).toBe(parseRfc3339("2026-06-14T23:30:00Z"));
  });

  test.each([
    "2026-06-15",
    "2026-02-30T00:00:00Z",
    "2026-06-15T24:00:00Z",
    "2026-06-15T00:00:00+24:00",
    "0000-01-01T00:00:00Z",
  ])("rejects invalid RFC 3339 timestamp %s", (value) => {
    expect(parseRfc3339(value)).toBeUndefined();
    expect(() => requireEpochMilliseconds(value)).toThrow("Invalid RFC 3339 timestamp");
  });

  test("validates leap days", () => {
    expect(parseIsoDate("2000-02-29")).toBe(true);
    expect(parseIsoDate("1900-02-29")).toBe(false);
    expect(parseIsoDate("2026-2-01")).toBe(false);
  });
});
