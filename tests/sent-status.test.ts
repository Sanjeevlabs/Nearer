// "Sent": a note to someone who has not joined yet is kept and shown as waiting, not lost; it
// reads "Delivered" / "Heard" once they are in, and it is theirs when they claim their place.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as postCard } from "@/app/api/cards/route";
import { GET as inboxGET } from "@/app/api/inbox/route";
import { GET as sentGET } from "@/app/api/inbox/sent/route";
import { buildSent, notJoined, SentResponseSchema } from "@/lib/sent";
import { CardSchema, MemberSchema, type Member } from "@/lib/schemas";
import { addPlay, mockAddMember, resetDemo, updateMemberProfile } from "@/lib/store";
import { authedGet, authedJson } from "./auth-helper";

const m = (id: string, extra: Partial<Member> = {}): Member => MemberSchema.parse({ id, familyId: "f", firstName: id, displayName: id, role: "adult", tz: "Asia/Kolkata", access: "member", ...extra });
const now = new Date("2026-11-03T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const card = (id: string, authorId: string, addressedTo: string | null, takenAt: string, type: "audio" | "photo" = "audio") => CardSchema.parse({ id, familyId: "f", type, caption: `note ${id}`, lang: "en", takenAt, authorId, addressedTo });

describe("sent status lines", () => {
  const me = m("me", { access: "owner", email: "me@example.com" });
  const maa = m("maa", { displayName: "Maa" });
  const paa = m("paa", { displayName: "Paa", email: "paa@example.com" });
  const base = { viewerId: "me", now, members: [me, maa, paa], plays: [] };

  it("a note to a place nobody has claimed waits, in words", () => {
    const [s] = buildSent({ ...base, cards: [card("c1", "me", "maa", hoursAgo(1))] });
    expect(s.status).toBe("waiting");
    expect(s.line).toBe("Waiting for Maa to join. They'll get it when they do");
    expect(s.to).toEqual(["Maa"]);
  });

  it("a note to someone who has joined is delivered, then heard once they play it", () => {
    const sent = [card("c2", "me", "paa", hoursAgo(2))];
    expect(buildSent({ ...base, cards: sent })[0]).toMatchObject({ status: "delivered", line: "Delivered to Paa" });
    expect(buildSent({ ...base, cards: sent, plays: [{ cardId: "c2", memberId: "paa" }] })[0]).toMatchObject({ status: "heard", line: "Heard by Paa" });
  });

  it("a photo can be delivered but never 'heard'", () => {
    const s = buildSent({ ...base, cards: [card("p1", "me", "paa", hoursAgo(1), "photo")], plays: [{ cardId: "p1", memberId: "paa" }] })[0];
    expect(s.status).toBe("delivered");
  });

  it("to Maa and Paa together: both states in one line, waiting wins", () => {
    const [s] = buildSent({ ...base, cards: [card("c3", "me", "maa,paa", hoursAgo(1))], plays: [{ cardId: "c3", memberId: "paa" }] });
    expect(s.status).toBe("waiting");
    expect(s.line).toBe("Heard by Paa · Waiting for Maa to join. They'll get it when they do");
  });

  it("someone with no email who has been active has joined (the demo family has no emails)", () => {
    const active = card("a1", "maa", null, hoursAgo(5));
    const [s] = buildSent({ ...base, cards: [active, card("c4", "me", "maa", hoursAgo(1))] });
    expect(s.status).toBe("delivered");
    expect(notJoined(maa, new Set())).toBe("unclaimed");
    expect(notJoined(maa, new Set(["maa"]))).toBeNull();
    expect(notJoined(m("kid", { role: "child", access: "child" }), new Set())).toBeNull();
  });

  it("a place still waiting to be let in is called that", () => {
    const [s] = buildSent({ ...base, members: [me, m("cousin", { status: "pending", email: "c@example.com" })], cards: [card("c5", "me", "cousin", hoursAgo(1))] });
    expect(s).toMatchObject({ status: "waiting", line: "Waiting for cousin to be let in" });
  });

  it("a morning letter not yet open reads as arriving, not delivered", () => {
    const [s] = buildSent({ ...base, cards: [card("l1", "me", "paa", hoursAgo(1))], deliverAt: { l1: new Date(now.getTime() + 3_600_000).toISOString() } });
    expect(s).toMatchObject({ status: "scheduled", line: "Arrives in the morning for Paa" });
  });

  it("lists only my own notes to particular people, newest first, within 30 days", () => {
    const cards = [
      card("old", "me", "paa", hoursAgo(24 * 31)),
      card("mine1", "me", "paa", hoursAgo(5)),
      card("mine2", "me", "paa", hoursAgo(2)),
      card("everyone", "me", null, hoursAgo(1)),
      card("theirs", "paa", "me", hoursAgo(1)),
      card("self", "me", "me", hoursAgo(1)),
    ];
    expect(buildSent({ ...base, cards }).map((s) => s.cardId)).toEqual(["mine2", "mine1"]);
  });
});

describe("sent API and the claim path (mock mode)", () => {
  beforeEach(() => resetDemo());

  it("a voice note to an unjoined Maa shows under Sent as waiting, and is hers after she claims her place", async () => {
    mockAddMember({ id: "maa-placeholder", familyId: "demo-family", firstName: "Maa", displayName: "Maa", role: "elder", tz: "Asia/Kolkata", access: "member" });
    const res = await postCard(authedJson("http://t/api/cards", { type: "audio", caption: "Namaste Maa", lang: "en", takenAt: new Date().toISOString(), addressedTo: "maa-placeholder" }, "arjun"));
    expect(res.status).toBe(201);
    const { card: sent } = (await res.json()) as { card: { id: string } };

    const before = SentResponseSchema.parse(await (await sentGET(authedGet("http://t/api/inbox/sent", "arjun"))).json());
    const item = before.items.find((i) => i.cardId === sent.id);
    expect(item).toMatchObject({ status: "waiting", line: "Waiting for Maa to join. They'll get it when they do" });

    // Claiming reuses the same member row (app/api/auth/verify): the card still points at her.
    updateMemberProfile("maa-placeholder", { email: "maa@example.com" });
    const inbox = (await (await inboxGET(authedGet("http://t/api/inbox", "maa-placeholder"))).json()) as { items: { cardId: string | null; waiting: boolean; text: string }[] };
    expect(inbox.items.find((i) => i.cardId === sent.id)).toMatchObject({ waiting: true, text: "Arjun sent you a voice memory" });

    const after = SentResponseSchema.parse(await (await sentGET(authedGet("http://t/api/inbox/sent", "arjun"))).json());
    expect(after.items.find((i) => i.cardId === sent.id)?.line).toBe("Delivered to Maa");
    addPlay({ id: "play-1", familyId: "demo-family", cardId: sent.id, memberId: "maa-placeholder", playedAt: new Date().toISOString() });
    const heard = SentResponseSchema.parse(await (await sentGET(authedGet("http://t/api/inbox/sent", "arjun"))).json());
    expect(heard.items.find((i) => i.cardId === sent.id)?.status).toBe("heard");
  });

  it("needs a session, and shows only the signed-in member's own sends", async () => {
    expect((await sentGET(new Request("http://t/api/inbox/sent"))).status).toBe(401);
    await postCard(authedJson("http://t/api/cards", { type: "audio", caption: "hi", lang: "en", takenAt: new Date().toISOString(), addressedTo: "arjun" }, "dadi"));
    const mine = SentResponseSchema.parse(await (await sentGET(authedGet("http://t/api/inbox/sent", "arjun"))).json());
    expect(mine.items.some((i) => i.toIds.includes("arjun"))).toBe(false);
  });
});
