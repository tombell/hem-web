/** @jsxImportSource preact */
import { label, metricSeries, number, unitLabel, type DailyMetric } from "../data";
import { calendarDate } from "../date-time";
import { DataTable } from "./data-table";
import { Empty } from "./empty";
import { markers, MetricChart, Sparkline } from "./metric-chart";

/** Card tilts, cycled so the overview reads like notes pinned to a board. */
const tilts = [
  "sm:rotate-[-0.8deg]",
  "sm:rotate-[0.6deg]",
  "sm:rotate-[-0.3deg]",
  "sm:rotate-[0.9deg]",
];

export function MetricsView({
  rows,
  dates,
  overview,
  metric,
  onSelectMetric,
}: {
  rows: DailyMetric[];
  dates: string[];
  overview: boolean;
  metric: string | null;
  onSelectMetric: (key: string) => void;
}) {
  const groups = metricSeries(rows);
  const selected = groups.find((group) => group.key === metric) ?? groups[0];
  const marker = (key: string) =>
    markers[groups.findIndex((group) => group.key === key) % markers.length];
  return groups.length ? (
    <>
      {overview && (
        <div class="mb-6 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] sm:gap-4">
          {groups.map((group, index) => {
            const latest = group.rows.at(-1)!;
            const current = group.key === selected?.key;
            return (
              <button
                class={`sketch wiggle flex flex-col p-3 text-left sm:p-4 ${tilts[index % tilts.length]} ${current ? "bg-hl-yellow/45 shadow-[3px_4px_0_var(--color-ink)]" : "hover:bg-hl-yellow/20"}`}
                key={group.key}
                aria-pressed={current}
                onClick={() => onSelectMetric(group.key)}
              >
                <p class="font-hand text-xl leading-tight font-semibold text-muted">
                  {label(group.metric)}
                </p>
                <p class="mt-1 text-2xl font-extrabold tabular-nums">
                  {number.format(latest.value)}{" "}
                  <span class="text-sm font-semibold text-muted">{unitLabel(group.unit)}</span>
                </p>
                <div class="mt-2">
                  <Sparkline rows={group.rows} dates={dates} marker={marker(group.key)} />
                </div>
                <p class="mt-2 text-xs text-muted">
                  Latest<span class="hidden sm:inline"> recorded</span> ·{" "}
                  {calendarDate(latest.date)}
                </p>
              </button>
            );
          })}
        </div>
      )}
      {selected && (
        <section class="panel">
          <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="font-hand text-4xl font-bold">
                <span
                  class="underline-drawn"
                  style={{ "--ul": `var(--color-${marker(selected.key)})` }}
                >
                  {label(selected.metric)}
                </span>
              </h2>
              <p class="mt-3 subtle">
                Daily values{unitLabel(selected.unit) && ` · ${selected.unit}`} ·{" "}
                {selected.rows.length} of {dates.length} days recorded
              </p>
            </div>
            <label class="flex items-center gap-3 font-hand text-lg font-semibold text-muted">
              Metric
              <select
                class="font-sans"
                value={selected.key}
                onChange={(e) => onSelectMetric(e.currentTarget.value)}
              >
                {groups.map((group) => (
                  <option key={group.key} value={group.key}>
                    {label(group.metric)} · {group.unit}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <MetricChart
            rows={selected.rows}
            dates={dates}
            unit={selected.unit}
            marker={marker(selected.key)}
          />
          <details class="mt-4" open={!overview}>
            <summary>Daily values</summary>
            <DataTable headings={["Date", `Value · ${selected.unit}`]}>
              {dates.map((date) => {
                const value = selected.rows.find((row) => row.date === date)?.value;
                return (
                  <tr key={date}>
                    <td>{date}</td>
                    <td class={value === undefined ? "text-muted" : ""}>
                      {value === undefined ? "No data" : number.format(value)}
                    </td>
                  </tr>
                );
              })}
            </DataTable>
          </details>
        </section>
      )}
    </>
  ) : (
    <Empty
      title="No daily metrics in this range"
      text="Try another date range or source. Missing records are never counted as zero."
    />
  );
}
