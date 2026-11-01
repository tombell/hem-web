/** @jsxImportSource preact */
import { number, type DailyMetric } from "../data";

export function MetricChart({
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
