/** @jsxImportSource preact */

export function Brand() {
  return (
    <div class="flex items-center gap-2.5">
      <span aria-hidden="true" class="relative grid size-9 place-items-center">
        <svg viewBox="0 0 40 40" class="absolute inset-0 text-marker-pink">
          <path
            d="M22 4C32 5 37 13 36 22s-8 15-17 14S4 29 4 20 11 4 24 6"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
          />
        </svg>
        <span class="font-hand text-2xl leading-none font-bold">h</span>
      </span>
      <span class="font-hand text-3xl leading-none font-bold">
        <span class="hl hl-yellow">hem</span>
        <span class="ml-1.5 text-xl font-medium text-muted">health notes</span>
      </span>
    </div>
  );
}
