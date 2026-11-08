import { nanoquery, type NanoqueryArgs } from "@nanostores/query";
import { atom } from "nanostores";

import { collection, type Source } from "./data";

/** Credentials and cached health records belong to one connection only. */
export function createSession(token: string) {
  const cache: NonNullable<NanoqueryArgs["cache"]> = new Map();
  const [createFetcherStore] = nanoquery({ cache, onErrorRetry: null });
  const cancellations = new Set<() => void>();

  function query<T>(endpoint: string, key: string, filters: Record<string, string> = {}) {
    const $active = atom(true);
    const controllers = new Set<AbortController>();
    const $store = createFetcherStore<T[], Error>(
      [JSON.stringify([endpoint, Object.entries(filters).toSorted()]), $active],
      {
        fetcher: async () => {
          const controller = new AbortController();
          controllers.add(controller);
          try {
            const rows = await collection<T>(endpoint, key, token, filters, controller.signal);
            controller.signal.throwIfAborted();
            return rows;
          } finally {
            controllers.delete(controller);
          }
        },
      },
    );
    function cancel() {
      $active.set(false);
      for (const controller of controllers) controller.abort();
      const cacheKey = $store.key;
      // Nanoquery settles its cache after the fetcher. Remove cancelled results afterwards.
      void $store.value?.promise
        ?.finally(() => {
          if (cacheKey) cache.delete(cacheKey);
        })
        .catch(() => {});
      $store.set({ loading: false });
      cancellations.delete(cancel);
    }
    cancellations.add(cancel);
    return { $store, cancel };
  }

  const sources = query<Source>("sources", "sources");
  return {
    $sources: sources.$store,
    query,
    dispose() {
      for (const cancel of cancellations) cancel();
      cache.clear();
      token = "";
    },
  };
}

export type Session = ReturnType<typeof createSession>;
