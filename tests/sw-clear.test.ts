import { describe, expect, it } from "vitest";
import { clearSwCaches } from "@/lib/sw-clear";
import { CLIENT_RETRIES_HEADER, RETRY_DELAYS_MS, attemptInit } from "@/lib/retry";

describe("clearing the service worker's family caches from the page", () => {
  it("deletes every kept page and API copy, of any version, and leaves static files", async () => {
    const names = new Set(["aangan-data-v4", "aangan-pages-v4", "aangan-data-v3", "aangan-static-v4", "other"]);
    const store = {
      keys: async () => [...names],
      delete: async (k: string) => names.delete(k),
    } as unknown as CacheStorage;
    await clearSwCaches(store);
    expect([...names].sort()).toEqual(["aangan-static-v4", "other"]);
  });

  it("does nothing without CacheStorage", async () => {
    await expect(clearSwCaches(undefined)).resolves.toBeUndefined();
  });
});

describe("marking retried reads for the service worker", () => {
  it("marks every attempt that will be retried, not the last", () => {
    for (let n = 0; n < RETRY_DELAYS_MS.length; n++) {
      expect(new Headers(attemptInit(n, { cache: "no-store" }).headers).get(CLIENT_RETRIES_HEADER)).toBe("1");
    }
    const last = attemptInit(RETRY_DELAYS_MS.length, { cache: "no-store" });
    expect(new Headers(last.headers).has(CLIENT_RETRIES_HEADER)).toBe(false);
    expect(last.cache).toBe("no-store");
  });
});
