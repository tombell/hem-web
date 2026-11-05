import type { components } from "./api.generated";

export type DailyMetric = components["schemas"]["DailyMetricQueryRow"];
export type Workout = components["schemas"]["WorkoutQueryRow"];
export type Sleep = components["schemas"]["SleepQueryRow"];
export type Source = components["schemas"]["SourceSummary"];
export type Import = components["schemas"]["ImportMetadata"];

export class ApiError extends Error {
  constructor(public status: number) {
    super(
      status === 401
        ? "Your token was not accepted. Connect again with a valid token."
        : status === 429
          ? "Too many requests. Wait a moment, then refresh."
          : "Could not load health data. Check the server and try again.",
    );
  }
}

export async function collection<T>(
  endpoint: string,
  key: string,
  token: string,
  filters: Record<string, string>,
  signal: AbortSignal,
): Promise<T[]> {
  const params = new URLSearchParams({ ...filters, limit: "1000" });
  const rows: T[] = [];
  const cursors = new Set<string>();
  for (let page = 0; page < 100; page++) {
    // Pages depend on the cursor returned by the previous response.
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(`../apple-health/${endpoint}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
      cache: "no-store",
    });
    if (!response.ok) throw new ApiError(response.status);
    // eslint-disable-next-line no-await-in-loop
    const body = await response.json();
    if (!Array.isArray(body[key]) || typeof body.hasMore !== "boolean")
      throw new Error("Unexpected response from the server.");
    rows.push(...body[key]);
    if (!body.hasMore) return rows;
    if (typeof body.nextCursor !== "string" || cursors.has(body.nextCursor))
      throw new Error("The server returned an invalid page cursor.");
    cursors.add(body.nextCursor);
    params.set("cursor", body.nextCursor);
  }
  throw new Error("This range contains too many records. Choose a shorter range.");
}

export function label(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/^./, (s) => s.toUpperCase());
}
export function day(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function rangeDays(start: string, end: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
  const first = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (
    !Number.isFinite(+first) ||
    !Number.isFinite(+last) ||
    first.toISOString().slice(0, 10) !== start ||
    last.toISOString().slice(0, 10) !== end
  )
    return [];
  const count = Math.round((+last - +first) / 86400000) + 1;
  if (count < 1 || count > 366) return [];
  return Array.from({ length: count }, (_, i) =>
    new Date(+first + i * 86400000).toISOString().slice(0, 10),
  );
}
export function timestampRange(start: string, end: string): { start: string; end: string } {
  const last = new Date(`${end}T00:00:00`);
  last.setDate(last.getDate() + 1);
  return { start: new Date(`${start}T00:00:00`).toISOString(), end: last.toISOString() };
}
export function metricSeries(rows: DailyMetric[]) {
  const groups = new Map<
    string,
    { key: string; metric: string; unit: string; rows: DailyMetric[] }
  >();
  for (const row of rows) {
    const key = JSON.stringify([row.metric, row.unit]);
    if (!groups.has(key)) groups.set(key, { key, metric: row.metric, unit: row.unit, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()].toSorted((a, b) => a.metric.localeCompare(b.metric));
}
export const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
/** Hides HealthKit's dimensionless "count" unit, which reads as noise next to a value. */
export function unitLabel(unit: string): string {
  return unit === "count" ? "" : unit;
}
export function quantity(value: { value: number; unit: string } | null) {
  return value ? `${number.format(value.value)} ${value.unit}` : "—";
}

export function sourceName(source: unknown, index: number): string {
  if (source && typeof source === "object") {
    if ("deviceName" in source && typeof source.deviceName === "string") return source.deviceName;
    if ("app" in source && typeof source.app === "string") return source.app;
  }
  return `Source ${index + 1}`;
}
