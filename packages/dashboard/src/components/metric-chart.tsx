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

const H = 220;
const LEFT = 44;
const RIGHT = 12;
const TOP = 16;
const BOTTOM = 26;

export function MetricChart({
  rows,
  dates,
  unit,
}: {
  rows: DailyMetric[];
  dates: string[];
  unit: string;
}) {
  const [active, setActive] = useState<number>();
  const hatch = `hatch-${useId()}`;
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
            <pattern
              id={hatch}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="6" class="stroke-line" stroke-width="2" />
            </pattern>
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
                shape-rendering="crispEdges"
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
                class={tick === 0 ? "stroke-muted" : "stroke-line"}
                stroke-dasharray={tick === 0 ? undefined : "1 3"}
                stroke-width="1"
                shape-rendering="crispEdges"
              />
              <text
                x={LEFT - 8}
                y={y(tick) + 3.5}
                text-anchor="end"
                class="fill-muted tabular-nums"
                font-size="10"
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
                y={H - 8}
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
                class="fill-muted tabular-nums"
                font-size="10"
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
              stroke-dasharray="2 2"
              shape-rendering="crispEdges"
            />
          )}
          {series.map((points) => (
            <g key={points[0].index}>
              <path
                d={points.map((p, i) => `${i ? "L" : "M"}${x(p.index)},${y(p.value)}`).join(" ")}
                fill="none"
                class="glow-line stroke-accent"
                stroke-width="1.5"
                stroke-linejoin="miter"
              />
            </g>
          ))}
          {dates.map((date, i) => {
            const value = values.get(date);
            if (value === undefined || (band < 12 && i !== active)) return null;
            const size = i === active ? 7 : 4;
            return (
              <rect
                key={date}
                x={x(i) - size / 2}
                y={y(value) - size / 2}
                width={size}
                height={size}
                class={i === active ? "fill-surface stroke-accent" : "fill-accent"}
                stroke-width="1.5"
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
            class="pointer-events-none absolute top-0 border border-accent bg-paper/95 px-2 py-1.5 text-xs whitespace-nowrap shadow-[0_0_12px_color-mix(in_oklab,var(--color-accent)_30%,transparent)]"
            style={{
              left: `${(x(active!) / W) * 100}%`,
              transform: `translateX(${active! > dates.length / 2 ? "calc(-100% - 12px)" : "12px"})`,
            }}
          >
            <p class="text-muted">{calendarDate(activeDate)}</p>
            <p class="mt-0.5 font-semibold tabular-nums">
              {activeValue === undefined ? (
                <span class="font-normal text-muted">No record</span>
              ) : (
                <>
                  {number.format(activeValue)}{" "}
                  <span class="font-normal text-muted">{unitLabel(unit)}</span>
                </>
              )}
            </p>
          </div>
        )}
      </div>
      {missing && (
        <p class="mt-2 flex items-center gap-2 text-xs text-muted">
          <span aria-hidden="true" class="hatch inline-block size-2.5 border border-line" />
          Shaded days have no record. They are not counted as zero.
        </p>
      )}
    </>
  );
}

export function Sparkline({ rows, dates }: { rows: DailyMetric[]; dates: string[] }) {
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
      class="glow-line h-8 w-full overflow-visible"
    >
      {runs(dates, values).map((points) => (
        <path
          key={points[0].index}
          d={points
            .map((p, i) => `${i ? "L" : "M"}${x(p.index)},${y(p.value)}`)
            .join(" ")
            .concat(points.length === 1 ? ` L${x(points[0].index)},${y(points[0].value)}` : "")}
          fill="none"
          class="stroke-accent"
          stroke-width="1.25"
          stroke-linecap="square"
          stroke-linejoin="miter"
          vector-effect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
