import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import {
  ApiError,
  collection,
  metricSeries,
  rangeDays,
  timestampRange,
  type DailyMetric,
} from "./data";

afterEach(() => vi.unstubAllGlobals());

describe("health queries", () => {
  test("follows all pages without dropping filters or authentication", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ dailyMetrics: [{ value: 1 }], hasMore: true, nextCursor: "next" }),
      )
      .mockResolvedValueOnce(
        Response.json({ dailyMetrics: [{ value: 2 }], hasMore: false, nextCursor: null }),
      );
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    expect(
      await collection(
        "daily-metrics",
        "dailyMetrics",
        "secret",
        { sourceKey: "phone", startDate: "2026-11-01" },
        signal,
      ),
    ).toEqual([{ value: 1 }, { value: 2 }]);
    const [url, options] = fetcher.mock.calls[1];
    expect(new URL(url, "http://local").searchParams.get("sourceKey")).toBe("phone");
    expect(new URL(url, "http://local").searchParams.get("startDate")).toBe("2026-11-01");
    expect(new URL(url, "http://local").searchParams.get("cursor")).toBe("next");
    expect(options).toMatchObject({
      headers: { Authorization: "Bearer secret" },
      cache: "no-store",
      signal,
    });
  });
  test("does not expose partial data when a later page fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ rows: [1], hasMore: true, nextCursor: "next" }))
        .mockResolvedValueOnce(new Response(null, { status: 429 })),
    );
    await expect(
      collection("samples", "rows", "secret", {}, new AbortController().signal),
    ).rejects.toMatchObject({ status: 429 });
  });
  test("stops repeated cursors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(Response.json({ rows: [1], hasMore: true, nextCursor: "same" })),
        ),
    );
    await expect(
      collection("samples", "rows", "secret", {}, new AbortController().signal),
    ).rejects.toThrow("invalid page cursor");
  });
  test("reports rejected credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(
      collection("sources", "sources", "secret", {}, new AbortController().signal),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("chart data", () => {
  test("keeps mixed units separate and missing dates absent", () => {
    const rows = [
      { metric: "distance", unit: "km", date: "2026-11-01", value: 2 },
      { metric: "distance", unit: "mi", date: "2026-11-03", value: 3 },
    ] as DailyMetric[];
    const series = metricSeries(rows);
    expect(series).toHaveLength(2);
    expect(series[0].rows).toHaveLength(1);
    expect(rangeDays("2026-11-01", "2026-11-03")).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
  });
  test.each([
    ["2026-02-30", "2026-03-02"],
    ["2026-11-02", "2026-11-01"],
    ["2025-01-01", "2026-11-01"],
    ["bad", "2026-11-01"],
  ])("rejects invalid or unbounded range %s to %s", (start, end) => {
    expect(rangeDays(start, end)).toEqual([]);
  });
  test("uses local calendar midnights for timestamp queries", () => {
    const { start, end } = timestampRange("2026-10-25", "2026-10-25");
    expect(new Date(start).getHours()).toBe(0);
    expect(new Date(end).getDate()).toBe(26);
    expect(new Date(end).getHours()).toBe(0);
  });
});
