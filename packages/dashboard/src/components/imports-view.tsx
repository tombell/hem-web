/** @jsxImportSource preact */
import { type Import } from "../data";
import { dateTime } from "../date-time";
import { DataTable } from "./data-table";
import { Empty } from "./empty";

export function ImportsView({ rows }: { rows: Import[] }) {
  return rows.length ? (
    <section class="panel">
      <h2 class="text-lg font-semibold">Imports overlapping this range</h2>
      <DataTable headings={["Imported", "Coverage", "Export timezone", "Generated"]}>
        {rows.map((row) => (
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
  );
}
