import { useStore } from "@nanostores/preact";
/** @jsxImportSource preact */
import { useEffect, useMemo, useState } from "preact/hooks";

import {
  ApiError,
  sourceName,
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
import type { Session } from "../queries";
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
/** Each view has its own highlighter, used for the nav swipe and page title. */
const colours = {
  Overview: "hl-yellow",
  Metrics: "hl-pink",
  Sleep: "hl-blue",
  Workouts: "hl-green",
  Imports: "hl-orange",
} as const;
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function Dashboard({
  session,
  sources: initialSources,
  disconnect,
}: {
  session: Session;
  sources: Source[];
  disconnect: (message?: string) => void;
}) {
  const sourceResult = useStore(session.$sources);
  const sources = sourceResult.data ?? initialSources;
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
  const endpoint = view === "Overview" || view === "Metrics" ? "daily-metrics" : view.toLowerCase();
  const request = useMemo(() => {
    if (!sourceKey || !dates.length) return undefined;
    const filters: Record<string, string> =
      endpoint === "daily-metrics"
        ? { sourceKey, startDate: start, endDate: end }
        : { sourceKey, ...timestampRange(start, end) };
    return session.query<DailyMetric | Workout | Sleep | Import>(
      endpoint,
      endpoint === "daily-metrics" ? "dailyMetrics" : endpoint,
      filters,
    );
  }, [session, sourceKey, start, end, endpoint]);
  useEffect(() => () => request?.cancel(), [request]);
  const result = useStore(request?.$store ?? session.$sources);
  const cause = result.error ?? sourceResult.error;
  useEffect(() => {
    if (cause instanceof ApiError && cause.status === 401) disconnect(cause.message);
  }, [cause]);
  const source = sources.find((row) => row.sourceKey === sourceKey);
  const data = result.data
    ? {
        metrics: result.data as DailyMetric[],
        workouts: result.data as Workout[],
        sleep: result.data as Sleep[],
        imports: result.data as Import[],
      }
    : undefined;
  const error = cause?.message;
  const today = day(new Date());
  const activePreset = end === today ? dates.length : 0;
  function preset(days: number) {
    const last = new Date();
    const first = new Date();
    first.setDate(last.getDate() - days + 1);
    update({ start: day(first), end: day(last) });
  }
  function reload() {
    session.$sources.invalidate();
    request?.$store.invalidate();
  }
  return (
    <div class="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside class="border-b-2 border-dashed border-line bg-surface/85 px-5 pt-5 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r-2 lg:border-b-0 lg:border-solid lg:border-r-margin lg:px-4 lg:py-6">
        <div class="flex items-center justify-between lg:px-1">
          <Brand />
          <button
            class="flex items-center gap-1.5 font-hand text-lg font-semibold text-muted hover:text-danger lg:hidden"
            onClick={() => disconnect()}
          >
            <Icon name="logout" class="size-4" />
            Disconnect
          </button>
        </div>
        <nav
          aria-label="Dashboard"
          class="-mx-5 mt-3 flex gap-1 overflow-x-auto px-5 pt-1 pb-3 lg:mx-0 lg:mt-8 lg:flex-col lg:gap-1.5 lg:px-0 lg:pb-0"
        >
          {views.map((item) => (
            <button
              key={item}
              aria-current={view === item ? "page" : undefined}
              onClick={() => update({ view: item })}
              class={`group flex shrink-0 items-center gap-2.5 px-3 py-1 text-left font-hand text-2xl whitespace-nowrap ${view === item ? "font-bold text-ink" : "font-medium text-muted hover:text-ink"}`}
            >
              <Icon name={icons[item]} class="size-4.5" />
              <span
                class={`hl ${colours[item]} ${view === item ? "" : "before:opacity-0 group-hover:before:opacity-45"}`}
              >
                {item}
              </span>
            </button>
          ))}
        </nav>
        <div class="mt-auto hidden border-t-2 border-dashed border-line pt-4 lg:block">
          <Status />
          <p class="mt-3 px-3 font-hand text-lg leading-snug text-muted">
            Recorded data from your selected source. No inferred health scores.
          </p>
          <button
            class="mt-2 flex w-full items-center gap-2.5 px-3 py-1.5 font-hand text-xl font-semibold text-muted hover:text-danger"
            onClick={() => disconnect()}
          >
            <Icon name="logout" class="size-4" />
            Disconnect
          </button>
        </div>
      </aside>
      <main id="main" class="mx-auto w-full max-w-[1400px] px-5 py-6 sm:px-8 lg:px-8 lg:py-8">
        <header class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="eyebrow">
              {source ? sourceName(source.source, sources.indexOf(source)) : "Personal health"}
              {source && <> · Last import {dateTime(source.lastImportedAt)}</>}
            </p>
            <h1 class="mt-1 font-hand text-4xl leading-tight font-bold sm:text-5xl">
              <span class={`hl ${colours[view]}`}>
                {view === "Overview" ? "Your days, at a glance." : view}
              </span>
            </h1>
            <p class="mt-1 text-muted">
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
            <Icon name="refresh" class="size-4" />
            Refresh
          </button>
        </header>
        <section
          aria-label="Filters"
          class="sketch mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
        >
          {sources.length > 1 && (
            <label class="flex min-w-48 flex-1 items-center gap-2 font-hand text-lg font-semibold text-muted">
              <span class="pl-1">Source</span>
              <select
                class="w-full min-w-0 font-sans"
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
          <div role="group" aria-label="Date range presets" class="flex gap-1">
            {[7, 30, 90].map((days) => (
              <button
                key={days}
                aria-pressed={activePreset === days}
                class={`h-9 px-3 font-hand text-xl whitespace-nowrap ${activePreset === days ? "circled font-bold text-ink" : "font-medium text-muted hover:text-ink"}`}
                onClick={() => preset(days)}
              >
                {days} days
              </button>
            ))}
          </div>
          <div class="flex flex-wrap items-center gap-2 font-hand text-lg font-semibold text-muted sm:ml-auto">
            <label class="flex items-center gap-2">
              <span class="sr-only sm:not-sr-only">From</span>
              <input
                type="date"
                class="font-sans"
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
                class="font-sans"
                value={end}
                min={start}
                onInput={(e) => update({ end: e.currentTarget.value })}
              />
            </label>
          </div>
        </section>
        <p class="mt-2 px-1 text-xs text-muted">
          {view === "Overview" || view === "Metrics"
            ? "Dates as recorded in the export."
            : `Times shown in ${zone}.`}
          {!source && " No imports yet."}
        </p>
        <div class="mt-6" aria-live="polite">
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
              <p role="alert" class="font-semibold text-danger">
                {error}
              </p>
              <button class="button mt-4" onClick={reload}>
                Try again
              </button>
            </div>
          ) : !data ? (
            <div class="panel flex items-center gap-3 font-hand text-2xl text-muted" role="status">
              <Pencil />
              <span>Loading your health data…</span>
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
        <footer class="mt-10 border-t-2 border-dashed border-line pt-4 font-hand text-lg text-muted lg:hidden">
          Recorded data from your selected source. No inferred health scores.
        </footer>
      </main>
    </div>
  );
}

/** A pencil that scribbles while data loads; still when motion is reduced. */
function Pencil() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 24" class="h-6 w-12 text-marker-blue">
      <path
        class="motion-safe:animate-[scribble_1.4s_linear_infinite]"
        d="M2 16c4-10 8-10 10 0s6 10 10 0 6-10 10 0 6 10 10 0"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-dasharray="90"
      />
    </svg>
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
    <div class="flex items-center justify-between px-3 text-sm text-muted">
      <span class="flex items-center gap-2">
        <span
          aria-hidden="true"
          class="size-2.5 rounded-full border-2 border-marker-green bg-hl-green"
        />
        Link secure
      </span>
      <time class="tabular-nums" dateTime={now.toISOString()}>
        {now.toLocaleTimeString(undefined, { hour12: false })}
      </time>
    </div>
  );
}
