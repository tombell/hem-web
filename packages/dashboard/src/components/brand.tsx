/** @jsxImportSource preact */

export function Brand() {
  return (
    <div class="flex items-center gap-2.5 text-lg tracking-wider">
      <span
        aria-hidden="true"
        class="glow grid size-6 place-items-center border border-accent text-sm font-bold text-accent"
      >
        h
      </span>
      <span>
        <span class="glow font-semibold text-accent">hem</span>
        <span class="text-muted">://health</span>
      </span>
    </div>
  );
}
