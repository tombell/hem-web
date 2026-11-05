/** @jsxImportSource preact */
import { label, metricSeries, number, unitLabel, type DailyMetric } from "../data";
import { calendarDate } from "../date-time";
import { DataTable } from "./data-table";
import { Empty } from "./empty";
import { MetricChart, Sparkline } from "./metric-chart";

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
  return groups.length ? (
    <>
      {overview && (
        <div class="mb-4 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] border-t border-l border-line">
          {groups.map((group) => {
            const latest = group.rows.at(-1)!;
            const current = group.key === selected?.key;
            return (
              <button
                class={`flex flex-col border-r border-b border-line p-4 text-left hover:bg-accent-soft/50 ${current ? "bg-accent-soft/60 shadow-[inset_0_2px_0_var(--color-accent)]" : "bg-surface/80"}`}
                key={group.key}
                aria-pressed={current}
                onClick={() => onSelectMetric(group.key)}
              >
                <p class="eyebrow">{label(group.metric)}</p>
                <p class="glow mt-2 text-2xl font-semibold text-accent tabular-nums">
                  {number.format(latest.value)}{" "}
                  <span class="text-sm font-normal text-muted">{unitLabel(group.unit)}</span>
                </p>
                <div class="mt-3">
                  <Sparkline rows={group.rows} dates={dates} />
                </div>
                <p class="mt-3 text-xs text-muted">
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
              <h2 class="text-lg tracking-[0.12em] text-accent uppercase">
                {label(selected.metric)}
              </h2>
              <p class="mt-1 subtle">
                Daily values{unitLabel(selected.unit) && ` · ${selected.unit}`} ·{" "}
                {selected.rows.length} of {dates.length} days recorded
              </p>
            </div>
            <label class="flex items-center gap-3 text-xs font-medium text-muted">
              Metric
              <select value={selected.key} onChange={(e) => onSelectMetric(e.currentTarget.value)}>
                {groups.map((group) => (
                  <option key={group.key} value={group.key}>
                    {label(group.metric)} · {group.unit}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <MetricChart rows={selected.rows} dates={dates} unit={selected.unit} />
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
