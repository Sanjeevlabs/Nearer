// The dock dot and the window's "Waiting for you" tile read one list
// (GET /api/waiting == the window glance). Acting on a thing removes it from
// both: play, answer, reply, open the nudge. An unopened nudge goes stale.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as waitingGET } from "@/app/api/waiting/route";
import { POST as seenPOST } from "@/app/api/nudges/seen/route";
import { POST as playsPOST } from "@/app/api/plays/route";
import { dbAddCard } from "@/lib/db";
import { deleteDoc, listDocs, putDoc } from "@/lib/family-docs";
import { WAIT_MS } from "@/lib/nudges";
import { resetDemo } from "@/lib/store";
import { windowState } from "@/lib/window-server";
import { authedGet, authedJson } from "./auth-helper";

const FAM = "demo-family";
const NOW = new Date("2026-10-28T09:00:00.000Z");
const H = 3_600_000;
const D = 24 * H;
type Item = { kind: string; text: string; href: string; fromId?: string; nudgeId?: string };

const waiting = async (as = "arjun") => ((await (await waitingGET(authedGet("http://t/api/waiting", as))).json()) as { items: Item[]; top: Item | null });
const glance = async (as = "arjun") => (await windowState(FAM, as, new Date())).glance.waiting;
const nudge = (id: string, kind: string, at: string, deliverAfter = at) => ({ id, toMemberId: "arjun", kind, text: `{m:dadi} ${id}`, href: `/home?card=${id}`, at, deliverAfter, deliveredAt: null, channel: null, seenAt: null });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetDemo();
  for (const id of ["nudge-demo-heard", "nudge-demo-occasion"]) await deleteDoc(FAM, "nudge", id);
  // Only the nudge under test: drop anything else the demo has waiting for Arjun.
  for (const q of await listDocs(FAM, "question")) await deleteDoc(FAM, "question", q.id);
  for (const t of await listDocs(FAM, "today_task")) await deleteDoc(FAM, "today_task", t.id);
  for (const n of await listDocs(FAM, "need")) await deleteDoc(FAM, "need", n.id);
});
afterEach(() => vi.useRealTimers());

describe("one source for the dock dot and the glance tile", () => {
  it("a nudge shows in both, with the same words, and is the same top item", async () => {
    await putDoc(FAM, "nudge", nudge("n1", "occasion", new Date(NOW.getTime() - H).toISOString()));
    const w = await waiting();
    const g = await glance();
    const top = w.items.find((i) => i.kind === "nudge");
    expect(top).toMatchObject({ nudgeId: "n1", text: "Maa n1" });
    expect(g).toEqual(w.top);
  });

  it("opening the nudge (POST /api/nudges/seen) removes it from both", async () => {
    await putDoc(FAM, "nudge", nudge("n1", "occasion", new Date(NOW.getTime() - H).toISOString()));
    expect((await waiting()).items.some((i) => i.nudgeId === "n1")).toBe(true);
    await seenPOST(authedJson("http://t/api/nudges/seen", { ids: ["n1"] }, "arjun"));
    expect((await waiting()).items.some((i) => i.nudgeId === "n1")).toBe(false);
    expect((await glance())?.nudgeId).not.toBe("n1");
  });

  it("a nudge not yet due (before their 8 AM) is not waiting; one past its wait is gone", async () => {
    await putDoc(FAM, "nudge", nudge("later", "heard", NOW.toISOString(), new Date(NOW.getTime() + 2 * H).toISOString()));
    expect((await waiting()).items.some((i) => i.nudgeId === "later")).toBe(false);
    vi.setSystemTime(new Date(NOW.getTime() + 3 * H));
    expect((await waiting()).items.some((i) => i.nudgeId === "later")).toBe(true);
    // Staleness: "the call is tomorrow" stops waiting after two days, a heard-your-note after a week.
    await putDoc(FAM, "nudge", nudge("call", "call", NOW.toISOString()));
    vi.setSystemTime(new Date(NOW.getTime() + WAIT_MS.call + H));
    const after = (await waiting()).items.map((i) => i.nudgeId);
    expect(after).not.toContain("call");
    expect(after).toContain("later");
    vi.setSystemTime(new Date(NOW.getTime() + WAIT_MS.heard + 4 * H));
    expect((await waiting()).items.map((i) => i.nudgeId)).not.toContain("later");
  });

  it("playing a voice note clears it from both, and the nudge that points at that card", async () => {
    const sent = await dbAddCard({ id: "v1", familyId: FAM, type: "audio", caption: "Hello", takenAt: new Date(NOW.getTime() - H).toISOString(), authorId: "dadi", addressedTo: "arjun", lang: "en" });
    await putDoc(FAM, "nudge", { ...nudge("n-card", "heard", new Date(NOW.getTime() - H).toISOString()), href: `/home?card=${sent.id}` });
    let w = await waiting();
    expect(w.items.some((i) => i.kind === "voice" && i.href.includes("v1"))).toBe(true);
    expect((await glance())?.kind).toBeDefined();
    const res = await playsPOST(authedJson("http://t/api/plays", { cardId: sent.id, memberId: "arjun" }, "arjun"));
    expect(res.status).toBe(201);
    w = await waiting();
    expect(w.items.some((i) => i.kind === "voice" && i.href.includes("v1"))).toBe(false);
    expect(w.items.some((i) => i.nudgeId === "n-card")).toBe(false);
    expect(await glance()).toEqual(w.top);
  });

  it("answering the sender clears the voice note", async () => {
    await dbAddCard({ id: "v2", familyId: FAM, type: "audio", caption: "Hi", takenAt: new Date(NOW.getTime() - 2 * H).toISOString(), authorId: "dadi", addressedTo: "arjun", lang: "en" });
    expect((await waiting()).items.some((i) => i.kind === "voice")).toBe(true);
    await dbAddCard({ id: "v3", familyId: FAM, type: "audio", caption: "Reply", takenAt: new Date(NOW.getTime() - H).toISOString(), authorId: "arjun", addressedTo: "dadi", lang: "en" });
    expect((await waiting()).items.some((i) => i.kind === "voice")).toBe(false);
  });
});
