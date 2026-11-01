/** @jsxImportSource preact */
import { day, label, type Sleep } from "../data";
import { dateTime } from "../date-time";
import { DataTable } from "./data-table";

export function SleepView({ rows }: { rows: Sleep[] }) {
  const groups = new Map<string, Sleep[]>();
  for (const row of rows) {
    const date = day(new Date(row.start));
    const group = groups.get(date) ?? [];
    group.push(row);
    groups.set(date, group);
  }
  const colors: Record<string, string> = {
    asleepDeep: "bg-indigo-700",
    asleepCore: "bg-indigo-400",
    asleepREM: "bg-violet-400",
    awake: "bg-amber-400",
    inBed: "bg-slate-300",
  };
  return (
    <div class="space-y-5">
      <p class="subtle">
        Grouped by the local date each record starts. Each interval is shown separately, including
        overlaps and time in bed.
      </p>
      {[...groups].toReversed().map(([date, records]) => {
        const first = Math.min(...records.map((row) => Date.parse(row.start)));
        const last = Math.max(...records.map((row) => Date.parse(row.end)));
        const span = last - first || 1;
        return (
          <section class="panel" key={date}>
            <h2 class="text-lg font-semibold">{date}</h2>
            <div class="mt-4 space-y-3">
              {records.map((row) => (
                <div key={row.id} class="grid grid-cols-[110px_1fr] items-center gap-3">
                  <span class="text-xs text-muted">{label(row.value)}</span>
                  <div class="h-5 rounded bg-paper">
                    <div
                      class={`h-5 min-w-0.5 rounded ${colors[row.value] ?? "bg-slate-500"}`}
                      style={{
                        marginLeft: `${((Date.parse(row.start) - first) / span) * 100}%`,
                        width: `${((Date.parse(row.end) - Date.parse(row.start)) / span) * 100}%`,
                      }}
                      title={`${label(row.value)}: ${dateTime(row.start)} to ${dateTime(row.end)}`}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p class="mt-3 text-right text-xs text-muted">
              {dateTime(new Date(first).toISOString())} to {dateTime(new Date(last).toISOString())}
            </p>
            <details class="mt-4">
              <summary class="cursor-pointer text-sm text-accent">View recorded intervals</summary>
              <DataTable headings={["Stage", "Start", "End"]}>
                {records.map((row) => (
                  <tr key={row.id}>
                    <td>{label(row.value)}</td>
                    <td>{dateTime(row.start)}</td>
                    <td>{dateTime(row.end)}</td>
                  </tr>
                ))}
              </DataTable>
            </details>
          </section>
        );
      })}
    </div>
  );
}
