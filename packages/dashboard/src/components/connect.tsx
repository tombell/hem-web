/** @jsxImportSource preact */
import { useEffect, useState } from "preact/hooks";

import type { Source } from "../data";
import { createSession, type Session } from "../queries";
import { Brand } from "./brand";

export function Connect({
  onConnect,
  notice,
}: {
  onConnect: (session: Session, sources: Source[]) => void;
  notice: string;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);
  const [pending] = useState(() => ({ session: undefined as Session | undefined }));
  useEffect(
    () => () => {
      pending.session?.dispose();
      pending.session = undefined;
    },
    [pending],
  );
  return (
    <main class="grid min-h-screen place-items-center p-6">
      <div class="w-full max-w-md">
        <Brand />
        <p class="eyebrow mt-10">
          <span class="underline-drawn [--ul:var(--color-marker-blue)]">
            Secure, read-only link
          </span>
        </p>
        <h1 class="mt-3 font-hand text-5xl leading-[1.05] font-bold">
          A little <span class="hl hl-pink">perspective</span>
          <br />
          on your <span class="hl hl-green">everyday.</span>
        </h1>
        <p class="mt-4 leading-relaxed text-muted">
          Explore the health data you’ve imported from Hem.
        </p>
        <form
          class="panel tape mt-10 space-y-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            pending.session?.dispose();
            const session = createSession(value.trim());
            pending.session = session;
            try {
              const result = await session.$sources.fetch();
              if (pending.session !== session) return;
              if ("error" in result) throw result.error;
              pending.session = undefined;
              onConnect(session, result.data);
            } catch (cause) {
              if (pending.session === session) {
                setError(cause instanceof Error ? cause.message : "Connection failed.");
                session.dispose();
                pending.session = undefined;
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <label class="block font-hand text-xl font-semibold">
            Dashboard token
            <input
              class="mt-1 w-full font-sans"
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
            <p role="alert" class="text-sm text-danger">
              {error}
            </p>
          )}
          <button class="primary w-full" disabled={busy || !value.trim()}>
            {busy ? "Connecting…" : "Connect to Hem"}
          </button>
        </form>
        <p class="mt-6 text-center font-hand text-lg text-muted">
          Personal health data. On your own server.
        </p>
      </div>
    </main>
  );
}
