/** @jsxImportSource preact */

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <section class="panel py-12 text-center">
      <h2 class="text-lg tracking-[0.12em] text-accent uppercase">{title}</h2>
      <p class="mx-auto mt-2 max-w-md subtle">{text}</p>
    </section>
  );
}
