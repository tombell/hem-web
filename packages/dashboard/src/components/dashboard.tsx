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
import { Icon } from "./icons";
import { ImportsView } from "./imports-view";
import { MetricsView } from "./metrics-view";
import { SleepView } from "./sleep-view";
import { WorkoutsView } from "./workouts-view";

const views = ["Overview", "Metrics", "Sleep", "Workouts", "Imports"] as const;
type View = (typeof views)[number];
const icons = {
  Overview: "overview",
  Metrics: "metrics",
  Sleep: "sleep",
  Workouts: "workouts",
  Imports: "imports",
} as const;
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
  const today = day(new Date());
  const activePreset = end === today ? dates.length : 0;
  function preset(days: number) {
    const last = new Date();
    const first = new Date();
    first.setDate(last.getDate() - days + 1);
    update({ start: day(first), end: day(last) });
  }
  function reload() {
    setFailure(undefined);
    setRefresh((n) => n + 1);
  }
  return (
    <div class="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside class="border-b border-line bg-surface px-5 pt-5 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0 lg:px-4 lg:py-6">
        <div class="flex items-center justify-between lg:px-1">
          <Brand />
          <button
            class="flex items-center gap-2 text-sm tracking-wider text-muted uppercase hover:text-accent lg:hidden"
            onClick={() => disconnect()}
          >
            Disconnect
          </button>
        </div>
        <nav
          aria-label="Dashboard"
          class="-mx-5 mt-4 flex gap-px overflow-x-auto px-5 pb-3 lg:mx-0 lg:mt-8 lg:flex-col lg:px-0 lg:pb-0"
        >
          {views.map((item, i) => (
            <button
              key={item}
              aria-current={view === item ? "page" : undefined}
              onClick={() => update({ view: item })}
              class={`flex items-center gap-2.5 border-l-2 px-3 py-1.5 text-left text-sm tracking-[0.15em] whitespace-nowrap uppercase ${view === item ? "glow border-accent bg-accent-soft text-accent" : "border-transparent text-muted hover:bg-accent-soft/50 hover:text-ink"}`}
            >
              <span aria-hidden="true" class="text-xs opacity-60">
                {String(i + 1).padStart(2, "0")}
              </span>
              <Icon name={icons[item]} class="size-3.5" />
              {item}
            </button>
          ))}
        </nav>
        <div class="mt-auto hidden border-t border-line pt-4 lg:block">
          <Status />
          <p class="mt-3 px-3 text-xs leading-relaxed text-muted">
            Recorded data from your selected source. No inferred health scores.
          </p>
          <button
            class="mt-2 flex w-full items-center gap-2.5 px-3 py-1.5 text-sm tracking-[0.15em] text-muted uppercase hover:text-danger"
            onClick={() => disconnect()}
          >
            <Icon name="logout" class="size-3.5" />
            Disconnect
          </button>
        </div>
      </aside>
      <main id="main" class="mx-auto w-full max-w-[1400px] px-5 py-6 sm:px-8 lg:px-8 lg:py-8">
        <header class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="eyebrow">
              {"// "}
              {source ? sourceName(source.source, sources.indexOf(source)) : "Personal health"}
              {source && <> · Last import {dateTime(source.lastImportedAt)}</>}
            </p>
            <h1 class="glow cursor mt-1.5 text-xl font-semibold tracking-[0.12em] text-accent uppercase">
              {view === "Overview" ? "Your days, at a glance." : view}
            </h1>
            <p class="mt-1 subtle">
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
          <button class="button" onClick={reload}>
            <Icon name="refresh" class="size-3.5" />
            Refresh
          </button>
        </header>
        <section
          aria-label="Filters"
          class="mt-5 flex flex-wrap items-center gap-2 border border-line bg-surface p-2"
        >
          {sources.length > 1 && (
            <label class="flex min-w-48 flex-1 items-center gap-2 text-xs font-medium text-muted">
              <span class="pl-1">Source</span>
              <select
                class="w-full min-w-0"
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
          )}
          <div role="group" aria-label="Date range presets" class="flex border border-line">
            {[7, 30, 90].map((days) => (
              <button
                key={days}
                aria-pressed={activePreset === days}
                class={`h-[30px] border-l border-line px-3 text-sm tracking-wider whitespace-nowrap uppercase first:border-l-0 ${activePreset === days ? "glow bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}
                onClick={() => preset(days)}
              >
                {days} days
              </button>
            ))}
          </div>
          <div class="flex flex-wrap items-center gap-2 text-xs font-medium text-muted sm:ml-auto">
            <label class="flex items-center gap-2">
              <span class="sr-only sm:not-sr-only">From</span>
              <input
                type="date"
                value={start}
                max={end}
                onInput={(e) => update({ start: e.currentTarget.value })}
              />
            </label>
            <span aria-hidden="true">–</span>
            <label class="flex items-center gap-2">
              <span class="sr-only">To</span>
              <input
                type="date"
                value={end}
                min={start}
                onInput={(e) => update({ end: e.currentTarget.value })}
              />
            </label>
          </div>
        </section>
        <p class="mt-2 text-xs text-muted">
          {view === "Overview" || view === "Metrics"
            ? "Dates as recorded in the export."
            : `Times shown in ${zone}.`}
          {!source && " No imports yet."}
        </p>
        <div class="mt-5" aria-live="polite">
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
              <p role="alert" class="text-danger">
                {error}
              </p>
              <button class="button mt-4" onClick={reload}>
                Try again
              </button>
            </div>
          ) : !data ? (
            <div class="panel flex items-center gap-3 text-muted" role="status">
              <span class="cursor">Loading your health data…</span>
            </div>
          ) : (
            <>
              {(view === "Overview" || view === "Metrics") && (
                <MetricsView
                  rows={data.metrics}
                  dates={dates}
                  overview={view === "Overview"}
                  metric={params.get("metric")}
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
        <footer class="mt-8 border-t border-line pt-4 text-xs text-muted lg:hidden">
          Recorded data from your selected source. No inferred health scores.
        </footer>
      </main>
    </div>
  );
}

/** Link status and a ticking local clock for the sidebar footer. */
function Status() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div class="flex items-center justify-between px-3 text-xs tracking-[0.15em] text-muted uppercase">
      <span class="flex items-center gap-2">
        <span
          aria-hidden="true"
          class="size-1.5 animate-pulse bg-accent shadow-[0_0_6px_var(--color-accent)]"
        />
        Link secure
      </span>
      <time class="tabular-nums" dateTime={now.toISOString()}>
        {now.toLocaleTimeString(undefined, { hour12: false })}
      </time>
    </div>
  );
}
