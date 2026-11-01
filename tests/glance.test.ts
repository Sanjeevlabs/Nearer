import { describe, expect, it } from "vitest";
import { awakeCities, awakeNow, callBothZones, callTile, nextCallAt, nextUp, waitingForYou, waitingItems, type WaitingInput } from "@/lib/glance";

const m = (id: string, tz: string, city = "", role: "elder" | "adult" | "child" = "adult", extra: Record<string, unknown> = {}) => ({ id, tz, city, role, status: "active" as const, ...extra });

describe("awakeNow", () => {
  const members = [m("arjun", "Asia/Kolkata", "Bengaluru"), m("dadi", "Asia/Kolkata", "Amritsar", "elder"), m("anika", "America/Chicago", "Chicago"), m("leo", "Asia/Kolkata", "Bengaluru", "child")];
  it("is 7 AM to 10 PM local, per zone, never children or the viewer", () => {
    // 05:00Z = 10:30 IST (awake), 00:00 Chicago (asleep)
    expect(awakeNow(members, "arjun", new Date("2026-10-31T05:00:00Z")).map((a) => a.id)).toEqual(["dadi"]);
    // 14:00Z = 19:30 IST, 09:00 CDT: both awake
    expect(awakeNow(members, "arjun", new Date("2026-10-31T14:00:00Z")).map((a) => a.id)).toEqual(["dadi", "anika"]);
    // 17:00Z = 22:30 IST asleep, 12:00 Chicago awake
    expect(awakeNow(members, "arjun", new Date("2026-10-31T17:00:00Z")).map((a) => a.id)).toEqual(["anika"]);
    // 21:00Z = 02:30 IST, 16:00 Chicago
    expect(awakeNow(members, "dadi", new Date("2026-10-31T21:00:00Z")).map((a) => a.id)).toEqual(["anika"]);
  });
  it("edges: 7:00 in, 22:00 out; empty when everyone sleeps", () => {
    const solo = [m("a", "Asia/Kolkata"), m("b", "Asia/Kolkata")];
    expect(awakeNow(solo, "a", new Date("2026-10-31T01:30:00Z"))).toHaveLength(1); // 07:00 IST
    expect(awakeNow(solo, "a", new Date("2026-10-31T01:29:00Z"))).toHaveLength(0);
    expect(awakeNow(solo, "a", new Date("2026-10-31T16:29:00Z"))).toHaveLength(1); // 21:59
    expect(awakeNow(solo, "a", new Date("2026-10-31T16:30:00Z"))).toHaveLength(0); // 22:00
  });
  it("counts one person once across sides and skips pending invites", () => {
    const two = [m("a", "Asia/Kolkata"), m("b1", "Asia/Kolkata", "", "adult", { personId: "p" }), m("b2", "Asia/Kolkata", "", "adult", { personId: "p" }), m("c", "Asia/Kolkata", "", "adult", { status: "pending" })];
    expect(awakeNow(two, "a", new Date("2026-10-31T06:00:00Z")).map((x) => x.id)).toEqual(["b1"]);
  });
  it("names the distinct cities", () => {
    expect(awakeCities([{ id: "a", city: "Bengaluru" }, { id: "b", city: "Amritsar" }, { id: "c", city: "Amritsar" }])).toBe("Bengaluru · Amritsar");
    expect(awakeNow([m("a", "Asia/Kolkata"), m("b", "Asia/Kolkata")], "a", new Date("2026-10-31T06:00:00Z"))[0].city).toBe("India");
  });
});

describe("waitingForYou", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  const base: WaitingInput = { viewerId: "arjun", now, names: { dadi: "Maa", priya: "Priya", dada: "Papa" }, cards: [], plays: [], questions: [], today: [], needs: [] };
  const card = { id: "c1", type: "audio" as const, authorId: "dadi", addressedTo: "arjun", takenAt: "2026-10-31T08:00:00.000Z" };
  const question = { id: "q1", toMemberId: "arjun", askedBy: "priya", topic: "recipe" as const, answeredCardId: null, createdAt: "2026-10-31T09:00:00.000Z" };
  const today = { id: "t", date: "2026-10-31", parents: ["dadi", "dada"], children: ["arjun"], answers: [{ memberId: "dadi", cardId: "x", at: "2026-10-31T10:00:00.000Z" }], completedAt: null };
  const need = { id: "n1", title: "Book the cylinder", claimedBy: "arjun", status: "claimed" as const, doneAt: null, createdAt: "2026-10-31T07:00:00.000Z" };

  it("is null when nothing waits", () => expect(waitingForYou(base)).toBeNull());
  it("an unplayed voice note addressed to you, until you play it", () => {
    expect(waitingForYou({ ...base, cards: [card] })).toEqual({ kind: "voice", text: "Maa's voice note", href: "/lane", fromId: "dadi" });
    expect(waitingForYou({ ...base, cards: [card], plays: [{ cardId: "c1", memberId: "arjun" }] })).toBeNull();
    // someone else playing it does not clear it for you
    expect(waitingForYou({ ...base, cards: [card], plays: [{ cardId: "c1", memberId: "dada" }] })?.kind).toBe("voice");
    expect(waitingForYou({ ...base, cards: [{ ...card, addressedTo: "dada" }] })).toBeNull();
    expect(waitingForYou({ ...base, cards: [{ ...card, addressedTo: "dada,arjun" }] })?.kind).toBe("voice");
    expect(waitingForYou({ ...base, cards: [{ ...card, authorId: "arjun" }] })).toBeNull();
  });
  it("a question asked of you, with a place to answer it", () => {
    expect(waitingForYou({ ...base, questions: [question] })).toEqual({ kind: "question", text: "Priya asked you for a recipe", href: "/kitchen", fromId: "priya" });
    expect(waitingForYou({ ...base, questions: [{ ...question, answeredCardId: "a" }] })).toBeNull();
    expect(waitingForYou({ ...base, questions: [{ ...question, toMemberId: "dada" }] })).toBeNull();
    expect(waitingForYou({ ...base, questions: [{ ...question, askedBy: null }] })?.text).toBe("A question for you");
  });
  it("a sealed Today answer, only until you answer or it completes", () => {
    expect(waitingForYou({ ...base, today: [today] })).toEqual({ kind: "today", text: "Maa's answer is waiting for yours", href: "/", fromId: "dadi" });
    expect(waitingForYou({ ...base, today: [{ ...today, answers: [...today.answers, { memberId: "arjun", cardId: "y", at: "2026-10-31T11:00:00.000Z" }] }] })).toBeNull();
    expect(waitingForYou({ ...base, today: [{ ...today, completedAt: "2026-10-31T11:00:00.000Z" }] })).toBeNull();
    expect(waitingForYou({ ...base, today: [{ ...today, date: "2026-10-20" }] })).toBeNull();
  });
  it("a care need you took on, not one that is done or someone else's", () => {
    expect(waitingForYou({ ...base, needs: [need] })).toEqual({ kind: "care", text: "Book the cylinder", href: "/care" });
    expect(waitingForYou({ ...base, needs: [{ ...need, status: "done" as const }] })).toBeNull();
    expect(waitingForYou({ ...base, needs: [{ ...need, claimedBy: "priya" }] })).toBeNull();
  });
  it("a care need nobody closed in a month stops nagging from the tile", () => {
    expect(waitingForYou({ ...base, needs: [{ ...need, createdAt: "2026-10-02T00:00:00.000Z" }] })?.kind).toBe("care");
    expect(waitingForYou({ ...base, needs: [{ ...need, createdAt: "2026-09-29T00:00:00.000Z" }] })).toBeNull();
  });
  it("newest wins; at the same moment people come before chores", () => {
    expect(waitingForYou({ ...base, cards: [card], questions: [question], today: [today], needs: [need] })?.kind).toBe("today");
    expect(waitingForYou({ ...base, cards: [card], questions: [question], needs: [need] })?.kind).toBe("question");
    expect(waitingForYou({ ...base, cards: [card], needs: [need] })?.kind).toBe("voice");
    const same = "2026-10-31T09:00:00.000Z";
    expect(waitingForYou({ ...base, cards: [{ ...card, takenAt: same }], questions: [{ ...question, createdAt: same }], needs: [{ ...need, createdAt: same }] })?.kind).toBe("voice");
    expect(waitingForYou({ ...base, questions: [{ ...question, createdAt: same }], needs: [{ ...need, createdAt: same }] })?.kind).toBe("question");
  });
  it("answering the sender clears a voice note (a card of yours to them, or to everyone, sent after theirs)", () => {
    const reply = { id: "r1", type: "audio" as const, authorId: "arjun", addressedTo: "dadi", takenAt: "2026-10-31T09:00:00.000Z" };
    expect(waitingForYou({ ...base, cards: [card, reply] })).toBeNull();
    expect(waitingForYou({ ...base, cards: [card, { ...reply, addressedTo: null }] })).toBeNull();
    // to someone else, or older than theirs: still waiting
    expect(waitingForYou({ ...base, cards: [card, { ...reply, addressedTo: "dada" }] })?.kind).toBe("voice");
    expect(waitingForYou({ ...base, cards: [card, { ...reply, takenAt: "2026-10-31T07:00:00.000Z" }] })?.kind).toBe("voice");
  });
  it("a nudge waits as a nudge, with its id so opening it can mark it seen", () => {
    const nudge = { id: "nudge-1", kind: "heard", text: "Maa heard your voice note", href: "/home?card=c9", at: "2026-10-31T11:00:00.000Z" };
    expect(waitingForYou({ ...base, nudges: [nudge] })).toEqual({ kind: "nudge", text: "Maa heard your voice note", href: "/home?card=c9", nudgeId: "nudge-1" });
    expect(waitingItems({ ...base, cards: [card], questions: [question], nudges: [nudge] }).map((i) => i.kind)).toEqual(["nudge", "question", "voice"]);
  });
  it("ignores the future and very old voice notes", () => {
    expect(waitingForYou({ ...base, cards: [{ ...card, takenAt: "2026-11-02T00:00:00.000Z" }] })).toBeNull();
    expect(waitingForYou({ ...base, cards: [{ ...card, takenAt: "2026-08-01T00:00:00.000Z" }] })).toBeNull();
  });
});

describe("weekly call in both zones", () => {
  const sun7 = { weekday: 0, hour: 19, minute: 0, tz: "Asia/Kolkata" };
  const now = new Date("2026-10-31T12:00:00Z"); // Saturday
  it("finds the next Sunday 7 PM IST", () => {
    expect(nextCallAt(sun7, now)?.toISOString()).toBe("2026-11-01T13:30:00.000Z");
    // just after it started: next week
    expect(nextCallAt(sun7, new Date("2026-11-01T13:31:00Z"))?.toISOString()).toBe("2026-11-08T13:30:00.000Z");
  });
  it("shows yours and theirs", () => {
    // Chicago went back to CST (UTC-6) that morning: 13:30Z is 7:30 AM there
    expect(callBothZones(sun7, "Asia/Kolkata", "America/Chicago", now)).toBe("Sun 7 PM yours · 7:30 AM theirs");
  });
  it("collapses one shared clock", () => {
    expect(callBothZones(sun7, "Asia/Kolkata", "Asia/Kolkata", now)).toBe("Sun 7 PM · yours and theirs");
  });
  it("names the weekday of the other home when the days differ", () => {
    const sun9pm = { weekday: 0, hour: 21, minute: 0, tz: "America/Chicago" };
    // Sun 21:00 CST = Mon 08:30 IST
    expect(callBothZones(sun9pm, "America/Chicago", "Asia/Kolkata", now)).toBe("Sun 9 PM yours · Mon 8:30 AM theirs");
    expect(callBothZones(sun9pm, "Asia/Kolkata", "America/Chicago", now)).toBe("Mon 8:30 AM yours · Sun 9 PM theirs");
  });
  it("is the same wall-clock time either side of a daylight-saving change", () => {
    const chi = { weekday: 0, hour: 9, minute: 0, tz: "America/Chicago" };
    expect(nextCallAt(chi, new Date("2026-10-31T12:00:00Z"))?.toISOString()).toBe("2026-11-01T15:00:00.000Z"); // CST
    expect(nextCallAt(chi, new Date("2026-10-24T12:00:00Z"))?.toISOString()).toBe("2026-10-25T14:00:00.000Z"); // CDT
  });
  it("tile: unset nudges to set one; a bad zone does too", () => {
    expect(callTile(undefined, "Asia/Kolkata", null, now)).toEqual({ text: "Set a weekly call", href: "/gather", set: false });
    expect(callTile({ id: "weekly-call", ...sun7, tz: "Not/AZone", hostId: "dadi" }, "Asia/Kolkata", null, now).set).toBe(false);
    expect(callTile({ id: "weekly-call", ...sun7, hostId: "dadi" }, "Asia/Kolkata", "America/Chicago", now)).toEqual({ text: "Sun 7 PM yours · 7:30 AM theirs", href: "/gather", set: true });
  });
});

describe("nextUp", () => {
  const base = { today: "2026-10-31", now: new Date("2026-10-31T12:00:00Z"), tz: "Asia/Kolkata", viewerId: "arjun", names: { leo: "Vihaan" }, events: [], occasions: [] };
  const diwali = { slug: "diwali", kind: "festival" as const, date: "2026-11-08", title: "Diwali — festival of lights", memberId: null };
  const bday = { slug: "birthday", kind: "birthday" as const, date: "2026-11-09", title: "", memberId: "leo" };
  const ev = { id: "e1", title: "Vihaan's birthday", date: "2026-11-09", status: "voting" as const, occasionKey: "birthday", forMemberId: "leo", startsAt: null };

  it("nothing coming: null", () => expect(nextUp(base)).toBeNull());
  it("a festival reads as a date, a birthday as days away", () => {
    expect(nextUp({ ...base, occasions: [bday, diwali] })?.text).toBe("Diwali · Sun 8 Nov");
    expect(nextUp({ ...base, occasions: [bday] })?.text).toBe("Vihaan's birthday · in 9 days");
    expect(nextUp({ ...base, occasions: [{ ...bday, memberId: "arjun" }] })?.text).toBe("Your birthday · in 9 days");
    expect(nextUp({ ...base, occasions: [{ ...bday, date: "2026-11-01" }] })?.text).toBe("Vihaan's birthday · tomorrow");
    expect(nextUp({ ...base, occasions: [diwali] })?.href).toBe("/gather");
  });
  it("a planned event stands in for its occasion, and a locked one shows its time", () => {
    expect(nextUp({ ...base, occasions: [bday], events: [ev] })?.text).toBe("Vihaan's birthday · in 9 days");
    expect(nextUp({ ...base, events: [{ ...ev, status: "locked", startsAt: "2026-11-09T13:30:00.000Z" }] })?.text).toBe("Vihaan's birthday · Mon 9 Nov, 7 PM");
  });
  it("earliest day wins; a cancelled or past event never shows", () => {
    expect(nextUp({ ...base, occasions: [diwali], events: [ev] })?.text).toBe("Diwali · Sun 8 Nov");
    expect(nextUp({ ...base, occasions: [diwali], events: [{ ...ev, date: "2026-11-02" }] })?.text).toBe("Vihaan's birthday · in 2 days");
    expect(nextUp({ ...base, events: [{ ...ev, status: "cancelled" }] })).toBeNull();
    expect(nextUp({ ...base, events: [{ ...ev, date: "2026-10-30" }] })).toBeNull();
  });
  it("on the same day a timed event beats an untimed one", () => {
    const timed = { ...ev, id: "e2", title: "Family call", status: "locked" as const, startsAt: "2026-11-09T14:30:00.000Z" };
    expect(nextUp({ ...base, events: [ev, timed] })?.text).toBe("Family call · Mon 9 Nov, 8 PM");
  });
});
