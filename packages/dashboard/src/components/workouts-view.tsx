/** @jsxImportSource preact */
import { label, quantity, type Workout } from "../data";
import { dateTime } from "../date-time";
import { DataTable } from "./data-table";
import { Empty } from "./empty";

export function WorkoutsView({ rows }: { rows: Workout[] }) {
  return rows.length ? (
    <section class="panel">
      <h2 class="text-lg tracking-[0.12em] text-accent uppercase">
        Recorded workouts <span class="text-muted">· {rows.length}</span>
      </h2>
      <DataTable headings={["Activity", "Started", "Duration", "Distance", "Energy"]}>
        {[...rows].toReversed().map((row) => (
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
  );
}
