/** @jsxImportSource preact */

const paths = {
  overview: "M4 5h6v6H4zM14 5h6v4h-6zM14 13h6v6h-6zM4 15h6v4H4z",
  metrics: "M4 19h16M6 16l4-5 3 3 5-7",
  sleep: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  workouts: "M4 12h3l2-5 4 10 2-5h5",
  imports: "M12 4v11m0 0-4-4m4 4 4-4M5 19h14",
  refresh: "M20 11a8 8 0 0 0-14.5-4.5L4 8m0-4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16m0 4v-4h-4",
  logout: "M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10",
};

export function Icon({
  name,
  class: className = "size-4",
}: {
  name: keyof typeof paths;
  class?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`shrink-0 ${className}`}
    >
      <path d={paths[name]} />
    </svg>
  );
}
