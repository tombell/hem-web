/** @jsxImportSource preact */
import { label, quantity, type Workout } from "../data";
import { dateTime } from "../date-time";
import { DataTable } from "./data-table";
import { Empty } from "./empty";

export function WorkoutsView({ rows }: { rows: Workout[] }) {
  return rows.length ? (
    <section class="panel">
      <h2 class="font-hand text-3xl font-bold">
        <span class="underline-drawn [--ul:var(--color-marker-green)]">Recorded workouts</span>{" "}
        <span class="circled ml-2 inline-block px-1.5 text-2xl text-muted tabular-nums [--circle:var(--color-marker-green)]">
          {rows.length}
        </span>
      </h2>
      <DataTable headings={["Activity", "Started", "Duration", "Distance", "Energy"]}>
        {[...rows].toReversed().map((row) => (
          <tr key={row.id}>
            <td class="font-bold">{label(row.activityType)}</td>
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
  );
}
