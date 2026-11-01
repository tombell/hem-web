/** @jsxImportSource preact */
import { useEffect, useMemo, useState } from "preact/hooks";

import {
  ApiError,
  sourceName,
  collection,
  day,
  rangeDays,
  timestampRange,
  type DailyMetric,
  type Import,
  type Sleep,
  type Source,
  type Workout,
} from "../data";
import { dateTime } from "../date-time";
import { useFilters } from "../hooks/use-filters";
import { Brand } from "./brand";
import { Empty } from "./empty";
import { ImportsView } from "./imports-view";
import { MetricsView } from "./metrics-view";
import { SleepView } from "./sleep-view";
import { WorkoutsView } from "./workouts-view";

const views = ["Overview", "Metrics", "Sleep", "Workouts", "Imports"] as const;
type View = (typeof views)[number];
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function Dashboard({
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
              {(view === "Overview" || view === "Metrics") && (
                <MetricsView
                  rows={data.metrics}
                  dates={dates}
                  overview={view === "Overview"}
                  metric={params.get("metric")}
                  onOpenMetric={(metric) => update({ metric, view: "Metrics" })}
                  onSelectMetric={(metric) => update({ metric })}
                />
              )}
              {view === "Workouts" && <WorkoutsView rows={data.workouts} />}
              {view === "Sleep" &&
                (data.sleep.length ? (
                  <SleepView rows={data.sleep} />
                ) : (
                  <Empty
                    title="No sleep records in this range"
                    text="Sleep stages will appear once they are included in an import."
                  />
                ))}
              {view === "Imports" && <ImportsView rows={data.imports} />}
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
