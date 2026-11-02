import { beforeEach, describe, expect, it } from "vitest";
import { dbAddCard, dbListRelationships, dbUpdateMemberProfile } from "@/lib/db";
import { deleteDoc, listDocs, putDoc } from "@/lib/family-docs";
import { deliverDueNudges, queueScanNudges } from "@/lib/nudge-run";
import { nudgeHeard, nudgeReacted, nudgeShared } from "@/lib/nudge-producers";
import { drain, enqueueNudge, listFor, markDelivered, next8amLocal, pendingFor, renderNudgeText } from "@/lib/nudges";
import { renderDigestEmail } from "@/lib/nudge-mail";
import { mailConfigured, sendMail } from "@/lib/mail";
import { dbListMembers } from "@/lib/db";
import { resetDemo } from "@/lib/store";
import { GET as nudgesGET } from "@/app/api/nudges/route";
import { POST as seenPOST } from "@/app/api/nudges/seen/route";
import { GET as settingsGET, PUT as settingsPUT } from "@/app/api/nudges/settings/route";
import { POST as playsPOST } from "@/app/api/plays/route";
import { authedGet, authedJson } from "./auth-helper";

const FAM = "demo-family";
// Wed 28 Oct 2026, 09:00 UTC (the cron's hour).
const NOW = new Date("2026-10-28T09:00:00.000Z");
const mine = (to: string) => listDocs(FAM, "nudge").then((l) => l.filter((n) => n.toMemberId === to));
const base = { kind: "heard" as const, text: "{m:dadi} heard your voice memory" };

beforeEach(async () => {
  resetDemo();
  // The demo seeds two for Arjun; these tests start from an empty queue.
  for (const id of ["nudge-demo-heard", "nudge-demo-occasion"]) await deleteDoc(FAM, "nudge", id);
});

describe("deliverAfter is the recipient's next 8 AM", () => {
  it("India: 09:00 UTC is 14:30 IST, so the next 8 AM is tomorrow 02:30 UTC", () => {
    expect(next8amLocal("Asia/Kolkata", NOW)).toBe("2026-10-29T02:30:00.000Z");
    // 01:00 UTC is 06:30 IST: 8 AM is the same morning.
    expect(next8amLocal("Asia/Kolkata", new Date("2026-10-28T01:00:00.000Z"))).toBe("2026-10-28T02:30:00.000Z");
  });
  it("UTC-5 (New York in winter) and the DST edge", () => {
    expect(next8amLocal("America/New_York", NOW)).toBe("2026-10-28T12:00:00.000Z"); // 05:00 EDT now, so 8 AM EDT is the same morning
    expect(next8amLocal("America/New_York", new Date("2026-11-10T09:00:00.000Z"))).toBe("2026-11-10T13:00:00.000Z"); // EST, UTC-5, 08:00 local
    expect(next8amLocal("America/New_York", new Date("2026-11-10T14:00:00.000Z"))).toBe("2026-11-11T13:00:00.000Z");
    expect(next8amLocal("UTC", NOW)).toBe("2026-10-29T08:00:00.000Z");
    expect(next8amLocal("Not/AZone", NOW)).toBe("2026-10-29T08:00:00.000Z");
  });
  it("a queued nudge carries it", async () => {
    await dbUpdateMemberProfile("arjun", { tz: "America/New_York" });
    const n = await enqueueNudge(FAM, { ...base, toMemberId: "arjun", href: "/home?card=a" }, NOW);
    expect(n?.deliverAfter).toBe("2026-10-28T12:00:00.000Z");
    expect(n?.deliveredAt).toBeNull();
  });
});

describe("enqueue: dedupe, cap, actor", () => {
  it("dedupes the same kind, link and person within a week, but not across weeks", async () => {
    const a = await enqueueNudge(FAM, { ...base, toMemberId: "arjun", href: "/home?card=a" }, NOW);
    const b = await enqueueNudge(FAM, { ...base, toMemberId: "arjun", href: "/home?card=a" }, new Date(NOW.getTime() + 3600_000));
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    expect(await enqueueNudge(FAM, { ...base, toMemberId: "arjun", href: "/home?card=a" }, new Date("2026-11-04T09:00:00Z"))).not.toBeNull();
    expect(await mine("arjun")).toHaveLength(2);
  });

  it("caps event nudges at 3 a week; the letter is outside the cap", async () => {
    for (const c of ["a", "b", "c", "d"]) await enqueueNudge(FAM, { ...base, toMemberId: "arjun", href: `/home?card=${c}` }, NOW);
    expect((await mine("arjun")).filter((n) => n.kind !== "letter")).toHaveLength(3);
    const letter = await enqueueNudge(FAM, { kind: "letter", text: "This week's letter: x", href: "/home?letter=l1", toMemberId: "arjun" }, NOW);
    expect(letter?.kind).toBe("letter");
    expect(await mine("arjun")).toHaveLength(4);
  });

  it("never tells the person who caused it", async () => {
    expect(await enqueueNudge(FAM, { ...base, toMemberId: "arjun", actorId: "arjun", href: "/x" }, NOW)).toBeNull();
    expect(await mine("arjun")).toHaveLength(0);
  });

  it("skips someone who is not in this family", async () => {
    expect(await enqueueNudge(FAM, { ...base, toMemberId: "nobody", href: "/x" }, NOW)).toBeNull();
    expect(await enqueueNudge("demo-iyer", { ...base, toMemberId: "arjun", href: "/x" }, NOW)).toBeNull();
  });
});

describe("settings are respected", () => {
  it("maxPerWeek 0 means no event nudges but the letter still comes; 2 caps at two", async () => {
    await putDoc(FAM, "nudge_settings", { id: "arjun", email: true, maxPerWeek: 0 });
    expect(await enqueueNudge(FAM, { ...base, toMemberId: "arjun", href: "/a" }, NOW)).toBeNull();
    expect(await enqueueNudge(FAM, { kind: "letter", text: "letter", href: "/home?letter=l", toMemberId: "arjun" }, NOW)).not.toBeNull();
    await putDoc(FAM, "nudge_settings", { id: "kavya", email: true, maxPerWeek: 2 });
    for (const c of ["a", "b", "c"]) await enqueueNudge(FAM, { ...base, toMemberId: "kavya", href: `/${c}` }, NOW);
    expect(await mine("kavya")).toHaveLength(2);
  });

  it("email off keeps it in the app even when mail is configured", async () => {
    const prev = { MOCK: process.env.MOCK, KEY: process.env.RESEND_API_KEY };
    process.env.MOCK = "false";
    process.env.RESEND_API_KEY = "re_test";
    const sent: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
      sent.push(String(init?.body));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      expect(mailConfigured()).toBe(true);
      await putDoc(FAM, "nudge_settings", { id: "arjun", email: false, maxPerWeek: 3 });
      await enqueueNudge(FAM, { ...base, toMemberId: "arjun", href: "/a" }, NOW);
      const members = await dbListMembers(FAM);
      // Demo families never send real mail either way.
      const out = await deliverDueNudges(FAM, members, new Date("2026-10-30T00:00:00Z"));
      expect(out).toEqual({ emails: 0, inapp: 1 });
      expect(sent).toHaveLength(0);
      expect((await sendMail({ to: "a@b.c", subject: "s", html: "h", text: "t" })).channel).toBe("email");
      expect(sent).toHaveLength(1);
    } finally {
      globalThis.fetch = realFetch;
      process.env.MOCK = prev.MOCK;
      if (prev.KEY === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prev.KEY;
    }
  });
});

describe("drain and delivery", () => {
  it("groups what is due per recipient and leaves the not-yet-8-AM ones", async () => {
    await enqueueNudge(FAM, { ...base, toMemberId: "arjun", href: "/a" }, NOW);
    await enqueueNudge(FAM, { ...base, toMemberId: "arjun", href: "/b" }, NOW);
    await enqueueNudge(FAM, { ...base, toMemberId: "kavya", href: "/a" }, NOW);
    expect(await drain(FAM, NOW)).toEqual([]); // 8 AM tomorrow has not come
    const due = await drain(FAM, new Date("2026-10-29T03:00:00Z"));
    expect(due.map((b) => [b.memberId, b.nudges.length]).sort()).toEqual([["arjun", 2], ["kavya", 1]]);
    // A drain is a read; delivering marks them, and then nothing is left.
    await markDelivered(FAM, due.flatMap((b) => b.nudges), "inapp", new Date("2026-10-29T03:00:00Z"));
    expect(await drain(FAM, new Date("2026-10-29T03:00:00Z"))).toEqual([]);
    expect(await pendingFor(FAM, "arjun")).toEqual([]);
    expect(await listFor(FAM, "arjun", new Date("2026-10-29T03:00:00Z"))).toHaveLength(2); // delivered this week still listed
  });

  it("without a mail provider delivery marks them in-app", async () => {
    await enqueueNudge(FAM, { ...base, toMemberId: "arjun", href: "/a" }, NOW);
    const out = await deliverDueNudges(FAM, await dbListMembers(FAM), new Date("2026-10-30T00:00:00Z"));
    expect(out.inapp).toBe(1);
    expect((await mine("arjun"))[0]).toMatchObject({ channel: "inapp" });
  });
});

describe("producers never notify the actor", () => {
  it("a play on your own card says nothing; a play on Maa's card tells Maa", async () => {
    const card = await dbAddCard({ familyId: FAM, type: "audio", caption: "hi", lang: "en", takenAt: NOW.toISOString(), authorId: "dadi", source: "upload" });
    await nudgeHeard(FAM, card, "dadi");
    expect(await mine("dadi")).toHaveLength(0);
    await nudgeHeard(FAM, card, "arjun");
    const [n] = await mine("dadi");
    expect(n.kind).toBe("heard");
    expect(renderNudgeText(n.text, await dbListMembers(FAM))).toBe("Arjun heard your voice memory");
    expect(n.text).not.toMatch(/\d/); // no counts
  });

  it("blessing and love notify, a laugh and your own card do not", async () => {
    const card = await dbAddCard({ familyId: FAM, type: "photo", caption: "x", lang: "en", takenAt: NOW.toISOString(), authorId: "dadi", source: "upload" });
    await nudgeReacted(FAM, card, "arjun", "laugh");
    expect(await mine("dadi")).toHaveLength(0);
    await nudgeReacted(FAM, card, "dadi", "bless");
    expect(await mine("dadi")).toHaveLength(0);
    await nudgeReacted(FAM, card, "arjun", "bless");
    expect((await mine("dadi"))[0].text).toBe("{m:arjun} blessed your photo");
  });

  it("a play route call still succeeds and enqueues; a parent who keeps visits private is not reported", async () => {
    const card = await dbAddCard({ familyId: FAM, type: "audio", caption: "hi", lang: "en", takenAt: NOW.toISOString(), authorId: "arjun", source: "upload" });
    const res = await playsPOST(authedJson("http://t/api/plays", { cardId: card.id, memberId: "dadi" }, "dadi"));
    expect(res.status).toBe(201);
    expect((await mine("arjun")).map((n) => n.kind)).toEqual(["heard"]);
    await putDoc(FAM, "care_settings", { id: "dada", memberId: "dada", shareVisits: false, updatedAt: NOW.toISOString() });
    await playsPOST(authedJson("http://t/api/plays", { cardId: card.id, memberId: "dada" }, "dada"));
    expect(await mine("arjun")).toHaveLength(1);
  });

  it("a parent's share reaches their children and not themselves", async () => {
    const rels = await dbListRelationships(FAM);
    const parent = rels.find((r) => r.canonicalKind === "child")?.memberId ?? rels.find((r) => r.canonicalKind === "parent")?.relationMemberId;
    expect(parent).toBeTruthy();
    await nudgeShared(FAM, parent as string, "recipe", "/kitchen/r1");
    const all = await listDocs(FAM, "nudge");
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((n) => n.kind === "shared" && n.toMemberId !== parent)).toBe(true);
  });
});

describe("scan nudges: occasion, call, letter digest", () => {
  const sunday = new Date("2026-11-01T09:00:00.000Z");
  const letter = (id: string, at: string) => putDoc(FAM, "chitthi", { id, kind: "letter", title: "A good week", body: "Dear family,\nA good week.", lang: "en", authorId: "dadi", deliverAt: at, createdAt: at });

  it("an occasion within 7 days goes to everyone once a week", async () => {
    const members = await dbListMembers(FAM);
    const occasions = [{ slug: "diwali", title: "Diwali", date: "2026-11-03" }, { slug: "far", title: "Later", date: "2026-12-30" }];
    const a = await queueScanNudges(FAM, { members, now: NOW, occasions });
    const again = await queueScanNudges(FAM, { members, now: NOW, occasions });
    expect(a.queued).toBeGreaterThan(0);
    expect(again.queued).toBe(0);
    const all = await listDocs(FAM, "nudge");
    expect(all.every((n) => n.kind === "occasion" && n.text === "Diwali is on Tuesday")).toBe(true);
  });

  it("the weekly call tomorrow is read defensively: no weekly_call kind, no nudge, no error", async () => {
    const out = await queueScanNudges(FAM, { members: await dbListMembers(FAM), now: NOW, occasions: [] });
    expect(out.queued).toBe(0);
  });

  it("the letter digest goes out on Sunday only, once, with the letter in the mail", async () => {
    const members = await dbListMembers(FAM);
    await letter("letter-1", "2026-10-30T10:00:00.000Z");
    expect((await queueScanNudges(FAM, { members, now: NOW, occasions: [] })).queued).toBe(0); // Wednesday
    const first = await queueScanNudges(FAM, { members, now: sunday, occasions: [] });
    expect(first.queued).toBeGreaterThan(0);
    expect((await queueScanNudges(FAM, { members, now: sunday, occasions: [] })).queued).toBe(0);
    expect((await queueScanNudges(FAM, { members, now: new Date(sunday.getTime() + 3600_000), occasions: [] })).queued).toBe(0);
    const all = await listDocs(FAM, "nudge");
    expect(all.every((n) => n.kind === "letter" && n.href === "/home?letter=letter-1")).toBe(true);
    // Last week's letter is not this week's.
    await letter("letter-old", "2026-10-20T10:00:00.000Z");
  });

  it("no approved letter this week, no digest", async () => {
    await letter("letter-old", "2026-10-20T10:00:00.000Z");
    expect((await queueScanNudges(FAM, { members: await dbListMembers(FAM), now: sunday, occasions: [] })).queued).toBe(0);
  });
});

describe("the email", () => {
  it("is big, plain, one button, the letter inside, and escapes text", () => {
    const m = renderDigestEmail({ name: "Arjun", lines: ["Maa heard your <b>voice</b> note"], letter: { title: "A good week", body: "Dear family" }, openUrl: "https://nearer.example", shareUrl: "https://wa.me/?text=x" });
    expect(m.subject).toBe("A good week");
    expect(m.html).toContain("Open Nearer");
    expect(m.html).not.toContain("<b>voice</b>");
    expect(m.html.match(/Open Nearer/g)).toHaveLength(1);
    expect(m.text).toContain("Dear family");
    expect(m.html + m.text).not.toMatch(/days since|streak/i);
  });
});

describe("api", () => {
  it("you read and mark only your own; settings default from the member", async () => {
    await enqueueNudge(FAM, { ...base, toMemberId: "arjun", href: "/a" }, new Date());
    await enqueueNudge(FAM, { ...base, toMemberId: "kavya", href: "/a" }, new Date());
    const list = (await (await nudgesGET(authedGet("http://t/api/nudges", "arjun"))).json()) as { nudges: { id: string; text: string; waiting: boolean; seen: boolean }[] };
    const seed = list.nudges.map((n) => n.text);
    expect(seed).toContain("Maa heard your voice memory"); // seeded demo ones + this one, names resolved
    expect(list.nudges.every((n) => n.waiting)).toBe(true);
    const out = (await (await seenPOST(authedJson("http://t/api/nudges/seen", { ids: "all" }, "arjun"))).json()) as { seen: number };
    expect(out.seen).toBe(list.nudges.length);
    expect((await mine("kavya"))[0].seenAt).toBeNull();
    const s = (await (await settingsGET(authedGet("http://t/api/nudges/settings", "arjun"))).json()) as { settings: { maxPerWeek: number } };
    expect(s.settings.maxPerWeek).toBe(3);
    const put = await settingsPUT(new Request("http://t/api/nudges/settings", { method: "PUT", headers: { cookie: authedGet("http://t", "arjun").headers.get("cookie") ?? "", "content-type": "application/json" }, body: JSON.stringify({ email: false, maxPerWeek: 2 }) }));
    expect(put.status).toBe(200);
    const bad = await settingsPUT(new Request("http://t/api/nudges/settings", { method: "PUT", headers: { cookie: authedGet("http://t", "arjun").headers.get("cookie") ?? "", "content-type": "application/json" }, body: JSON.stringify({ email: true, maxPerWeek: 9 }) }));
    expect(bad.status).toBe(400);
  });

  it("the demo has two nudges waiting for Arjun", async () => {
    resetDemo();
    expect((await pendingFor(FAM, "arjun")).map((n) => n.kind).sort()).toEqual(["heard", "occasion"]);
  });
});
