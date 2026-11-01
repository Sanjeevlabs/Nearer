import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/gather/events/route";
import { GET as sitGET } from "@/app/api/sit/route";
import TEMPLATES from "@/data/event-templates.json";
import {
  EVENT_TYPES,
  EventPlanSchema,
  SongSchema,
  fallbackPlan,
  planMentionsPurchase,
  fitsEveryone,
  proposeSlots,
  slotToLock,
  songLinks,
  toggleVote,
  type FamilyEvent,
} from "@/lib/events";
import { buildPrompts, type UpcomingOccasion } from "@/lib/gather-prompts";
import { resetEvents } from "@/lib/gather-store";
import { hourIn } from "@/lib/zones";
import { resetDemo } from "@/lib/store";
import { addDays } from "@/lib/occasion-calendar";
import { sessionCookie } from "./auth-helper";

const req = (member: string, body?: unknown) =>
  new Request("http://test/api/gather/events", { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", cookie: sessionCookie(member) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;

beforeEach(() => {
  process.env.MOCK = "true";
  resetDemo();
  resetEvents();
});

const people = [
  { id: "maa", role: "elder", lang: "hi" },
  { id: "papa", role: "elder", lang: "hi" },
  { id: "arjun", role: "adult", lang: "en" },
  { id: "priya", role: "adult", lang: "en" },
  { id: "kid", role: "child", lang: "en" },
];

describe("slots across homes", () => {
  it("proposes 3 future times when every home is awake 8 AM–10 PM for the whole call", () => {
    const now = new Date("2026-10-30T06:00:00Z");
    const slots = proposeSlots({ zones: ["Asia/Kolkata", "Europe/London", "America/New_York"], hostTz: "Asia/Kolkata", date: "2026-11-08", minutes: 45, now });
    expect(slots).toHaveLength(3);
    for (const s of slots) {
      expect(s.getTime()).toBeGreaterThan(now.getTime());
      for (const tz of ["Asia/Kolkata", "Europe/London", "America/New_York"]) {
        expect(hourIn(tz, s)).toBeGreaterThanOrEqual(8);
        expect(hourIn(tz, new Date(s.getTime() + 45 * 60_000 - 1))).toBeLessThan(22);
      }
    }
    const ts = slots.map((s) => s.getTime()).sort();
    expect(ts[1] - ts[0]).toBeGreaterThanOrEqual(2 * 3_600_000);
  });

  it("returns nothing when no hour fits everyone", () => {
    expect(fitsEveryone(["Asia/Kolkata", "Pacific/Honolulu"], new Date("2026-11-08T16:30:00Z"), 60)).toBe(false);
    expect(proposeSlots({ zones: ["Asia/Kolkata", "America/Los_Angeles"], hostTz: "Asia/Kolkata", date: "2026-11-08", minutes: 60, now: new Date("2026-10-30T00:00:00Z") }).length).toBeLessThanOrEqual(3);
  });
});

describe("the fallback plan is data", () => {
  it("every event type yields a valid plan with 5–8 named songs and real owners", () => {
    for (const type of EVENT_TYPES) {
      const plan = fallbackPlan(type, people, { hostId: "arjun", honoreeId: "maa" });
      expect(EventPlanSchema.safeParse(plan).success).toBe(true);
      expect(plan.playlist.length).toBeGreaterThanOrEqual(5);
      expect(plan.playlist.length).toBeLessThanOrEqual(8);
      // Both languages represented.
      const hi = (TEMPLATES.playlists as Record<string, Record<string, { title: string }[]>>)[type].hi.map((s) => s.title);
      expect(plan.playlist.some((s) => hi.includes(s.title))).toBe(true);
      for (const x of [...plan.runOfShow, ...plan.tasks]) expect(x.ownerId === null || people.some((p) => p.id === x.ownerId)).toBe(true);
    }
  });

  it("never gives the person being celebrated a surprise task", () => {
    const plan = fallbackPlan("birthday", people, { hostId: "arjun", honoreeId: "maa" }, { extras: true });
    expect(plan.tasks.some((t) => /cake/i.test(t.text) && t.ownerId === "maa")).toBe(false);
  });

  it("plans wishes, songs and photos, and nothing to buy, unless an admin asks for extras", () => {
    for (const type of EVENT_TYPES) {
      const plain = fallbackPlan(type, people, { hostId: "arjun", honoreeId: "maa" });
      expect(planMentionsPurchase(plain)).toBe(false);
      expect(plain.tasks.some((t) => /wish/i.test(t.text)) || type === "visit").toBe(true);
    }
    const withCake = fallbackPlan("birthday", people, { hostId: "arjun", honoreeId: "maa" }, { extras: true });
    expect(EventPlanSchema.safeParse(withCake).success).toBe(true);
    expect(planMentionsPurchase(withCake)).toBe(true);
    expect(withCake.runOfShow.some((s) => s.title === "Cake and candles")).toBe(true);
    expect(withCake.runOfShow.reduce((n, s) => n + s.minutes, 0)).toBe(fallbackPlan("birthday", people, { hostId: "arjun", honoreeId: "maa" }).runOfShow.reduce((n, s) => n + s.minutes, 0));
  });

  it("rejects a song without a real artist, and links only to search", () => {
    expect(SongSchema.safeParse({ title: "A song", artist: "Unknown", why: "nice" }).success).toBe(false);
    expect(SongSchema.safeParse({ title: "A song", artist: "", why: "nice" }).success).toBe(false);
    const l = songLinks({ title: "Lag Ja Gale", artist: "Lata Mangeshkar" });
    expect(l.youtube.startsWith("https://music.youtube.com/search?q=")).toBe(true);
    expect(l.spotify.startsWith("https://open.spotify.com/search/")).toBe(true);
  });
});

function event(over: Partial<FamilyEvent> = {}): FamilyEvent {
  return {
    id: "event-1",
    type: "birthday",
    title: "Maa's birthday celebration",
    forMemberId: "maa",
    occasionKey: "birthday",
    date: "2026-11-09",
    hostId: "arjun",
    invites: ["maa", "papa", "priya"],
    minutes: 45,
    slots: [
      { id: "s1", startsAt: "2026-11-09T13:30:00.000Z" },
      { id: "s2", startsAt: "2026-11-09T16:00:00.000Z" },
    ],
    votes: {},
    answered: [],
    status: "voting",
    lockedSlotId: null,
    sittingId: null,
    plan: fallbackPlan("birthday", people, { hostId: "arjun", honoreeId: "maa" }),
    planSource: "fallback",
    extras: false,
    createdAt: "2026-10-30T00:00:00.000Z",
    ...over,
  };
}

describe("one tap each; locks when most can make it", () => {
  it("waits for more than half, then picks the most-voted slot", () => {
    let e = event();
    e = toggleVote(e, "s2", "arjun");
    e = toggleVote(e, "s2", "maa");
    expect(slotToLock(e)).toBeNull(); // 2 of 4
    e = toggleVote(e, "s2", "papa");
    expect(slotToLock(e)?.id).toBe("s2");
    // A second tap takes it back.
    expect(slotToLock(toggleVote(e, "s2", "papa"))).toBeNull();
  });
});

describe("in-app prompts", () => {
  const occ = (days: number, memberId = "maa"): UpcomingOccasion => ({ key: `birthday:${memberId}:2026-11-09`, slug: "birthday", kind: "birthday", type: "birthday", date: "2026-11-09", days, label: "Maa's birthday", memberId });
  const now = new Date("2026-11-09T12:30:00Z");

  it("asks invitees to pick a time, then says it starts in an hour", () => {
    const voting = buildPrompts({ viewerId: "papa", canPlan: true, events: [event()], occasions: [], dismissed: [], now });
    expect(voting[0]).toMatchObject({ kind: "pick", text: "Join Maa's birthday celebration: pick a time" });
    const locked = event({ status: "locked", lockedSlotId: "s1", answered: ["papa"] });
    const soon = buildPrompts({ viewerId: "papa", canPlan: true, events: [locked], occasions: [], dismissed: [], now });
    expect(soon[0]).toMatchObject({ kind: "soon", text: "Maa's birthday celebration · Starts in 1 hour" });
  });

  it("suggests planning 10 days before, once, to grown-ups other than the honoree", () => {
    expect(buildPrompts({ viewerId: "arjun", canPlan: true, events: [], occasions: [occ(10)], dismissed: [], now })[0]).toMatchObject({ kind: "suggest", text: "Plan Maa's birthday celebration? \u00b7 9 Nov" });
    expect(buildPrompts({ viewerId: "arjun", canPlan: true, events: [], occasions: [occ(11)], dismissed: [], now })).toHaveLength(0);
    expect(buildPrompts({ viewerId: "maa", canPlan: true, events: [], occasions: [occ(5)], dismissed: [], now })).toHaveLength(0);
    expect(buildPrompts({ viewerId: "kid", canPlan: false, events: [], occasions: [occ(5)], dismissed: [], now })).toHaveLength(0);
    expect(buildPrompts({ viewerId: "arjun", canPlan: true, events: [], occasions: [occ(5)], dismissed: ["suggest:birthday:maa:2026-11-09"], now })).toHaveLength(0);
    expect(buildPrompts({ viewerId: "arjun", canPlan: true, events: [event({ date: "2026-11-09" })], occasions: [occ(5)], dismissed: [], now }).some((p) => p.kind === "suggest")).toBe(false);
  });
});

describe("/api/gather/events (mock)", () => {
  it("drafts, collects one tap each, locks into a gathering session with a room", async () => {
    const date = addDays(new Date().toISOString().slice(0, 10), 5);
    const created = await POST(req("arjun", { action: "create", type: "custom", title: "Papa's retirement", forMemberId: "dada", date }));
    expect(created.status).toBe(201);
    const { event: e } = (await created.json()) as { event: FamilyEvent };
    expect(e.title).toBe("Papa's retirement");
    expect(e.slots.length).toBeGreaterThan(0);
    expect(e.plan.playlist.length).toBeGreaterThanOrEqual(5);
    // Kids can't create; outsiders to the plan can't vote.
    expect((await POST(req("leo", { action: "create", type: "custom", title: "x party", date }))).status).toBe(403);

    // The others see "pick a time".
    const seen = await json<{ prompts: { kind: string; text: string }[] }>(GET(req("dadi")));
    expect(seen.prompts.some((p) => p.kind === "pick" && p.text === "Join Papa's retirement: pick a time")).toBe(true);

    // Non-host can't lock.
    expect((await POST(req("dadi", { action: "lock", eventId: e.id, slotId: e.slots[0].id }))).status).toBe(403);

    const everyone = [e.hostId, ...e.invites];
    let last: { event: FamilyEvent; locked: boolean } | null = null;
    for (const id of everyone.slice(0, Math.floor(everyone.length / 2) + 1)) {
      last = await json(POST(req(id, { action: "vote", eventId: e.id, slotId: e.slots[0].id })));
    }
    expect(last?.locked).toBe(true);
    expect(last?.event.sittingId).toBeTruthy();
    const sit = await json<{ sittings: { id: string; title: string; startsAt: string }[] }>(sitGET(new Request("http://test/api/sit", { headers: { cookie: sessionCookie("arjun") } })));
    expect(sit.sittings.find((s) => s.id === last?.event.sittingId)).toMatchObject({ title: "Papa's retirement", startsAt: e.slots[0].startsAt });

    // Tasks are assignable to members.
    const t = e.plan.tasks[0];
    const assigned = await json<{ event: FamilyEvent }>(POST(req("dadi", { action: "task", eventId: e.id, taskId: t.id, ownerId: "dadi", done: true })));
    expect(assigned.event.plan.tasks[0]).toMatchObject({ ownerId: "dadi", done: true });
    expect((await POST(req("dadi", { action: "task", eventId: e.id, taskId: t.id, ownerId: "stranger" }))).status).toBe(400);
  });

  it("locks into a sitting in the venue the planner chose", async () => {
    const date = addDays(new Date().toISOString().slice(0, 10), 5);
    const { event: e } = await json<{ event: FamilyEvent }>(POST(req("arjun", { action: "create", type: "custom", title: "Terrace evening", date })));
    const locked = await json<{ event: FamilyEvent }>(POST(req("arjun", { action: "lock", eventId: e.id, slotId: e.slots[0].id, venue: "terrace" })));
    expect(locked.event.sittingId).toBeTruthy();
    const sit = await json<{ sittings: { id: string; venue: string }[] }>(sitGET(new Request("http://test/api/sit", { headers: { cookie: sessionCookie("arjun") } })));
    expect(sit.sittings.find((s) => s.id === locked.event.sittingId)?.venue).toBe("terrace");
  });

  it("one event per occasion and date: a second tap opens the same one", async () => {
    const date = addDays(new Date().toISOString().slice(0, 10), 4);
    const body = { action: "create", type: "birthday", occasionKey: "birthday", forMemberId: "dadi", date };
    const a = await json<{ event: FamilyEvent }>(POST(req("arjun", body)));
    const b = await json<{ event: FamilyEvent }>(POST(req("priya", body)));
    expect(b.event.id).toBe(a.event.id);
    expect(a.event.title).toBe("Maa's birthday celebration");
  });
});
