/** @jsxImportSource preact */
import { type ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import {
  ApiError,
  sourceName,
  collection,
  day,
  label,
  metricSeries,
  number,
  quantity,
  rangeDays,
  timestampRange,
  type DailyMetric,
  type Import,
  type Sleep,
  type Source,
  type Workout,
} from "./data";

const views = ["Overview", "Metrics", "Sleep", "Workouts", "Imports"] as const;
type View = (typeof views)[number];
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const dateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function App() {
  const [token, setToken] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [notice, setNotice] = useState("");
  return token ? (
    <Dashboard
      token={token}
      sources={sources}
      disconnect={(message = "") => {
        setToken("");
        setSources([]);
        setNotice(message);
      }}
    />
  ) : (
    <Connect
      notice={notice}
      onConnect={(value, rows) => {
        setSources(rows);
        setToken(value);
        setNotice("");
      }}
    />
  );
}

function Connect({
  onConnect,
  notice,
}: {
  onConnect: (token: string, sources: Source[]) => void;
  notice: string;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);
  const [controller] = useState(() => new AbortController());
  useEffect(() => () => controller.abort(), [controller]);
  return (
    <main class="grid min-h-screen place-items-center p-6">
      <div class="w-full max-w-md">
        <Brand />
        <p class="mt-10 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          Your health, in view
        </p>
        <h1 class="mt-3 text-4xl font-semibold tracking-tight">
          A little perspective
          <br />
          on your everyday.
        </h1>
        <p class="mt-4 leading-relaxed text-muted">
          Explore the health data you’ve imported from Hem.
        </p>
        <form
          class="panel mt-8 space-y-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              const rows = await collection<Source>(
                "sources",
                "sources",
                value.trim(),
                {},
                controller.signal,
              );
              onConnect(value.trim(), rows);
            } catch (cause) {
              if (!controller.signal.aborted)
                setError(cause instanceof Error ? cause.message : "Connection failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label class="block text-sm font-medium">
            Dashboard token
            <input
              class="mt-2 w-full"
              type="password"
              autoComplete="off"
              required
              value={value}
              onInput={(e) => setValue(e.currentTarget.value)}
              placeholder="Enter your read-only token"
            />
          </label>
          <p class="subtle">
            Your token stays in this tab’s memory. Reloading or disconnecting clears it.
          </p>
          {error && (
            <p role="alert" class="text-sm text-red-700">
              {error}
            </p>
          )}
          <button class="primary w-full" disabled={busy || !value.trim()}>
            {busy ? "Connecting…" : "Connect to Hem"}
          </button>
        </form>
        <p class="mt-5 text-center text-xs text-muted">Personal health data. On your own server.</p>
      </div>
    </main>
  );
}
function Brand() {
  return (
    <div class="flex items-center gap-3">
      <span
        aria-hidden="true"
        class="grid size-9 place-items-center rounded-xl bg-ink text-xl font-bold text-white"
      >
        h
      </span>
      <span class="text-xl font-semibold tracking-tight">
        hem<span class="ml-2 text-sm font-normal text-muted">/ health</span>
      </span>
    </div>
  );
}

function useFilters() {
  const [params, setParams] = useState(() => new URLSearchParams(location.search));
  useEffect(() => {
    const onPopState = () => setParams(new URLSearchParams(location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  function update(values: Record<string, string>) {
    const next = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(values)) next.set(key, value);
    history.pushState(null, "", `${location.pathname}?${next}`);
    setParams(next);
  }
  return [params, update] as const;
}

function Dashboard({
  token,
  sources: initialSources,
  disconnect,
}: {
  token: string;
  sources: Source[];
  disconnect: (message?: string) => void;
}) {
  const [sources, setSources] = useState(initialSources);
  const [params, update] = useFilters();
  const requestedView = params.get("view") as View;
  const view = views.includes(requestedView) ? requestedView : "Overview";
  const sourceKey = sources.some((source) => source.sourceKey === params.get("source"))
    ? params.get("source")!
    : sources[0]?.sourceKey || "";
  const end = params.get("end") ?? day(new Date());
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const start = params.get("start") ?? day(weekStart);
  const dates = useMemo(() => rangeDays(start, end), [start, end]);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    metrics: DailyMetric[];
    workouts: Workout[];
    sleep: Sleep[];
    imports: Import[];
  }>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const key = JSON.stringify([sourceKey, start, end, view, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    if (!sourceKey || !dates.length) return () => controller.abort();
    const load = async () => {
      try {
        const interval = { sourceKey, ...timestampRange(start, end) };
        const [metrics, workouts, sleep, imports, freshSources] = await Promise.all([
          view === "Overview" || view === "Metrics"
            ? collection<DailyMetric>(
                "daily-metrics",
                "dailyMetrics",
                token,
                { sourceKey, startDate: start, endDate: end },
                controller.signal,
              )
            : [],
          view === "Workouts"
            ? collection<Workout>("workouts", "workouts", token, interval, controller.signal)
            : [],
          view === "Sleep"
            ? collection<Sleep>("sleep", "sleep", token, interval, controller.signal)
            : [],
          view === "Imports"
            ? collection<Import>("imports", "imports", token, interval, controller.signal)
            : [],
          collection<Source>("sources", "sources", token, {}, controller.signal),
        ]);
        if (!controller.signal.aborted) {
          setFailure(undefined);
          setSources(freshSources);
          setResult({ key, metrics, workouts, sleep, imports });
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) {
          disconnect(cause.message);
          return;
        }
        setFailure({
          key,
          message: cause instanceof Error ? cause.message : "Could not load data.",
        });
      }
    };
    void load();
    return () => controller.abort();
  }, [key, token]);
  const source = sources.find((row) => row.sourceKey === sourceKey);
  const data = result?.key === key ? result : undefined;
  const error = failure?.key === key ? failure.message : undefined;
  const groups = metricSeries(data?.metrics ?? []);
  const selected = groups.find((group) => group.key === params.get("metric")) ?? groups[0];
  function preset(days: number) {
    const last = new Date();
    const first = new Date();
    first.setDate(last.getDate() - days + 1);
    update({ start: day(first), end: day(last) });
  }
  return (
    <div class="min-h-screen lg:grid lg:grid-cols-[230px_1fr]">
      <aside class="border-b border-line bg-white px-5 py-6 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0 lg:px-7 lg:py-9">
        <Brand />
        <p class="mt-10 hidden text-[10px] font-semibold uppercase tracking-[0.2em] text-muted lg:block">
          Your dashboard
        </p>
        <nav aria-label="Dashboard" class="mt-5 flex gap-1 overflow-x-auto lg:flex-col lg:gap-2">
          {views.map((item, i) => (
            <button
              key={item}
              aria-current={view === item ? "page" : undefined}
              onClick={() => update({ view: item })}
              class={`flex items-center gap-3 px-4 py-3 text-left text-sm whitespace-nowrap ${view === item ? "bg-ink font-medium text-white" : "text-muted hover:bg-paper"}`}
            >
              <span class="text-xs opacity-60">0{i + 1}</span>
              {item}
            </button>
          ))}
        </nav>
        <div class="mt-6 lg:mt-auto">
          <p class="hidden text-xs leading-relaxed text-muted lg:block">
            A private view of
            <br />
            your everyday health.
          </p>
          <button
            class="mt-4 text-sm text-muted underline underline-offset-4"
            onClick={() => disconnect()}
          >
            Disconnect
          </button>
        </div>
      </aside>
      <main id="main" class="mx-auto w-full max-w-[1500px] px-5 py-8 sm:px-10 lg:py-10">
        <header class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
              Personal health
            </p>
            <h1 class="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              {view === "Overview" ? "Your days, at a glance." : view}
            </h1>
            <p class="mt-3 subtle">
              {view === "Overview"
                ? "Small details. A clearer picture over time."
                : view === "Metrics"
                  ? "Explore daily values, with gaps kept visible."
                  : view === "Sleep"
                    ? "Recorded sleep stages, shown without combining overlaps."
                    : view === "Workouts"
                      ? "Time spent moving, one session at a time."
                      : "See what arrived and which dates it covers."}
            </p>
          </div>
          <button
            class="button"
            onClick={() => {
              setFailure(undefined);
              setRefresh((n) => n + 1);
            }}
          >
            Refresh
          </button>
        </header>
        <section
          aria-label="Filters"
          class="mt-8 flex flex-wrap items-end gap-4 rounded-2xl border border-line bg-white p-4"
        >
          <label class="min-w-40 flex-1 text-xs font-medium text-muted">
            Source
            <select
              class="mt-1.5 block w-full"
              value={sourceKey}
              onChange={(e) => update({ source: e.currentTarget.value })}
            >
              {sources.map((row, i) => (
                <option key={row.sourceKey} value={row.sourceKey}>
                  {sourceName(row.source, i)} · {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label class="text-xs font-medium text-muted">
            From
            <input
              class="mt-1.5 block"
              type="date"
              value={start}
              onInput={(e) => update({ start: e.currentTarget.value })}
            />
          </label>
          <label class="text-xs font-medium text-muted">
            To
            <input
              class="mt-1.5 block"
              type="date"
              value={end}
              onInput={(e) => update({ end: e.currentTarget.value })}
            />
          </label>
          <div class="flex gap-2">
            <button class="button" onClick={() => preset(7)}>
              7 days
            </button>
            <button class="button" onClick={() => preset(30)}>
              30 days
            </button>
          </div>
        </section>
        <div class="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted">
          <p>
            {view === "Overview" || view === "Metrics"
              ? "Dates as recorded in the export"
              : `Times shown in ${zone}`}
          </p>
          <p>{source ? `Last import ${dateTime(source.lastImportedAt)}` : "No imports yet"}</p>
        </div>
        <div class="mt-7" aria-live="polite">
          {!sourceKey ? (
            <Empty
              title="Your data will appear here"
              text="Import health data from Hem, then reconnect to load your sources."
            />
          ) : !dates.length ? (
            <Empty
              title="Choose a valid date range"
              text="Select an end date on or after the start date, up to 366 days."
            />
          ) : error ? (
            <div class="panel">
              <p role="alert" class="text-red-700">
                {error}
              </p>
              <button
                class="button mt-4"
                onClick={() => {
                  setFailure(undefined);
                  setRefresh((n) => n + 1);
                }}
              >
                Try again
              </button>
            </div>
          ) : !data ? (
            <div class="panel text-muted" role="status">
              Loading your health data…
            </div>
          ) : (
            <>
              {(view === "Overview" || view === "Metrics") &&
                (groups.length ? (
                  <>
                    {view === "Overview" && (
                      <div class="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {groups.map((group) => {
                          const latest = group.rows.at(-1)!;
                          return (
                            <button
                              class="panel text-left transition-colors hover:border-accent"
                              key={group.key}
                              onClick={() => update({ metric: group.key, view: "Metrics" })}
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
                              onChange={(e) => update({ metric: e.currentTarget.value })}
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
                                  {selected.rows.find((row) => row.date === date)?.value ===
                                  undefined
                                    ? "No data"
                                    : number.format(
                                        selected.rows.find((row) => row.date === date)!.value,
                                      )}
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
                ))}
              {view === "Workouts" &&
                (data.workouts.length ? (
                  <section class="panel">
                    <h2 class="text-lg font-semibold">
                      Recorded workouts <span class="text-muted">· {data.workouts.length}</span>
                    </h2>
                    <DataTable headings={["Activity", "Started", "Duration", "Distance", "Energy"]}>
                      {[...data.workouts].toReversed().map((row) => (
                        <tr key={row.id}>
                          <td class="font-medium">{label(row.activityType)}</td>
                          <td>{dateTime(row.start)}</td>
                          <td>{quantity(row.duration)}</td>
                          <td>{quantity(row.distance)}</td>
                          <td>{quantity(row.activeEnergy)}</td>
                        </tr>
                      ))}
                    </DataTable>
                  </section>
                ) : (
                  <Empty
                    title="No workouts in this range"
                    text="Choose another date range to explore your activity."
                  />
                ))}
              {view === "Sleep" &&
                (data.sleep.length ? (
                  <SleepView rows={data.sleep} />
                ) : (
                  <Empty
                    title="No sleep records in this range"
                    text="Sleep stages will appear once they are included in an import."
                  />
                ))}
              {view === "Imports" &&
                (data.imports.length ? (
                  <section class="panel">
                    <h2 class="text-lg font-semibold">Imports overlapping this range</h2>
                    <DataTable headings={["Imported", "Coverage", "Export timezone", "Generated"]}>
                      {data.imports.map((row) => (
                        <tr key={row.id}>
                          <td>{dateTime(row.updatedAt)}</td>
                          <td>
                            {dateTime(row.range.start)}
                            <br />
                            to {dateTime(row.range.end)}
                          </td>
                          <td>{row.range.timeZone}</td>
                          <td>{dateTime(row.generatedAt)}</td>
                        </tr>
                      ))}
                    </DataTable>
                  </section>
                ) : (
                  <Empty
                    title="No imports cover these dates"
                    text="Select another range to inspect your import history."
                  />
                ))}
            </>
          )}
        </div>
        <footer class="mt-10 border-t border-line pt-5 text-xs text-muted">
          Hem · Recorded data from your selected source. No inferred health scores.
        </footer>
      </main>
    </div>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <section class="panel py-16 text-center">
      <h2 class="text-xl font-medium">{title}</h2>
      <p class="mx-auto mt-3 max-w-md subtle">{text}</p>
    </section>
  );
}
function DataTable({ headings, children }: { headings: string[]; children: ComponentChildren }) {
  return (
    <div class="mt-4 overflow-x-auto">
      <table class="w-full">
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading} scope="col">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function MetricChart({
  rows,
  dates,
  unit,
}: {
  rows: DailyMetric[];
  dates: string[];
  unit: string;
}) {
  const values = new Map(rows.map((row) => [row.date, row.value]));
  const min = Math.min(0, ...rows.map((row) => row.value));
  const max = Math.max(0, ...rows.map((row) => row.value));
  const span = max - min || 1;
  const x = (index: number) => 60 + index * (820 / Math.max(1, dates.length - 1));
  const y = (value: number) => 220 - ((value - min) / span) * 190;
  const segments: string[] = [];
  let segment = "";
  dates.forEach((date, index) => {
    const value = values.get(date);
    if (value === undefined) {
      if (segment) segments.push(segment);
      segment = "";
    } else {
      segment += `${segment ? " L" : "M"}${x(index)},${y(value)}`;
    }
  });
  if (segment) segments.push(segment);
  return (
    <>
      <svg
        viewBox="0 0 920 260"
        role="img"
        aria-label={`Daily ${unit} values from ${dates[0]} to ${dates.at(-1)}. Exact values are in the table below.`}
        class="w-full overflow-visible"
      >
        {[0, 0.5, 1].map((part) => (
          <g key={part}>
            <line
              x1="60"
              x2="880"
              y1={y(min + span * part)}
              y2={y(min + span * part)}
              stroke="#dce3da"
              strokeDasharray="3 5"
            />
            <text
              x="48"
              y={y(min + span * part) + 4}
              text-anchor="end"
              fill="#596b65"
              font-size="11"
            >
              {number.format(min + span * part)}
            </text>
          </g>
        ))}
        {segments.map((path, i) => (
          <path key={i} d={path} fill="none" stroke="#266950" stroke-width="2.5" />
        ))}
        {dates.map((date, i) => {
          const value = values.get(date);
          return value === undefined ? null : (
            <circle key={date} cx={x(i)} cy={y(value)} r="3.5" fill="#266950">
              <title>
                {date}: {number.format(value)} {unit}
              </title>
            </circle>
          );
        })}
        <text x="60" y="250" fill="#596b65" font-size="11">
          {dates[0]}
        </text>
        <text x="880" y="250" text-anchor="end" fill="#596b65" font-size="11">
          {dates.at(-1)}
        </text>
      </svg>
      <p class="mt-2 text-xs text-muted">Gaps indicate missing records.</p>
    </>
  );
}

function SleepView({ rows }: { rows: Sleep[] }) {
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
