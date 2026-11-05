/** @jsxImportSource preact */
import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";

import { number, unitLabel, type DailyMetric } from "../data";
import { calendarDate } from "../date-time";

type Point = { index: number; value: number };

/** Splits values into runs of consecutive recorded days so missing days stay as gaps. */
export function runs(dates: string[], values: Map<string, number>): Point[][] {
  const result: Point[][] = [];
  let current: Point[] = [];
  dates.forEach((date, index) => {
    const value = values.get(date);
    if (value === undefined) {
      if (current.length) result.push(current);
      current = [];
    } else current.push({ index, value });
  });
  if (current.length) result.push(current);
  return result;
}

function niceTicks(min: number, max: number) {
  if (max === min) max = min + 1;
  const rough = (max - min) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= rough)! * magnitude;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = lo; tick <= hi + step / 2; tick += step) ticks.push(+tick.toPrecision(12));
  return { lo, hi, ticks };
}

const H = 240;
const LEFT = 48;
const RIGHT = 14;
const TOP = 16;
const BOTTOM = 30;

/** Marker colours cycled across metrics, so each series keeps its own pen. */
export const markers = [
  "marker-blue",
  "marker-pink",
  "marker-green",
  "marker-orange",
  "marker-purple",
] as const;
export type Marker = (typeof markers)[number];

export function MetricChart({
  rows,
  dates,
  unit,
  marker = "marker-blue",
}: {
  rows: DailyMetric[];
  dates: string[];
  unit: string;
  marker?: Marker;
}) {
  const [active, setActive] = useState<number>();
  const id = useId();
  const hatch = `hatch-${id}`;
  const rough = `rough-${id}`;
  const frame = useRef<HTMLDivElement>(null);
  const [W, setWidth] = useState(920);
  useLayoutEffect(() => {
    const element = frame.current!;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth || 920));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const values = new Map(rows.map((row) => [row.date, row.value]));
  const { lo, hi, ticks } = niceTicks(
    Math.min(0, ...rows.map((row) => row.value)),
    Math.max(0, ...rows.map((row) => row.value)),
  );
  const band = (W - LEFT - RIGHT) / dates.length;
  const x = (index: number) => LEFT + (index + 0.5) * band;
  const y = (value: number) => H - BOTTOM - ((value - lo) / (hi - lo)) * (H - TOP - BOTTOM);
  const series = runs(dates, values);
  // Thin the pens on dense ranges so daily swings stay readable.
  const pen = Math.min(3.5, Math.max(1.75, band * 0.6));
  const highlighter = Math.min(10, Math.max(3, band * 1.6));
  // Evenly spaced labels, anchored on the most recent day.
  const maxLabels = Math.max(2, Math.min(7, Math.floor((W - LEFT) / 72)));
  const labelStep = Math.max(1, Math.ceil((dates.length - 1) / (maxLabels - 1)));
  const labelled = new Set(
    dates.map((_, i) => i).filter((i) => (dates.length - 1 - i) % labelStep === 0),
  );
  const activeDate = active === undefined ? undefined : dates[active];
  const activeValue = activeDate === undefined ? undefined : values.get(activeDate);
  const missing = dates.some((date) => !values.has(date));
  return (
    <>
      <div class="relative" ref={frame}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Daily ${unit} values from ${dates[0]} to ${dates.at(-1)}. Exact values are in the table below.`}
          class="w-full overflow-visible select-none"
          onPointerLeave={() => setActive(undefined)}
        >
          <defs>
            {/* Pencil scribble: a zigzag drawn across each missing day. */}
            <pattern
              id={hatch}
              width="10"
              height="10"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(-35)"
            >
              <path
                d="M0 2.5 L10 2.5 M0 7.5 L10 7.5"
                class="stroke-muted"
                stroke-width="1.4"
                stroke-linecap="round"
                opacity="0.55"
              />
            </pattern>
            {/* A slow, fixed wobble so lines look hand-drawn; at most 1.5px of displacement. */}
            <filter id={rough} filterUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
              <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="1" seed="3" />
              <feDisplacementMap in="SourceGraphic" scale="3" />
            </filter>
          </defs>
          {dates.map((date, i) =>
            values.has(date) ? null : (
              <rect
                key={date}
                x={x(i) - band / 2}
                width={band}
                y={TOP}
                height={H - TOP - BOTTOM}
                fill={`url(#${hatch})`}
                filter={`url(#${rough})`}
              />
            ),
          )}
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={LEFT}
                x2={W - RIGHT}
                y1={y(tick)}
                y2={y(tick)}
                class={tick === 0 ? "stroke-ink" : "stroke-line"}
                stroke-dasharray={tick === 0 ? undefined : "6 5"}
                stroke-width={tick === 0 ? 2 : 1.25}
                stroke-linecap="round"
              />
              <text
                x={LEFT - 10}
                y={y(tick) + 4}
                text-anchor="end"
                class="fill-muted tabular-nums"
                font-size="12"
              >
                {number.format(tick)}
              </text>
            </g>
          ))}
          {dates.map((date, i) =>
            labelled.has(i) ? (
              <text
                key={date}
                x={x(i)}
                y={H - 6}
                text-anchor={
                  dates.length === 1
                    ? "middle"
                    : i === 0
                      ? "start"
                      : i === dates.length - 1
                        ? "end"
                        : "middle"
                }
                dx={
                  dates.length === 1
                    ? 0
                    : i === 0
                      ? -band / 2
                      : i === dates.length - 1
                        ? band / 2
                        : 0
                }
                class="fill-muted font-hand"
                font-size="17"
                font-weight="600"
              >
                {calendarDate(date, false)}
              </text>
            ) : null,
          )}
          {active !== undefined && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={TOP}
              y2={H - BOTTOM}
              class="stroke-muted"
              stroke-width="1.5"
              stroke-dasharray="4 4"
              stroke-linecap="round"
            />
          )}
          {series.map((points) => {
            const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.index)},${y(p.value)}`).join(" ");
            return (
              <g key={points[0].index} filter={`url(#${rough})`}>
                {/* A wide highlighter pass under a narrower marker line. */}
                <path
                  d={d}
                  fill="none"
                  class="stroke-hl-yellow"
                  stroke-width={highlighter}
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  opacity="0.7"
                />
                <path
                  d={d}
                  fill="none"
                  style={{ stroke: `var(--color-${marker})` }}
                  stroke-width={pen}
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </g>
            );
          })}
          {dates.map((date, i) => {
            const value = values.get(date);
            if (value === undefined || (band < 12 && i !== active)) return null;
            return (
              <circle
                key={date}
                cx={x(i)}
                cy={y(value)}
                r={i === active ? 6 : 3.5}
                class="fill-surface"
                style={{
                  stroke: `var(--color-${marker})`,
                  fill: i === active ? undefined : `var(--color-${marker})`,
                }}
                stroke-width="3"
              />
            );
          })}
          {dates.map((date, i) => (
            <rect
              key={date}
              x={x(i) - band / 2}
              width={band}
              y={TOP}
              height={H - TOP - BOTTOM}
              fill="transparent"
              onPointerEnter={() => setActive(i)}
            >
              <title>
                {date}:{" "}
                {values.has(date) ? `${number.format(values.get(date)!)} ${unit}` : "no record"}
              </title>
            </rect>
          ))}
        </svg>
        {activeDate !== undefined && (
          <div
            aria-hidden="true"
            class="pointer-events-none absolute top-0 rotate-[-1.5deg] border-2 border-ink bg-hl-yellow px-3 py-1.5 whitespace-nowrap shadow-[3px_4px_0_rgb(35_40_58/0.18)]"
            style={{
              left: `${(x(active!) / W) * 100}%`,
              transform: `translateX(${active! > dates.length / 2 ? "calc(-100% - 12px)" : "12px"})`,
            }}
          >
            <p class="font-hand text-lg leading-none font-semibold">{calendarDate(activeDate)}</p>
            <p class="mt-1 text-sm font-bold tabular-nums">
              {activeValue === undefined ? (
                <span class="font-normal">No record</span>
              ) : (
                <>
                  {number.format(activeValue)} <span class="font-normal">{unitLabel(unit)}</span>
                </>
              )}
            </p>
          </div>
        )}
      </div>
      {missing && (
        <p class="mt-2 flex items-center gap-2 text-sm text-muted">
          <span aria-hidden="true" class="hatch inline-block size-4" />
          Shaded days have no record. They are not counted as zero.
        </p>
      )}
    </>
  );
}

export function Sparkline({
  rows,
  dates,
  marker = "marker-blue",
}: {
  rows: DailyMetric[];
  dates: string[];
  marker?: Marker;
}) {
  const values = new Map(rows.map((row) => [row.date, row.value]));
  const min = Math.min(...rows.map((row) => row.value));
  const max = Math.max(...rows.map((row) => row.value));
  const span = max - min || 1;
  const x = (index: number) => ((index + 0.5) / dates.length) * 100;
  const y = (value: number) => 28 - ((value - min) / span) * 24;
  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      aria-hidden="true"
      class="h-9 w-full overflow-visible"
    >
      {runs(dates, values).map((points) => (
        <path
          key={points[0].index}
          d={points
            .map((p, i) => `${i ? "L" : "M"}${x(p.index)},${y(p.value)}`)
            .join(" ")
            .concat(points.length === 1 ? ` L${x(points[0].index)},${y(points[0].value)}` : "")}
          fill="none"
          style={{ stroke: `var(--color-${marker})` }}
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
