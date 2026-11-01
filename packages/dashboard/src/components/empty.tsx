/** @jsxImportSource preact */

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <section class="panel py-16 text-center">
      <h2 class="text-xl font-medium">{title}</h2>
      <p class="mx-auto mt-3 max-w-md subtle">{text}</p>
    </section>
  );
}
