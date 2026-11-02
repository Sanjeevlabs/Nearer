// The two attention experiments: "How to listen" (seen only by the people a note was sent
// to) and "Remind me to ask" (a private reminder to yourself, delivered in For you on its day).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as cardsGet, POST as cardsPost } from "@/app/api/cards/route";
import { GET as inboxGet } from "@/app/api/inbox/route";
import { GET as nudgesGet, POST as nudgesPost } from "@/app/api/nudges/route";
import { GET as waitingGet } from "@/app/api/waiting/route";
import { dbListMembers } from "@/lib/db";
import { listDocs } from "@/lib/family-docs";
import { listenFor } from "@/lib/listen";
import { deliverDueNudges } from "@/lib/nudge-run";
import { pushIdle } from "@/lib/push/background";
import { clearOutbox, outbox } from "@/lib/push/send";
import { resetPushStore, upsertSub } from "@/lib/push/store";
import { resetDemo } from "@/lib/store";
import { authedGet, authedJson } from "./auth-helper";

const FAM = "demo-family";
const NOW = new Date("2026-10-28T06:00:00.000Z");
const json = async <T = Record<string, unknown>>(r: Response | Promise<Response>) => (await (await r).json()) as T;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetDemo();
  resetPushStore();
  clearOutbox();
});
afterEach(() => vi.useRealTimers());

const voice = (as: string, addressedTo: string | null, listen?: string) =>
  json<{ card: { id: string } }>(cardsPost(authedJson("http://t/api/cards", { type: "audio", caption: "the interview", lang: "en", takenAt: NOW.toISOString(), addressedTo, ...(listen ? { listen } : {}) }, as)));

describe("How to listen", () => {
  it("is shown only to the addressees, in the cards and in For you", async () => {
    const { card } = await voice("arjun", "dadi", "just-listen");
    const seenBy = async (as: string) => (await json<{ cards: { id: string; listen?: string }[] }>(cardsGet(authedGet("http://t/api/cards", as)))).cards.find((c) => c.id === card.id);
    expect((await seenBy("dadi"))?.listen).toBe("just-listen");
    expect((await seenBy("dada"))?.listen).toBeUndefined();
    expect((await seenBy("leo"))?.listen).toBeUndefined();
    // The sender knows what they chose; the label is for the listener.
    expect((await seenBy("arjun"))?.listen).toBeUndefined();
    const inbox = await json<{ items: { cardId: string | null; listen: string | null }[] }>(inboxGet(authedGet("http://t/api/inbox", "dadi")));
    expect(inbox.items.find((i) => i.cardId === card.id)?.listen).toMatch(/: just listen$/);
  });

  it("is never kept without addressees and never sent as a nudge", async () => {
    await voice("arjun", null, "help-me-think");
    expect(await listDocs(FAM, "card_listen")).toEqual([]);
    await voice("arjun", "dadi", "keep-me-company");
    expect((await listDocs(FAM, "nudge")).some((n) => /listen|company|think/i.test(n.text))).toBe(false);
    expect(listenFor({ listen: "just-listen", to: ["dadi"], authorId: "arjun" }, "dadi")).toBe("just-listen");
    expect(listenFor({ listen: "just-listen", to: ["dadi"], authorId: "arjun" }, "priya")).toBeNull();
  });
});

describe("Remind me to ask", () => {
  const remind = (as: string, body: Record<string, unknown>) => nudgesPost(authedJson("http://t/api/nudges", { action: "remind", ...body }, as));
  const mine = async (as: string) => (await json<{ reminders: { id: string; text: string; at: string }[] }>(nudgesGet(authedGet("http://t/api/nudges?reminders=1", as)))).reminders;

  it("goes to yourself only, waits for its day, then shows in For you; nobody else ever sees it", async () => {
    const res = await remind("arjun", { aboutId: "dada", href: "/lane?card=x", what: "the check-up", days: 1, note: "How was the doctor?" });
    expect(res.status).toBe(201);
    const [r] = await mine("arjun");
    expect(r.text).toMatch(/^Ask .+: How was the doctor\?$/);
    // Tomorrow, 8 AM on Arjun's clock.
    expect(Date.parse(r.at)).toBeGreaterThan(NOW.getTime());
    expect(Date.parse(r.at) - NOW.getTime()).toBeLessThan(2 * 86_400_000);
    // Not before its day.
    const before = await json<{ items: { nudgeId: string | null }[] }>(inboxGet(authedGet("http://t/api/inbox", "arjun")));
    expect(before.items.some((i) => i.nudgeId === r.id)).toBe(false);
    expect((await json<{ nudges: { id: string }[] }>(nudgesGet(authedGet("http://t/api/nudges", "arjun")))).nudges.some((n) => n.id === r.id)).toBe(false);
    // On its day: in Arjun's For you and the dock's waiting list.
    vi.setSystemTime(new Date(Date.parse(r.at) + 60_000));
    const after = await json<{ items: { nudgeId: string | null; text: string }[] }>(inboxGet(authedGet("http://t/api/inbox", "arjun")));
    expect(after.items.some((i) => i.nudgeId === r.id)).toBe(true);
    const waiting = await json<{ items: { nudgeId?: string }[] }>(waitingGet(authedGet("http://t/api/waiting", "arjun")));
    expect(waiting.items.some((i) => i.nudgeId === r.id)).toBe(true);
    // Nobody else: not Papa (it is about him), not Maa.
    for (const as of ["dada", "dadi", "priya"]) {
      expect(await mine(as)).toEqual([]);
      const theirs = await json<{ items: { nudgeId: string | null }[] }>(inboxGet(authedGet("http://t/api/inbox", as)));
      expect(theirs.items.some((i) => i.nudgeId === r.id)).toBe(false);
    }
  });

  it("is never emailed or pushed, and has no weekly limit", async () => {
    await upsertSub({ familyId: FAM, memberId: "arjun", kind: "fcm", token: "fcm-token-arjun-aaaaaaaaaaaaaaa", platform: "android" });
    for (let i = 0; i < 6; i++) expect((await remind("arjun", { aboutId: "dadi", href: "/gather", what: `thing ${i}`, days: 1 })).status).toBe(201);
    expect(await mine("arjun")).toHaveLength(6);
    vi.setSystemTime(new Date(NOW.getTime() + 2 * 86_400_000));
    await deliverDueNudges(FAM, await dbListMembers(FAM), new Date());
    await pushIdle();
    // Whatever else the morning carries for Arjun, no reminder is in it.
    expect(outbox.filter((o) => o.memberId === "arjun").map((o) => o.msg.body)).not.toContainEqual(expect.stringMatching(/^Ask |thing \d/));
    expect((await listDocs(FAM, "nudge")).filter((n) => n.kind === "reminder").every((n) => n.deliveredAt === null)).toBe(true);
  });

  it("can be changed or deleted by its owner only; never about yourself", async () => {
    await remind("arjun", { aboutId: "dada", href: "/gather", what: "the wedding", days: 3 });
    const [r] = await mine("arjun");
    expect(r.text).toMatch(/about the wedding$/);
    expect((await nudgesPost(authedJson("http://t/api/nudges", { action: "delete", id: r.id }, "dadi"))).status).toBe(404);
    expect((await nudgesPost(authedJson("http://t/api/nudges", { action: "edit", id: r.id, days: 7, note: "Who danced?" }, "arjun"))).status).toBe(200);
    const [e] = await mine("arjun");
    expect(e.text).toMatch(/: Who danced\?$/);
    expect(Date.parse(e.at)).toBeGreaterThan(Date.parse(r.at));
    expect((await nudgesPost(authedJson("http://t/api/nudges", { action: "delete", id: r.id }, "arjun"))).status).toBe(200);
    expect(await mine("arjun")).toEqual([]);
    expect((await remind("arjun", { aboutId: "arjun", href: "/", days: 1 })).status).toBe(404);
    expect((await remind("arjun", { aboutId: "dada", href: "https://evil.example", days: 1 })).status).toBe(400);
  });
});
