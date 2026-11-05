/** @jsxImportSource preact */
import type { ComponentChildren } from "preact";

export function DataTable({
  headings,
  children,
}: {
  headings: string[];
  children: ComponentChildren;
}) {
  return (
    <div class="mt-3 overflow-x-auto">
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
