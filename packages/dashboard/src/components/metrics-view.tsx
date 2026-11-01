/** @jsxImportSource preact */
import { label, metricSeries, number, type DailyMetric } from "../data";
import { DataTable } from "./data-table";
import { Empty } from "./empty";
import { MetricChart } from "./metric-chart";

export function MetricsView({
  rows,
  dates,
  overview,
  metric,
  onOpenMetric,
  onSelectMetric,
}: {
  rows: DailyMetric[];
  dates: string[];
  overview: boolean;
  metric: string | null;
  onOpenMetric: (key: string) => void;
  onSelectMetric: (key: string) => void;
}) {
  const groups = metricSeries(rows);
  const selected = groups.find((group) => group.key === metric) ?? groups[0];
  return groups.length ? (
    <>
      {overview && (
        <div class="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {groups.map((group) => {
            const latest = group.rows.at(-1)!;
            return (
              <button
                class="panel text-left transition-colors hover:border-accent"
                key={group.key}
                onClick={() => onOpenMetric(group.key)}
              >
                <p class="subtle">{label(group.metric)}</p>
                <p class="mt-4 text-3xl font-semibold tracking-tight">
                  {number.format(latest.value)}{" "}
                  <span class="text-sm font-normal text-muted">{group.unit}</span>
                </p>
                <p class="mt-3 text-xs text-muted">Latest recorded · {latest.date}</p>
              </button>
            );
          })}
        </div>
      )}
      {selected && (
        <section class="panel">
          <div class="mb-7 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 class="text-lg font-semibold">{label(selected.metric)}</h2>
              <p class="mt-1 subtle">Daily values · {selected.unit}</p>
            </div>
            <label class="text-xs text-muted">
              Metric
              <select
                class="ml-3"
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
          <MetricChart rows={selected.rows} dates={dates} unit={selected.unit} />
          <details class="mt-6">
            <summary class="cursor-pointer text-sm font-medium text-accent">
              View daily values
            </summary>
            <DataTable headings={["Date", `Value · ${selected.unit}`]}>
              {dates.map((date) => (
                <tr key={date}>
                  <td>{date}</td>
                  <td>
                    {selected.rows.find((row) => row.date === date)?.value === undefined
                      ? "No data"
                      : number.format(selected.rows.find((row) => row.date === date)!.value)}
                  </td>
                </tr>
              ))}
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
