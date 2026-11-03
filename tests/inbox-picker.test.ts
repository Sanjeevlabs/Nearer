import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { POST as postCard } from "@/app/api/cards/route";
import { GET as inboxGET } from "@/app/api/inbox/route";
import { HouseGlyph, ReactionGlyph } from "@/components/ui/glyphs";
import { ADDRESSED_TO_MAX } from "@/lib/card-limits";
import { DEMO_MEMBERS } from "@/lib/family";
import { addressTo, addressees, households } from "@/lib/households";
import { buildInbox, INBOX_MAX, InboxResponseSchema, type InboxInput } from "@/lib/inbox";
import { pickerView } from "@/lib/picker-rows";
import { CardSchema, MemberSchema, type Member, type Relationship } from "@/lib/schemas";
import { listCards, listRelationships, resetDemo } from "@/lib/store";
import { authedGet, authedJson } from "./auth-helper";

const m = (id: string, role: Member["role"], tz: string, extra: Partial<Member> = {}): Member => MemberSchema.parse({ id, familyId: "f", firstName: id, displayName: id, role, tz, ...extra });
const rel = (memberId: string, relationMemberId: string, canonicalKind: Relationship["canonicalKind"]): Relationship => ({ id: `${memberId}-${relationMemberId}`, familyId: "f", memberId, relationMemberId, relation: canonicalKind, canonicalKind });

describe("one recipient picker: order and search", () => {
  const me = m("me", "adult", "America/New_York");
  const maa = m("Maa", "elder", "Asia/Kolkata");
  const papa = m("Papa", "elder", "Asia/Kolkata");
  const others = Array.from({ length: 9 }, (_, i) => m(`Cousin${i}`, "adult", "Europe/London"));
  const members = [me, maa, papa, ...others];
  const rels = [rel("me", "Maa", "parent"), rel("me", "Papa", "parent")];
  const view = (over: Partial<Parameters<typeof pickerView>[0]> = {}) => pickerView({ viewerId: "me", members, relationships: rels, ...over });

  it("Everyone, then homes, then at most two waiting people, then the rest trimmed to a first screen", () => {
    const v = view({ waitingIds: ["Cousin3", "Cousin5", "Cousin7"] });
    expect(v.top.map((r) => r.kind)).toEqual(["everyone", "home", "person", "person"]);
    expect(v.top[1].label).toBe("Maa & Papa");
    expect(v.top[1].sub).toBe("Only this home hears it");
    expect(v.top[0].sub).toBe("Everyone in the family hears it");
    expect(v.top.slice(2).map((r) => r.label)).toEqual(["Cousin3", "Cousin5"]);
    expect(v.top.length + v.rest.length).toBeLessThanOrEqual(6);
    expect(v.rest[0].sub).toBe(`Only ${v.rest[0].label} hears it`);
    expect(v.hidden).toBeGreaterThan(0);
    expect(v.searchable).toBe(true);
    // The two homes' people are not repeated as the waiting extras.
    expect(new Set([...v.top, ...v.rest].filter((r) => r.kind === "person").map((r) => r.label)).size).toBe([...v.top, ...v.rest].filter((r) => r.kind === "person").length);
  });

  it("search filters the rest and reaches everyone; 'Show everyone' reveals all", () => {
    expect(view({ query: "cousin8" }).rest.map((r) => r.label)).toEqual(["Cousin8"]);
    expect(view({ query: "nobody" }).rest).toEqual([]);
    const all = view({ expanded: true });
    expect(all.hidden).toBe(0);
    expect(all.top.filter((r) => r.kind === "person").length + all.rest.length).toBe(11);
  });

  it("a small family shows no search and nothing hidden; one other person gets no Everyone row", () => {
    const small = pickerView({ viewerId: "me", members: [me, maa, papa], relationships: rels });
    expect(small.searchable).toBe(false);
    expect(small.hidden).toBe(0);
    const one = pickerView({ viewerId: "me", members: [me, maa], relationships: [] });
    expect(one.top).toEqual([]);
    expect(one.rest.map((r) => r.label)).toEqual(["Maa"]);
  });
});

describe("addressedTo holds a whole family", () => {
  it("round-trips six ids through the API and back to the same people", async () => {
    resetDemo();
    const ids = ["dadi", "dada", "priya", "aria", "leo", "arjun"].map((x) => `${x}-0123456789abcdef`);
    expect(addressTo(ids)?.length).toBeGreaterThan(64);
    const res = await postCard(authedJson("http://t/api/cards", { type: "audio", caption: "to all of you", lang: "en", takenAt: new Date().toISOString(), addressedTo: addressTo(ids) }, "arjun"));
    expect(res.status).toBe(201);
    const { card } = (await res.json()) as { card: { id: string; addressedTo: string } };
    expect(addressees(listCards().find((c) => c.id === card.id) ?? { addressedTo: null })).toEqual(ids);
    const long = await postCard(authedJson("http://t/api/cards", { type: "audio", caption: "too many", lang: "en", takenAt: new Date().toISOString(), addressedTo: "x".repeat(ADDRESSED_TO_MAX + 1) }, "arjun"));
    expect(long.status).toBe(400);
  });
});

describe("the inbox", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  const iso = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  const card = (id: string, authorId: string, addressedTo: string | null, takenAt: string, type: "audio" | "photo" = "audio") => CardSchema.parse({ id, familyId: "f", type, caption: id, lang: "en", takenAt, authorId, addressedTo });
  const base: InboxInput = { viewerId: "arjun", now, names: { dadi: "Maa", priya: "Priya" }, cards: [], plays: [], reactions: [], wishes: [], questions: [], kidAsks: [], guardians: {}, beats: [], felt: null, nudges: [] };

  it("lists a voice memory addressed to me as waiting, then as earlier once played", () => {
    const cards = [card("v1", "dadi", "arjun", iso(2)), card("v2", "dadi", "priya", iso(2)), card("v3", "dadi", null, iso(1))];
    const [one] = buildInbox({ ...base, cards });
    expect(one).toMatchObject({ id: "card-v1", kind: "voice", text: "Maa sent you a voice memory", waiting: true, action: "play", replyTo: "dadi", href: "/lane?card=v1" });
    expect(buildInbox({ ...base, cards }).map((i) => i.id)).toEqual(["card-v1"]);
    expect(buildInbox({ ...base, cards, plays: [{ cardId: "v1", memberId: "arjun" }] })[0]).toMatchObject({ waiting: false, heard: true });
  });

  it("shows a blessing on my card, and not on someone else's", () => {
    const cards = [card("mine", "arjun", null, iso(30)), card("hers", "priya", null, iso(30))];
    const reactions = [
      { id: "r1", cardId: "mine", memberId: "dadi", kind: "bless" as const, createdAt: iso(3) },
      { id: "r2", cardId: "hers", memberId: "dadi", kind: "love" as const, createdAt: iso(3) },
      { id: "r3", cardId: "mine", memberId: "arjun", kind: "love" as const, createdAt: iso(3) },
    ];
    const items = buildInbox({ ...base, cards, reactions });
    expect(items.map((i) => i.text)).toEqual(["Maa sent a blessing on your voice memory"]);
    expect(items[0]).toMatchObject({ waiting: false, replyTo: "dadi" });
  });

  it("keeps heartbeats as plain earlier lines, drops anything older than 30 days, and is bounded", () => {
    const beats = [{ from: "dadi", at: iso(5) }, { from: "dadi", at: iso(24 * 40) }];
    const items = buildInbox({ ...base, beats, felt: iso(6) });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "lamp", waiting: false, plain: true });
    expect(buildInbox({ ...base, beats, felt: iso(1) })[0].waiting).toBe(false);
    const many = Array.from({ length: 200 }, (_, i) => card(`c${i}`, "dadi", "arjun", iso(1 + i / 100)));
    expect(buildInbox({ ...base, cards: many })).toHaveLength(INBOX_MAX);
  });

  it("asks: a question is waiting until a card answers it", () => {
    const q = { id: "q", toMemberId: "arjun", askedBy: "priya", topic: "recipe" as const, answeredCardId: null, createdAt: iso(4) };
    expect(buildInbox({ ...base, questions: [q] })[0]).toMatchObject({ kind: "question", waiting: true, action: "answer", text: "Priya asked you for a recipe" });
    expect(buildInbox({ ...base, questions: [{ ...q, answeredCardId: "x" }] })[0].waiting).toBe(false);
  });

  it("waiting holds only what needs me; receipts, lamps, reminders and occasions are earlier plain lines", () => {
    const cards = [card("v1", "dadi", "arjun", iso(2)), card("mine", "arjun", null, iso(30))];
    const q = { id: "q", toMemberId: "arjun", askedBy: "priya", topic: "recipe" as const, answeredCardId: null, createdAt: iso(4) };
    const kid = { id: "k", fromMemberId: "leo", toMemberId: "arjun", cardId: null, askedAt: iso(3), answeredCardId: null, topic: "question" as const };
    const today = [{ id: "t1", date: "2026-10-31", parents: ["dadi"], children: ["arjun"], answers: [{ memberId: "dadi", cardId: "c", at: iso(1) }], completedAt: null }];
    const reactions = [{ id: "r1", cardId: "mine", memberId: "dadi", kind: "bless" as const, createdAt: iso(3) }];
    const wishes = [{ id: "w1", cardId: "mine", memberId: "priya", kind: "wish" as const, createdAt: iso(3) }];
    const beats = [{ from: "dadi", at: iso(5) }];
    const nudges = [
      { id: "n1", kind: "heard", text: "Priya heard your voice memory", href: "/", at: iso(6), seen: false, from: "priya" },
      { id: "n2", kind: "occasion", text: "Diwali is coming", href: "/", at: iso(7), seen: false },
    ];
    const items = buildInbox({ ...base, cards, questions: [q], kidAsks: [kid], today, reactions, wishes, beats, nudges });
    const waiting = items.filter((i) => i.waiting).map((i) => i.kind).sort();
    expect(waiting).toEqual(["kid", "question", "today", "voice"]);
    const earlier = items.filter((i) => !i.waiting);
    expect(earlier.map((i) => i.kind).sort()).toEqual(["lamp", "nudge", "nudge", "reaction", "wish"]);
    expect(earlier.every((i) => i.plain)).toBe(true);
    expect(items.slice(0, 4).every((i) => i.waiting)).toBe(true);
    expect(items.find((i) => i.id === "nudge-n2")).toMatchObject({ badge: "occasion", replyTo: null });
    expect(items.find((i) => i.kind === "reaction")?.badge).toBe("blessing");
    expect(items.find((i) => i.kind === "lamp")?.badge).toBe("lamp");
    // Answering the Today task, or a Today already finished, takes it off the waiting list.
    expect(buildInbox({ ...base, today: [{ ...today[0], answers: [...today[0].answers, { memberId: "arjun", cardId: "d", at: iso(0.5) }] }] })).toEqual([]);
    expect(buildInbox({ ...base, today: [{ ...today[0], completedAt: iso(0.5) }] })).toEqual([]);
  });

  it("reply by voice is addressed to the sender, never to me", () => {
    const cards = [card("v1", "dadi", "arjun", iso(2))];
    const q = { id: "q", toMemberId: "arjun", askedBy: "priya", topic: "recipe" as const, answeredCardId: null, createdAt: iso(4) };
    const kid = { id: "k", fromMemberId: "leo", toMemberId: "arjun", cardId: null, askedAt: iso(3), answeredCardId: null, topic: "question" as const };
    const reactions = [{ id: "r1", cardId: "mine", memberId: "dadi", kind: "love" as const, createdAt: iso(3) }];
    const items = buildInbox({ ...base, cards: [...cards, card("mine", "arjun", null, iso(30))], questions: [q], kidAsks: [kid], reactions, beats: [{ from: "priya", at: iso(5) }] });
    expect(items.length).toBe(5);
    for (const i of items) expect(i.replyTo).toBe(i.fromId);
    expect(items.every((i) => i.replyTo !== "arjun" && i.replyTo !== null)).toBe(true);
    expect(items.find((i) => i.kind === "voice")?.replyTo).toBe("dadi");
    expect(items.find((i) => i.kind === "kid")?.replyTo).toBe("leo");
  });

  it("demo seed: Arjun's inbox shows a voice memory, a question, a blessing and a lamp", async () => {
    resetDemo();
    const res = await inboxGET(authedGet("http://t/api/inbox", "arjun"));
    const { items } = InboxResponseSchema.parse(await res.json());
    const waiting = items.filter((i) => i.waiting);
    expect(waiting.some((i) => i.kind === "voice" && i.fromId === "dadi" && i.action === "play")).toBe(true);
    expect(waiting.some((i) => i.kind === "kid" && i.fromId === "leo")).toBe(true);
    expect(items.some((i) => i.badge === "blessing" && i.fromId === "dadi" && !i.waiting)).toBe(true);
    expect(items.some((i) => i.kind === "lamp" && i.fromId === "dadi" && !i.waiting)).toBe(true);
    expect(items.filter((i) => i.plain).every((i) => !i.waiting)).toBe(true);
  });

  it("the seeded lamp is for Arjun's home", () => {
    const ms = [...DEMO_MEMBERS].map((x) => MemberSchema.parse(x));
    const home = households(ms, listRelationships()).find((h) => h.members.some((x) => x.id === "arjun"));
    expect(home?.id).toBe("home-arjun-priya");
  });

  it("API: family-scoped and valid; another family's member sees nothing of it", async () => {
    resetDemo();
    const res = await inboxGET(authedGet("http://t/api/inbox", "arjun"));
    expect(res.status).toBe(200);
    const parsed = InboxResponseSchema.parse(await res.json());
    expect(parsed.items.length).toBeLessThanOrEqual(INBOX_MAX);
    expect(parsed.items.every((i) => i.fromId !== "arjun")).toBe(true);
    const other = await inboxGET(authedGet("http://t/api/inbox", "arjun").clone());
    expect(other.status).toBe(200);
    expect((await inboxGET(new Request("http://t/api/inbox"))).status).toBe(401);
  });
});

describe("reaction glyphs", () => {
  it("draw an svg for each kind, with a name when labelled, and the fuller tint when selected", () => {
    for (const [kind, name] of [["love", "Love"], ["bless", "Blessing"], ["laugh", "Smile"]] as const) {
      const html = renderToStaticMarkup(createElement(ReactionGlyph, { kind, label: true }));
      expect(html).toContain("<svg");
      expect(html).toContain(`aria-label="${name}"`);
      expect(renderToStaticMarkup(createElement(ReactionGlyph, { kind, selected: true }))).toContain("fill-opacity=\"0.7\"");
      expect(renderToStaticMarkup(createElement(ReactionGlyph, { kind }))).toContain("aria-hidden");
    }
    expect(renderToStaticMarkup(createElement(HouseGlyph))).toContain("<svg");
  });
});
