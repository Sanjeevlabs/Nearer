// Two requests make the same person in the same family at once: the unique index (family_id, lower(email))
// lets one insert win; the other must use the winner, not fail and not make a second member.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const rows: Record<string, unknown>[] = [];
  const sessions: Record<string, unknown>[] = [];
  const log: string[] = [];
  const fake = {
    from: (t: string) => {
      const filters: [string, unknown][] = [];
      const b: Record<string, unknown> = {
        insert: (row: Record<string, unknown>) => {
          if (t === "members") {
            const dup = rows.find((r) => r.family_id === row.family_id && String(r.email).toLowerCase() === String(row.email).toLowerCase());
            if (dup) return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
            rows.push(row);
          }
          return Promise.resolve({ error: null });
        },
        select: () => b,
        eq: (k: string, v: unknown) => (filters.push([k, v]), b),
        limit: () => Promise.resolve({ data: rows.filter((r) => filters.every(([k, v]) => r[k] === v)), error: null }),
      };
      void sessions;
      void log;
      return b;
    },
  };
  return { rows, fake };
});

vi.mock("@/lib/supabase", () => ({ isDbLive: () => true, supabaseServer: () => h.fake }));

import { dbAddMember } from "@/lib/db";

const input = (first: string) => ({ familyId: "fam-race-1", firstName: first, displayName: first, role: "adult" as const, lang: "en" as const, displayLang: "en" as const, tz: "UTC", birthday: "", city: "", email: "Race@Example.com", access: "member" as const, status: "active" as const });

beforeEach(() => {
  vi.stubEnv("MOCK", "false");
  h.rows.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("member creation under a race", () => {
  it("the loser of a unique violation gets the winner's member and no second row is made", async () => {
    const first = await dbAddMember(input("Asha"));
    const second = await dbAddMember(input("Asha again"));
    expect(h.rows).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.email).toBe("race@example.com");
  });

  it("a different email in the same family is its own member", async () => {
    await dbAddMember(input("Asha"));
    await dbAddMember({ ...input("Ravi"), email: "ravi@example.com" });
    expect(h.rows).toHaveLength(2);
  });
});
