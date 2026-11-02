// A fake clock is moved past each TTL in docs/STATE.md; the API (or pure
// function) that serves the thing must have stopped serving it. The kinds
// covered in tests/purge.test.ts (knock, sitting, day line, open check-in) and
// tests/waiting-source.test.ts (nudges) are not repeated here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as lampGET, POST as lampPOST } from "@/app/api/lamp/route";
import { GET as presenceGET } from "@/app/api/presence/route";
import { GET as suggestionsGET } from "@/app/api/suggestions/route";
import { dbAddSuggestion } from "@/lib/db";
import { listDocs, putDoc } from "@/lib/family-docs";
import { dismiss, listDismissed } from "@/lib/gather-store";
import { BEAT_TTL_MS, LAMP_GLOW_HOURS, glowFrom } from "@/lib/lamp";
import { purgeExpired, TTL } from "@/lib/purge";
import { resetDemo } from "@/lib/store";
import { authedGet, authedJson } from "./auth-helper";

const FAM = "demo-family";
const T0 = new Date("2026-10-28T09:00:00.000Z");
const H = 3_600_000;
const D = 24 * H;
const at = (ms: number) => new Date(T0.getTime() + ms).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  resetDemo();
});
afterEach(() => vi.useRealTimers());

describe("staleness", () => {
  it("lamp glow is full when lit and gone at 2 h", () => {
    const lit = T0.toISOString();
    expect(glowFrom(lit, T0.getTime())).toBe(1);
    expect(glowFrom(lit, T0.getTime() + H)).toBe(0.5);
    expect(glowFrom(lit, T0.getTime() + LAMP_GLOW_HOURS * H)).toBe(0);
    expect(glowFrom(lit, T0.getTime() + (LAMP_GLOW_HOURS + 1) * H)).toBe(0);
  });

  it("a heartbeat between homes is felt for 2 days, then /api/lamp no longer returns it", async () => {
    // kavya (other home) holds the lamp for arjun's home
    const sent = await lampPOST(authedJson("http://t/api/lamp", { action: "beat", toMemberId: "arjun" }, "kavya"));
    expect(sent.status).toBe(200);
    const read = async () => ((await (await lampGET(authedGet("http://t/api/lamp", "arjun"))).json()) as { beats: { from: string }[] }).beats.filter((b) => b.from === "kavya").length;
    expect(await read()).toBe(1);
    vi.setSystemTime(new Date(T0.getTime() + BEAT_TTL_MS + 60_000));
    expect(await read()).toBe(0);
  });

  it("a heartbeat older than 8 days is not served by /api/presence, and is deleted after 15", async () => {
    await putDoc(FAM, "presence", { id: "p-8", memberId: "dadi", moment: "chai", at: at(-9 * D) });
    await putDoc(FAM, "presence", { id: "p-1", memberId: "dadi", moment: "chai", at: at(-D) });
    const read = async () => ((await (await presenceGET(authedGet("http://t/api/presence", "arjun"))).json()) as { presence: { id: string }[] }).presence.map((p) => p.id);
    expect(await read()).toContain("p-1");
    expect(await read()).not.toContain("p-8");
    vi.setSystemTime(new Date(T0.getTime() + 15 * D + H));
    expect(await read()).not.toContain("p-1");
    await purgeExpired(FAM, new Date());
    expect((await listDocs(FAM, "presence")).map((p) => p.id)).not.toContain("p-1");
  });

  it("a suggestion nobody answered is withdrawn after 21 days: gone from the pending list", async () => {
    const s = await dbAddSuggestion({ goal: "Plan Diwali", payload: {}, familyId: FAM });
    const pending = async () => ((await (await suggestionsGET(authedGet("http://t/api/suggestions?status=pending", "arjun"))).json()) as { suggestions: { id: string }[] }).suggestions.map((x) => x.id);
    expect(await pending()).toContain(s.id);
    vi.setSystemTime(new Date(T0.getTime() + TTL.suggestionMs - H));
    await purgeExpired(FAM, new Date());
    expect(await pending()).toContain(s.id);
    vi.setSystemTime(new Date(T0.getTime() + TTL.suggestionMs + H));
    await purgeExpired(FAM, new Date());
    expect(await pending()).not.toContain(s.id);
  });

  it("an event prompt dismissal is deleted once its event date has passed", async () => {
    await dismiss(FAM, "arjun", "suggest:diwali:all:2026-11-08");
    expect(await listDismissed(FAM, "arjun")).toHaveLength(1);
    vi.setSystemTime(new Date("2026-11-08T12:00:00Z"));
    await purgeExpired(FAM, new Date());
    expect(await listDismissed(FAM, "arjun")).toHaveLength(1); // the day itself
    vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
    await purgeExpired(FAM, new Date());
    expect(await listDismissed(FAM, "arjun")).toEqual([]);
  });

  it("a Muse call log row is gone after 90 days", async () => {
    await putDoc(FAM, "muse_call", { id: "mc1", purpose: "p", model: "m", at: T0.toISOString() });
    vi.setSystemTime(new Date(T0.getTime() + TTL.museCallMs + D));
    await purgeExpired(FAM, new Date());
    expect((await listDocs(FAM, "muse_call")).map((m) => m.id)).not.toContain("mc1");
  });
});
