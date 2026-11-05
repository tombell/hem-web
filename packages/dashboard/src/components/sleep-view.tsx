/** @jsxImportSource preact */
import { Fragment } from "preact";

import { day, label, type Sleep } from "../data";
import { calendarDate, dateTime, time } from "../date-time";
import { DataTable } from "./data-table";

const stages: Record<string, string> = {
  inBed: "bg-sleep-bed ring-[1.5px] ring-ink/35 ring-inset",
  awake: "bg-sleep-awake",
  asleepREM: "bg-sleep-rem",
  asleepCore: "bg-sleep-core",
  asleepDeep: "bg-sleep-deep",
};
const order = Object.keys(stages);
const hour = 3_600_000;

/** Records starting before midday belong to the previous evening's night. */
function night(row: Sleep) {
  return day(new Date(Date.parse(row.start) - 12 * hour));
}

function hourTicks(first: number, last: number) {
  const step = last - first > 10 * hour ? 2 * hour : hour;
  const start = new Date(first);
  start.setMinutes(0, 0, 0);
  const ticks: number[] = [];
  for (let tick = +start + hour; tick < last; tick += hour)
    if (new Date(tick).getHours() % (step / hour) === 0) ticks.push(tick);
  return ticks;
}

export function SleepView({ rows }: { rows: Sleep[] }) {
  const nights = new Map<string, Sleep[]>();
  for (const row of rows) {
    const key = night(row);
    nights.set(key, [...(nights.get(key) ?? []), row]);
  }
  const present = new Set(rows.map((row) => row.value));
  return (
    <div class="space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p class="subtle max-w-2xl">
          Grouped by night: records that start before midday belong to the previous evening. Each
          interval is shown separately, including overlaps and time in bed.
        </p>
        <ul
          class="flex flex-wrap gap-x-5 gap-y-1 font-hand text-lg font-semibold"
          aria-label="Sleep stages"
        >
          {[...order, ...[...present].filter((value) => !order.includes(value))]
            .filter((value) => present.has(value))
            .map((value) => (
              <li key={value} class="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  class={`h-3 w-6 -rotate-3 rounded-[3px_8px_4px_9px] ${stages[value] ?? "bg-muted"}`}
                />
                {label(value)}
              </li>
            ))}
        </ul>
      </div>
      {[...nights].toReversed().map(([date, records]) => {
        const first = Math.min(...records.map((row) => Date.parse(row.start)));
        const last = Math.max(...records.map((row) => Date.parse(row.end)));
        const span = last - first || 1;
        const position = (value: number) => ((value - first) / span) * 100;
        const ticks = hourTicks(first, last);
        const lanes = [...new Set(records.map((row) => row.value))].toSorted(
          (a, b) =>
            (order.indexOf(a) + 1 || order.length + 1) - (order.indexOf(b) + 1 || order.length + 1),
        );
        return (
          <section class="panel" key={date}>
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <h2 class="font-hand text-3xl font-bold">
                Night of{" "}
                <span class="underline-drawn [--ul:var(--color-marker-blue)]">
                  {calendarDate(date)}
                </span>
              </h2>
              <p class="text-sm text-muted tabular-nums">
                {time(first)} – {time(last)}
              </p>
            </div>
            <div class="mt-4 grid grid-cols-[84px_1fr] gap-x-3 sm:grid-cols-[104px_1fr]">
              <div />
              <div class="relative h-6 font-hand text-base font-semibold text-muted">
                {ticks
                  .filter((tick) => position(tick) > 3 && position(tick) < 97)
                  .map((tick) => (
                    <span
                      key={tick}
                      class="absolute -translate-x-1/2 whitespace-nowrap tabular-nums"
                      style={{ left: `${position(tick)}%` }}
                    >
                      {new Date(tick).toLocaleTimeString(undefined, { hour: "numeric" })}
                    </span>
                  ))}
              </div>
              {lanes.map((value) => (
                <Fragment key={value}>
                  <span class="self-center font-hand text-lg leading-tight font-semibold">
                    {label(value)}
                  </span>
                  <div class="relative my-1 h-6 border-y border-dashed border-line">
                    {ticks.map((tick) => (
                      <span
                        key={tick}
                        aria-hidden="true"
                        class="absolute -inset-y-1 border-l border-dashed border-line"
                        style={{ left: `${position(tick)}%` }}
                      />
                    ))}
                    {records
                      .filter((row) => row.value === value)
                      .map((row) => (
                        <div
                          key={row.id}
                          class={`absolute inset-y-0.5 min-w-0.5 rounded-[3px_7px_4px_8px] opacity-90 ${stages[value] ?? "bg-muted"}`}
                          style={{
                            left: `${position(Date.parse(row.start))}%`,
                            width: `${((Date.parse(row.end) - Date.parse(row.start)) / span) * 100}%`,
                          }}
                          title={`${label(row.value)}: ${time(row.start)} – ${time(row.end)}`}
                        />
                      ))}
                  </div>
                </Fragment>
              ))}
            </div>
            <details class="mt-4">
              <summary>Recorded intervals · {records.length}</summary>
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
