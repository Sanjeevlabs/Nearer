// A partner order preview places one order, even when the second tap reaches a
// different Worker: the spent marker is a database row claimed by an insert
// that fails on a repeat, not a map in this process.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const rows = new Map<string, unknown>();
  const fake = {
    from: () => ({
      insert: async (row: { id: string }) => {
        if (rows.has(row.id)) return { error: { code: "23505", message: "duplicate key" } };
        rows.set(row.id, row);
        return { error: null };
      },
    }),
  };
  return { rows, fake, live: { on: false } };
});

vi.mock("@/lib/supabase", () => ({ isDbLive: () => h.live.on, supabaseServer: () => (h.live.on ? h.fake : null) }));

import { claimDoc, listDocs, putDoc } from "@/lib/family-docs";
import { purgeExpired } from "@/lib/purge";
import { resetDemo } from "@/lib/store";

const spent = (n: string, at = new Date().toISOString()) => ({ id: `preview-${n}`, memberId: "arjun", at });

beforeEach(() => {
  h.rows.clear();
  h.live.on = false;
  resetDemo();
});
afterEach(() => vi.unstubAllEnvs());

describe("claimDoc", () => {
  it("mock mode: the first claim wins, a repeat does not, another family is separate", async () => {
    expect(await claimDoc("demo-family", "preview_used", spent("a"))).toBe(true);
    expect(await claimDoc("demo-family", "preview_used", spent("a"))).toBe(false);
    expect(await claimDoc("other-family", "preview_used", spent("a"))).toBe(true);
  });

  it("live: a second claim for the same id loses, whichever Worker makes it", async () => {
    vi.stubEnv("MOCK", "false");
    vi.stubEnv("META_API_KEY", "test-not-a-key");
    h.live.on = true;
    const fam = "fam-real0000001";
    expect(await claimDoc(fam, "preview_used", spent("x"))).toBe(true);
    expect(await claimDoc(fam, "preview_used", spent("x"))).toBe(false);
    expect(h.rows.size).toBe(1);
  });
});

describe("spent preview ids do not pile up", () => {
  it("the daily purge drops them a day after, keeps today's", async () => {
    const D = 86_400_000;
    await putDoc("demo-family", "preview_used", spent("old", new Date(Date.now() - 2 * D).toISOString()));
    await putDoc("demo-family", "preview_used", spent("new"));
    expect((await purgeExpired("demo-family")).previews).toBe(1);
    expect((await listDocs("demo-family", "preview_used")).map((u) => u.id)).toEqual(["preview-new"]);
  });
});
