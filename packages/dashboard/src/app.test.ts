// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { App } from "./app";

let container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn<(url: string, options: RequestInit) => Promise<Response>>>;
beforeEach(() => {
  history.replaceState(null, "", "/dashboard/?start=2026-11-01&end=2026-11-03");
  container = document.createElement("div");
  document.body.append(container);
  fetcher = vi.fn(async (url: string) =>
    url.includes("/sources")
      ? Response.json({
          sources: [
            {
              sourceKey: "phone",
              source: { deviceName: "My phone" },
              lastImportedAt: "2026-11-03T12:00:00Z",
            },
          ],
          hasMore: false,
        })
      : Response.json({
          dailyMetrics: [
            { id: 1, metric: "steps", unit: "count", value: 1200, date: "2026-11-01" },
            { id: 2, metric: "steps", unit: "count", value: 0, date: "2026-11-03" },
          ],
          hasMore: false,
        }),
  );
  vi.stubGlobal("fetch", fetcher);
  act(() => render(h(App, {}), container));
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.unstubAllGlobals();
});
async function connect() {
  await act(async () => {
    const input = container.querySelector("input")!;
    input.value = "read-token";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

test.each(["/dashboard/", "/hem/dashboard/"])(
  "keeps API requests under the deployment path at %s",
  async (path) => {
    history.replaceState(null, "", path);
    await connect();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    const prefix = path.slice(0, -"dashboard/".length);
    for (const [url] of fetcher.mock.calls) {
      expect(new URL(url, window.location.href).pathname.startsWith(`${prefix}apple-health/`)).toBe(
        true,
      );
    }
  },
);

test("connects, displays gaps separately from zero, and clears data on disconnect", async () => {
  await connect();
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.querySelector("tbody")).not.toBeNull();
  });
  expect(container.textContent).toContain("Your days, at a glance");
  expect(container.textContent).toContain("My phone");
  const rows = [...container.querySelectorAll("tbody tr")].map((row) => row.textContent);
  expect(rows).toEqual(["2026-11-011,200", "2026-11-02No data", "2026-11-030"]);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  expect(location.href).not.toContain("read-token");
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Disconnect")!
      .click();
  });
  expect(container.querySelector('input[type="password"]')).not.toBeNull();
  expect(container.textContent).not.toContain("1,200");
});

test("rejects a bad token without showing dashboard data", async () => {
  fetcher.mockImplementation(async () => new Response(null, { status: 401 }));
  await connect();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "token was not accepted",
  );
  expect(container.querySelector("nav")).toBeNull();
});

test("changing filters aborts old requests and does not show old values", async () => {
  await connect();
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.querySelector("tbody")).not.toBeNull();
  });
  let pendingSignal: AbortSignal | undefined;
  fetcher.mockImplementation((_url, options) => {
    pendingSignal = options.signal ?? undefined;
    return new Promise(() => {});
  });
  await act(async () => {
    const input = container.querySelector('input[type="date"]') as HTMLInputElement;
    input.value = "2026-10-30";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain("Loading your health data");
  expect(container.textContent).not.toContain("1,200");
  const oldSignal = pendingSignal;
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "30 days")!
      .click();
  });
  expect(oldSignal?.aborted).toBe(true);
});

test("shows overlapping sleep records separately with exact intervals", async () => {
  await connect();
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.querySelector("tbody")).not.toBeNull();
  });
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, options) =>
    url.includes("/sleep")
      ? Promise.resolve(
          Response.json({
            sleep: [
              { id: 1, start: "2026-11-01T22:00:00Z", end: "2026-11-02T06:00:00Z", value: "inBed" },
              {
                id: 2,
                start: "2026-11-01T23:00:00Z",
                end: "2026-11-02T05:00:00Z",
                value: "asleepCore",
              },
            ],
            hasMore: false,
          }),
        )
      : original(url, options),
  );
  await act(async () => {
    [...container.querySelectorAll<HTMLButtonElement>("nav button")]
      .find((button) => button.textContent?.includes("Sleep"))!
      .click();
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });
  expect(container.textContent).toContain("Each interval is shown separately");
  expect(container.textContent).toContain("In Bed");
  expect(container.textContent).toContain("Asleep Core");
});

test("clears the dashboard when authorization expires during a query", async () => {
  await connect();
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.querySelector("tbody")).not.toBeNull();
  });
  fetcher.mockImplementation(async () => new Response(null, { status: 401 }));
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Refresh")!
      .click();
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "token was not accepted",
    );
  });
  expect(container.querySelector("nav")).toBeNull();
  expect(container.textContent).not.toContain("1,200");
});
