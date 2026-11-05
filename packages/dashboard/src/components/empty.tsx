/** @jsxImportSource preact */

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <section class="panel py-12 text-center">
      <svg aria-hidden="true" viewBox="0 0 64 40" class="mx-auto h-10 text-muted">
        <path
          d="M6 30c8-14 16-20 24-8s16 6 26-12M48 8l8 2-2 8"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <h2 class="mt-3 font-hand text-3xl font-bold">
        <span class="underline-drawn">{title}</span>
      </h2>
      <p class="mx-auto mt-3 max-w-md subtle">{text}</p>
    </section>
  );
}
