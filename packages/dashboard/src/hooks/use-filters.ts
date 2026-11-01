import { useEffect, useState } from "preact/hooks";

export function useFilters() {
  const [params, setParams] = useState(() => new URLSearchParams(location.search));
  useEffect(() => {
    const onPopState = () => setParams(new URLSearchParams(location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  function update(values: Record<string, string>) {
    const next = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(values)) next.set(key, value);
    history.pushState(null, "", `${location.pathname}?${next}`);
    setParams(next);
  }
  return [params, update] as const;
}
