/** @jsxImportSource preact */
import { useEffect, useState } from "preact/hooks";

import { collection, type Source } from "../data";
import { Brand } from "./brand";

export function Connect({
  onConnect,
  notice,
}: {
  onConnect: (token: string, sources: Source[]) => void;
  notice: string;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);
  const [controller] = useState(() => new AbortController());
  useEffect(() => () => controller.abort(), [controller]);
  return (
    <main class="grid min-h-screen place-items-center p-6">
      <div class="w-full max-w-md">
        <Brand />
        <p class="mt-10 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          Your health, in view
        </p>
        <h1 class="mt-3 text-4xl font-semibold tracking-tight">
          A little perspective
          <br />
          on your everyday.
        </h1>
        <p class="mt-4 leading-relaxed text-muted">
          Explore the health data you’ve imported from Hem.
        </p>
        <form
          class="panel mt-8 space-y-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              const rows = await collection<Source>(
                "sources",
                "sources",
                value.trim(),
                {},
                controller.signal,
              );
              onConnect(value.trim(), rows);
            } catch (cause) {
              if (!controller.signal.aborted)
                setError(cause instanceof Error ? cause.message : "Connection failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label class="block text-sm font-medium">
            Dashboard token
            <input
              class="mt-2 w-full"
              type="password"
              autoComplete="off"
              required
              value={value}
              onInput={(e) => setValue(e.currentTarget.value)}
              placeholder="Enter your read-only token"
            />
          </label>
          <p class="subtle">
            Your token stays in this tab’s memory. Reloading or disconnecting clears it.
          </p>
          {error && (
            <p role="alert" class="text-sm text-red-700">
              {error}
            </p>
          )}
          <button class="primary w-full" disabled={busy || !value.trim()}>
            {busy ? "Connecting…" : "Connect to Hem"}
          </button>
        </form>
        <p class="mt-5 text-center text-xs text-muted">Personal health data. On your own server.</p>
      </div>
    </main>
  );
}
