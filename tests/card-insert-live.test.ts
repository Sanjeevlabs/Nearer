import { afterEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const insert = vi.fn(async (row: Record<string, unknown>) => {
    if (rows.has(String(row.id))) return { error: { code: "23505", message: "duplicate key" } };
    rows.set(String(row.id), row);
    return { error: null };
  });
  return { rows, insert, fake: { from: () => ({ insert }) } };
});
vi.mock("@/lib/supabase", () => ({ isDbLive: () => true, supabaseServer: () => h.fake }));
import { CardIdConflict, dbAddCard } from "@/lib/db";
afterEach(() => vi.unstubAllEnvs());

it("live database inserts cannot overwrite another author's card, even across families", async () => {
  vi.stubEnv("MOCK", "false");
  const id = crypto.randomUUID();
  const original = { id, familyId: "real-family-a", authorId: "a", type: "audio" as const, caption: "Private", addressedTo: "b", lang: "en", takenAt: new Date().toISOString() };
  await dbAddCard(original);
  const saved = h.rows.get(id);
  await expect(dbAddCard({ ...original, familyId: "real-family-b", authorId: "b", caption: "Overwrite" })).rejects.toBeInstanceOf(CardIdConflict);
  expect(h.rows.get(id)).toEqual(saved);
  expect(h.insert).toHaveBeenCalledTimes(2);
});
