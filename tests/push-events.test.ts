// What sends, and when: the hook points, the 8 AM summary, the daily cap and quiet hours as people
// meet them, safety at any hour, and the clean-up after the push services. Mock mode records what
// would have been pushed in `outbox`; the clean-up tests drive the real path with a fake fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as cardPost } from "@/app/api/cards/route";
import { POST as askPost } from "@/app/api/kid-ask/route";
import { POST as keeperPost } from "@/app/api/keeper/route";
import { POST as lampPost } from "@/app/api/lamp/route";
import { GET as sweepGet } from "@/app/api/push/sweep/route";
import { POST as safetyPost } from "@/app/api/safety/route";
import { dbGetMember, dbListMembers, dbUpdateMemberProfile } from "@/lib/db";
import { deleteDoc, getDoc, listDocs } from "@/lib/family-docs";
import { deliverDueNudges } from "@/lib/nudge-run";
import { enqueueNudge } from "@/lib/nudges";
import { pushIdle } from "@/lib/push/background";
import { pushCardActivity, pushFamilyJoined, pushHabitTick, pushMorning, routePush, sweepOverdue } from "@/lib/push/events";
import { MAX_IMMEDIATE_PER_DAY } from "@/lib/push/policy";
import { getPushSettings, savePushPrefs } from "@/lib/push/prefs";
import { clearOutbox, outbox, pushToMember, resetPushWarnings } from "@/lib/push/send";
import { MAX_FAILURES, listSubs, resetPushStore, upsertSub } from "@/lib/push/store";
import { generateVapidKeys } from "@/lib/push/webpush";
import { resetDemo } from "@/lib/store";
import { authedJson } from "./auth-helper";

const FAM = "demo-family";
// Wed 28 Oct 2026. 16:00 UTC is noon in New York (arjun) and 21:30 in India (dadi).
const NOON_NY = new Date("2026-10-28T16:00:00.000Z");
const NIGHT_NY = new Date("2026-10-28T05:00:00.000Z"); // 01:00 in New York
const MORNING_NY = new Date("2026-10-28T12:30:00.000Z"); // 08:30 in New York
const B64_65 = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const B64_16 = "BTBZMqHH6r4Tts7J_aSIgg";
const json = async <T = Record<string, unknown>>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const post = (path: string, body: unknown, as: string) => authedJson(`http://t${path}`, body, as);
const to = (member: string) => outbox.filter((o) => o.memberId === member);
const bodies = (member: string) => to(member).map((o) => o.msg.body);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON_NY);
  resetDemo();
  // Arjun lives in New York for these tests; Dadi is in India (the demo seed has both in India).
  await dbUpdateMemberProfile("arjun", { tz: "America/New_York" });
  resetPushStore();
  clearOutbox();
  resetPushWarnings();
});
afterEach(() => vi.useRealTimers());

const voiceCard = (authorAs: string, addressedTo: string | null) =>
  cardPost(post("/api/cards", { type: "audio", caption: "hello", lang: "en", takenAt: new Date().toISOString(), addressedTo }, authorAs));

describe("a voice memory sent to someone", () => {
  it("pushes the people it is addressed to, never the sender, deep-linking to the card", async () => {
    const res = await json<{ card: { id: string } }>(await voiceCard("dadi", "arjun,dadi"));
    await pushIdle();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ familyId: FAM, memberId: "arjun", msg: { title: "Nearer", body: "Maa sent you a voice memory", url: `/lane?card=${res.card.id}`, tag: `voice-${res.card.id}`, urgency: "high" } });
  });

  it("a note to the whole family (no addressee) pushes nobody", async () => {
    await voiceCard("dadi", null);
    await pushIdle();
    expect(outbox).toEqual([]);
  });

  it("speaks the recipient's language when it has it", async () => {
    await voiceCard("arjun", "dadi"); // dadi reads Hindi (Devanagari)
    await pushIdle();
    expect(bodies("dadi")).toEqual(["Arjun ने आपको वॉइस नोट भेजा"]);
  });

  it("never fails the upload, even if the push work blows up", async () => {
    await dbUpdateMemberProfile("arjun", { tz: "Nowhere/Land" }); // odd zone: handled, not thrown
    const res = await voiceCard("dadi", "arjun");
    expect(res.status).toBe(201);
    await pushIdle();
  });
});

describe("the lamp", () => {
  it("a heartbeat lights the lamp for the person it was sent to, once a minute", async () => {
    expect((await lampPost(post("/api/lamp", { action: "beat", toMemberId: "arjun" }, "dadi"))).status).toBe(200);
    await lampPost(post("/api/lamp", { action: "beat", toMemberId: "arjun" }, "dadi")); // throttled
    await pushIdle();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ memberId: "arjun", msg: { body: "Maa lit the lamp for you", url: "/", tag: "lamp-dadi" } });
  });

  it("lighting the lamp tells the other homes, never your own", async () => {
    await lampPost(post("/api/lamp", { action: "light" }, "dadi"));
    await pushIdle();
    expect(bodies("arjun")).toEqual(["Maa lit the lamp for you"]);
    expect(to("arjun")[0].msg).toMatchObject({ url: "/", tag: "lamp-dadi" });
    expect(to("dadi")).toEqual([]);
  });
});

describe("questions and kids' asks", () => {
  it("a question for an elder pushes them, linking to the inbox", async () => {
    await keeperPost(post("/api/keeper", { action: "ask", toMemberId: "dadi", text: "How do you make the pickle?", topic: "wisdom" }, "arjun"));
    await pushIdle();
    expect(bodies("dadi")).toEqual(["Arjun ने आपसे कुछ पूछा"]);
    expect(to("dadi")[0].msg.url).toBe("/inbox");
    clearOutbox();
  });

  it("a child's ask goes to the grown-ups they ask, with story wording for stories", async () => {
    await askPost(post("/api/kid-ask", { action: "ask", topic: "story", text: "A tiger story", toMemberId: "dadi" }, "aria"));
    await pushIdle();
    expect(to("dadi")).toHaveLength(1);
    expect(to("dadi")[0].msg.url).toBe("/inbox");
    expect(to("dadi")[0].msg.tag).toMatch(/^ask-/);
    // The same ask twice is one ask: no second push.
    await askPost(post("/api/kid-ask", { action: "ask", topic: "story", text: "A tiger story", toMemberId: "dadi" }, "aria"));
    await pushIdle();
    expect(to("dadi")).toHaveLength(1);
  });
});

describe("quiet hours, six a day, and the morning summary", () => {
  it("at night it waits: nothing now, held for the summary", async () => {
    vi.setSystemTime(NIGHT_NY);
    await voiceCard("dadi", "arjun");
    await pushIdle();
    expect(outbox).toEqual([]);
    expect((await getPushSettings(FAM, "arjun")).overflow).toBe(1);
    // Morning: one push, no counts of anything but what arrived.
    expect(await pushMorning(FAM, [(await dbGetMember("arjun"))!], new Map(), MORNING_NY)).toBe(1);
    expect(bodies("arjun")).toEqual(["Something from your family"]);
    expect(to("arjun")[0].msg).toMatchObject({ url: "/inbox", title: "Nearer" });
    expect((await getPushSettings(FAM, "arjun")).overflow).toBe(0);
    // And only once.
    expect(await pushMorning(FAM, [(await dbGetMember("arjun"))!], new Map(), MORNING_NY)).toBe(0);
  });

  it("the seventh of the day is held; the summary says how many came in all", async () => {
    const arjun = (await dbGetMember("arjun"))!;
    const results: string[] = [];
    for (let i = 0; i < MAX_IMMEDIATE_PER_DAY + 2; i++) {
      results.push(await routePush(FAM, arjun, "voice", () => ({ body: `note ${i}`, url: "/inbox", tag: `t${i}`, urgency: "high" }), NOON_NY));
    }
    expect(results).toEqual(["sent", "sent", "sent", "sent", "sent", "sent", "held", "held"]);
    expect(outbox).toHaveLength(6);
    // Next morning's run delivered one nudge as well: 1 + 2 held = 3 things.
    const next = new Date("2026-10-29T12:30:00.000Z");
    expect(await pushMorning(FAM, [arjun], new Map([["arjun", ["Dadi heard your voice memory"]]]), next)).toBe(1);
    expect(outbox[outbox.length - 1].msg.body).toBe("3 things from your family");
  });

  it("the count starts again the next day in their own zone", async () => {
    const arjun = (await dbGetMember("arjun"))!;
    for (let i = 0; i < 7; i++) await routePush(FAM, arjun, "lamp", () => ({ body: "x", url: "/", tag: `l${i}`, urgency: "high" }), NOON_NY);
    expect(await routePush(FAM, arjun, "lamp", () => ({ body: "x", url: "/", tag: "again", urgency: "high" }), new Date("2026-10-29T16:00:00.000Z"))).toBe("sent");
  });

  it("a switched-off kind sends nothing and holds nothing", async () => {
    await savePushPrefs(FAM, "arjun", { voice: false, lamp: true, asks: true, digest: true, safety: true });
    const arjun = (await dbGetMember("arjun"))!;
    expect(await routePush(FAM, arjun, "voice", () => ({ body: "x", url: "/", tag: "v", urgency: "high" }), NOON_NY)).toBe("skipped");
    expect(await routePush(FAM, arjun, "voice", () => ({ body: "x", url: "/", tag: "v", urgency: "high" }), NIGHT_NY)).toBe("skipped");
    expect((await getPushSettings(FAM, "arjun")).overflow).toBe(0);
  });

  it("the daily nudge run pushes one summary per person, in the same run that delivers the nudges", async () => {
    for (const id of ["nudge-demo-heard", "nudge-demo-occasion"]) await deleteDoc(FAM, "nudge", id); // the demo seeds two for Arjun
    const members = await dbListMembers(FAM);
    await enqueueNudge(FAM, { toMemberId: "arjun", kind: "heard", text: "{m:dadi} heard your voice memory", href: "/home?card=a", actorId: "dadi" }, new Date("2026-10-27T10:00:00Z"));
    await enqueueNudge(FAM, { toMemberId: "arjun", kind: "blessed", text: "{m:dadi} blessed your voice memory", href: "/home?card=b", actorId: "dadi" }, new Date("2026-10-27T10:01:00Z"));
    await deliverDueNudges(FAM, members, MORNING_NY);
    expect(bodies("arjun")).toEqual(["2 things from your family"]);
    // Nothing left to deliver: nothing more to say.
    clearOutbox();
    await deliverDueNudges(FAM, members, MORNING_NY);
    expect(outbox).toEqual([]);
  });

  it("never mentions inactivity: no streaks, no 'days since', no 'haven't opened'", () => {
    // Every string a push can carry, in every language we have.
    return import("@/lib/push/copy").then(({ wordsFor }) => {
      for (const lang of ["en", "hi-latn", "hi-deva"]) {
        const w = wordsFor(lang);
        const all = [w.voice("A", "voice memory"), w.voice("A", "photo"), w.voice("A", "video"), w.beat("A"), w.ask("A"), w.story("A"), w.help("A"), w.overdue("A"), w.digest(3), w.digestOne, w.test].join(" ");
        expect(all).not.toMatch(/streak|days? (ago|since)|haven.t (opened|visited)|miss(ed)? you|inactive|दिन से|din se/i);
      }
    });
  });
});

describe("Safe & sound reaches people at any hour", () => {
  async function setup(watchers = ["arjun"]) {
    await safetyPost(post("/api/safety", { action: "settings", enabled: true, watchers, paused: false }, "priya"));
  }

  it("'I need help' goes to the people she chose, at night, with no cap", async () => {
    await setup();
    vi.setSystemTime(NIGHT_NY);
    const arjun = (await dbGetMember("arjun"))!;
    for (let i = 0; i < 8; i++) await routePush(FAM, arjun, "voice", () => ({ body: "x", url: "/", tag: `v${i}`, urgency: "high" }), NOON_NY); // arjun is over his cap
    clearOutbox();
    expect((await safetyPost(post("/api/safety", { action: "checkin", kind: "help" }, "priya"))).status).toBe(201);
    await pushIdle();
    expect(to("arjun")).toHaveLength(1);
    expect(to("arjun")[0].msg).toMatchObject({ body: "Priya asked for help", url: "/safe", tag: "safe-priya", urgency: "high" });
    expect(outbox.filter((o) => o.memberId !== "arjun")).toEqual([]);
  });

  it("a calm check-in tells nobody; a paused or switched-off Safe & sound tells nobody", async () => {
    await setup();
    await safetyPost(post("/api/safety", { action: "checkin", kind: "home-safe" }, "priya"));
    await pushIdle();
    expect(outbox).toEqual([]);
    await safetyPost(post("/api/safety", { action: "settings", enabled: true, watchers: ["arjun"], paused: true }, "priya"));
    await safetyPost(post("/api/safety", { action: "checkin", kind: "help" }, "priya"));
    await pushIdle();
    expect(outbox).toEqual([]);
  });

  it("an overdue check-in is told once, when its grace has run out, at any hour", async () => {
    await setup();
    const eta = new Date("2026-10-28T04:00:00.000Z"); // 00:00 in New York
    vi.setSystemTime(new Date("2026-10-28T03:30:00.000Z"));
    await safetyPost(post("/api/safety", { action: "checkin", kind: "heading", etaAt: eta.toISOString() }, "priya"));
    // Within the 20 minute grace: nothing.
    expect(await sweepOverdue(FAM, new Date("2026-10-28T04:15:00.000Z"))).toBe(0);
    // Past it, and the middle of the night: told.
    expect(await sweepOverdue(FAM, new Date("2026-10-28T04:25:00.000Z"))).toBe(1);
    expect(to("arjun")[0].msg).toMatchObject({ body: "Priya hasn't checked in yet", url: "/safe", tag: "safe-priya" });
    // Never twice.
    expect(await sweepOverdue(FAM, new Date("2026-10-28T05:25:00.000Z"))).toBe(0);
    expect(to("arjun")).toHaveLength(1);
    expect((await listDocs(FAM, "safety_checkin")).find((c) => c.memberId === "priya" && c.kind === "heading")?.alertedAt).toBeTruthy();
  });

  it("a check-in that was closed in time is never alerted", async () => {
    await setup();
    vi.setSystemTime(new Date("2026-10-28T03:30:00.000Z"));
    const { checkin } = await json<{ checkin: { id: string } }>(await safetyPost(post("/api/safety", { action: "checkin", kind: "heading", etaAt: "2026-10-28T04:00:00.000Z" }, "priya")));
    await safetyPost(post("/api/safety", { action: "close", checkinId: checkin.id }, "priya"));
    expect(await sweepOverdue(FAM, new Date("2026-10-28T06:00:00.000Z"))).toBe(0);
  });

  it("the sweep route needs the cron secret", async () => {
    expect((await sweepGet(new Request("http://t/api/push/sweep"))).status).toBe(401);
    const ok = await sweepGet(new Request("http://t/api/push/sweep", { headers: { authorization: "Bearer test-cron-secret" } }));
    expect(ok.status).toBe(200);
  });
});

describe("after the push services answer", () => {
  const LIVE_FAMILY = "family-push-transport-fixture";
  async function liveEnv() {
    const keys = await generateVapidKeys();
    return { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey };
  }
  const msg = { title: "Nearer", body: "x", url: "/", tag: "t", urgency: "normal" as const };
  const web = (endpoint: string) => upsertSub({ familyId: LIVE_FAMILY, memberId: "arjun", kind: "webpush", token: endpoint, p256dh: B64_65, auth: B64_16, platform: "web" });
  const answer = (status: number) => (async () => new Response(null, { status })) as unknown as typeof fetch;

  it("410 deletes the subscription; the good one stays and is marked", async () => {
    const env = await liveEnv();
    await web("https://updates.push.services.mozilla.com/wpush/v2/gone");
    await web("https://fcm.googleapis.com/fcm/send/good");
    const fetchFn = (async (url: string) => new Response(null, { status: url.includes("/gone") ? 410 : 201 })) as unknown as typeof fetch;
    const r = await pushToMember(LIVE_FAMILY, "arjun", msg, { mock: false, env, fetch: fetchFn });
    expect(r).toEqual({ sent: 1, removed: 1 });
    const left = await listSubs(LIVE_FAMILY, "arjun");
    expect(left.map((s) => s.token)).toEqual(["https://fcm.googleapis.com/fcm/send/good"]);
    expect(left[0].lastOkAt).toBeTruthy();
  });

  it("404 deletes it too", async () => {
    await web("https://fcm.googleapis.com/fcm/send/old");
    await pushToMember(LIVE_FAMILY, "arjun", msg, { mock: false, env: await liveEnv(), fetch: answer(404) });
    expect(await listSubs(LIVE_FAMILY, "arjun")).toEqual([]);
  });

  it("another refusal counts a failure; the fifth drops it; a success clears the count", async () => {
    const env = await liveEnv();
    await web("https://fcm.googleapis.com/fcm/send/flaky");
    for (let i = 1; i < MAX_FAILURES; i++) {
      await pushToMember(LIVE_FAMILY, "arjun", msg, { mock: false, env, fetch: answer(400) });
      expect((await listSubs(LIVE_FAMILY, "arjun"))[0].failures).toBe(i);
    }
    await pushToMember(LIVE_FAMILY, "arjun", msg, { mock: false, env, fetch: answer(201) });
    expect((await listSubs(LIVE_FAMILY, "arjun"))[0].failures).toBe(0);
    for (let i = 0; i < MAX_FAILURES; i++) await pushToMember(LIVE_FAMILY, "arjun", msg, { mock: false, env, fetch: answer(400) });
    expect(await listSubs(LIVE_FAMILY, "arjun")).toEqual([]);
  });

  it("outages and rate limits count against nobody", async () => {
    const env = await liveEnv();
    await web("https://fcm.googleapis.com/fcm/send/steady");
    for (const status of [429, 500, 503]) await pushToMember(LIVE_FAMILY, "arjun", msg, { mock: false, env, fetch: answer(status) });
    expect((await listSubs(LIVE_FAMILY, "arjun"))[0].failures).toBe(0);
  });

  it("without keys the senders do nothing: no request, no deletion, one log line", async () => {
    await upsertSub({ familyId: LIVE_FAMILY, memberId: "arjun", kind: "fcm", token: "fixture-token-arjun-aaaaaaaa", platform: "android" });
    await web("https://fcm.googleapis.com/fcm/send/nokeys");
    let called = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchFn = (async () => (called++, new Response(null, { status: 201 }))) as unknown as typeof fetch;
    for (let i = 0; i < 3; i++) expect(await pushToMember(LIVE_FAMILY, "arjun", msg, { mock: false, env: {}, fetch: fetchFn })).toEqual({ sent: 0, removed: 0 });
    expect(called).toBe(0);
    expect(await listSubs(LIVE_FAMILY, "arjun")).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(2); // once for each missing config, however many pushes
    warn.mockRestore();
  });

  it("a person with no device is never counted, held or pushed (outside mock mode)", async () => {
    const arjun = { ...(await dbGetMember("arjun"))!, familyId: LIVE_FAMILY };
    expect(await routePush(LIVE_FAMILY, arjun, "voice", () => ({ body: "x", url: "/", tag: "v", urgency: "high" }), NOON_NY, { mock: false, env: {} })).toBe("skipped");
    expect((await getDoc(LIVE_FAMILY, "push_settings", "arjun")) ?? null).toBeNull();
  });
});

describe("family activity", () => {
  it("delivers one habit tick per actor, habit and local day to the other participants", async () => {
    const habit = { id: "walk", members: ["dadi", "arjun", "arjun", "removed"] };
    await Promise.all([pushHabitTick(FAM, habit, "dadi", "2026-10-28"), pushHabitTick(FAM, habit, "dadi", "2026-10-28")]);
    expect(outbox.map(({ memberId, msg }) => [memberId, msg.body, msg.url])).toEqual([["arjun", "Maa checked in for your shared habit", "/together"]]);
  });

  it("shares a rolling one-hour limit between reactions and replies", async () => {
    const card = { id: "memory", authorId: "arjun" };
    await pushCardActivity(FAM, card, "dadi", "reaction");
    await pushCardActivity(FAM, card, "dadi", "reply", new Date(NOON_NY.getTime() + 3_599_999), "reply");
    await pushCardActivity(FAM, card, "dadi", "reply", new Date(NOON_NY.getTime() + 3_600_000), "reply");
    expect(outbox.map(({ memberId, msg }) => [memberId, msg.body, msg.url])).toEqual([
      ["arjun", "Maa reacted to your memory", "/lane?card=memory"],
      ["arjun", "Maa replied to your memory", "/lane?card=reply"],
    ]);
  });

  it("notifies only owners and admins when someone joins by link", async () => {
    await pushFamilyJoined(FAM, "dadi");
    await pushFamilyJoined(FAM, "dadi");
    const admins = (await dbListMembers(FAM)).filter((m) => m.id !== "dadi" && ["owner", "admin"].includes(m.access));
    expect(admins.length).toBeGreaterThan(0);
    expect(outbox.map(({ memberId, msg }) => [memberId, msg.body, msg.url])).toEqual(admins.map((m) => [m.id, "Maa joined your family", "/people/dadi"]));
  });

  it("blocks real transport for the seed and its sandbox copies", async () => {
    const fetchFn = vi.fn();
    const msg = { title: "Nearer", body: "Test", url: "/", tag: "test", urgency: "normal" } as const;
    for (const familyId of [FAM, "demo-v-0123456789ab"]) {
      await upsertSub({ familyId, memberId: "arjun", kind: "fcm", token: `test-token-${familyId}`, platform: "android" });
      expect(await pushToMember(familyId, "arjun", msg, { mock: false, fetch: fetchFn })).toEqual({ sent: 0, removed: 0 });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
