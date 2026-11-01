import { beforeEach, describe, expect, it } from "vitest";
import { GET as cardsGet } from "@/app/api/cards/route";
import { GET as todayGet, POST as todayPost } from "@/app/api/today/route";
import { GET as windowGet, POST as windowPost } from "@/app/api/window/route";
import { GET as weatherGet } from "@/app/api/weather/route";
import { dbListMembers, dbListRelationships } from "@/lib/db";
import type { Card } from "@/lib/schemas";
import { resetDemo } from "@/lib/store";
import { streak, type TodayPrompt } from "@/lib/today";
import { treeLayout } from "@/lib/tree";
import { groundedLayers } from "@/lib/window";
import { phaseFor, skyFromWmo } from "@/lib/weather";
import { sessionCookie } from "./auth-helper";

const req = (url: string, member: string, body?: unknown) =>
  new Request(`http://test${url}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", cookie: sessionCookie(member) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;

beforeEach(() => {
  process.env.MOCK = "true";
  resetDemo();
});

describe("the window (LITE)", () => {
  it("opens onto the parents' home for the son, and onto the son's home for the parents", async () => {
    const son = await json<{ far: { ids: string[]; city: string }; weather: { city: string } | null }>(windowGet(req("/api/window", "arjun")));
    expect(son.far.ids.sort()).toEqual(["dada", "dadi"]);
    expect(son.far.city).toBe("Amritsar");
    expect(son.weather?.city).toBe("Amritsar");
    const maa = await json<{ far: { ids: string[]; city: string } }>(windowGet(req("/api/window", "dadi")));
    expect(maa.far.ids).toContain("arjun");
    expect(maa.far.city).toBe("Bengaluru");
  });

  it("only shows motion that is true there: rain only when it rains, stars only at night", () => {
    const rain = { city: "x", tempC: 20, kind: "rain" as const, label: "Rain", source: "mock" as const, at: "" };
    expect(groundedLayers(rain, "night", ["chai"])).toEqual(expect.arrayContaining(["rain", "steam", "lamp"]));
    expect(groundedLayers(rain, "night", [])).not.toContain("stars");
    expect(groundedLayers(null, "day", [])).toEqual(["breeze"]);
    expect(phaseFor(6)).toBe("dawn");
    expect(skyFromWmo(95).kind).toBe("storm");
  });

  it("lets you choose only your own family's photos", async () => {
    expect((await windowPost(req("/api/window", "arjun", { action: "choose", cardId: "nope", style: "living" }))).status).toBe(404);
    const chosen = await json<{ view: { imageRef: string } }>(windowPost(req("/api/window", "arjun", { action: "choose", cardId: "demo-court-dadi", style: "living" })));
    expect(chosen.view.imageRef).toBe("/demo/family-dadi.webp");
  });

  it("looks up weather only for cities this family lives in", async () => {
    expect((await weatherGet(req("/api/weather?memberId=stranger", "arjun"))).status).toBe(404);
    const w = await json<{ weather: { city: string } }>(weatherGet(req("/api/weather?memberId=dadi", "arjun")));
    expect(w.weather.city).toBe("Amritsar");
  });
});

describe("today, for both homes", () => {
  it("seals Maa's answer until Arjun answers, then completes and lights a lamp", async () => {
    const before = await json<{ task: { id: string; side: string; sealed: number; mine: boolean }; streak: number }>(todayGet(req("/api/today", "arjun")));
    expect(before.task).toMatchObject({ side: "children", sealed: 1, mine: false });
    expect(before.streak).toBe(4);
    const hidden = await json<{ cards: Card[] }>(cardsGet(req("/api/cards", "arjun")));
    expect(hidden.cards.some((c) => c.id === "demo-today-maa")).toBe(false);
    // Someone else's card can't be your answer.
    expect((await todayPost(req("/api/today", "arjun", { action: "answer", taskId: before.task.id, cardId: "demo-today-maa" }))).status).toBe(403);
    const done = await json<{ completed: boolean; task: { sealed: number; answers: unknown[] } }>(todayPost(req("/api/today", "arjun", { action: "answer", taskId: before.task.id, cardId: "demo-voice-1" })));
    expect(done.completed).toBe(true);
    expect(done.task.sealed).toBe(0);
    expect(done.task.answers).toHaveLength(2);
    const after = await json<{ cards: Card[] }>(cardsGet(req("/api/cards", "arjun")));
    expect(after.cards.some((c) => c.id === "demo-today-maa")).toBe(true);
    expect((await json<{ streak: number }>(todayGet(req("/api/today", "arjun")))).streak).toBe(5);
  });

  it("isn't a task for the grandchildren or in-laws' parents", async () => {
    const kid = await json<{ task: { side: string | null } }>(todayGet(req("/api/today", "leo")));
    expect(kid.task.side).toBeNull();
    expect((await todayPost(req("/api/today", "leo", { action: "answer", taskId: "x", cardId: "y" }))).status).toBe(404);
  });

  it("streaks count back from the last finished day", () => {
    const t = (date: string, done: boolean) => ({ id: date, date, promptId: "p", forParents: "", forChildren: "", parents: [], children: [], answers: [], completedAt: done ? "2026-01-01T00:00:00.000Z" : null, madeBy: "muse" as const, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(streak([t("2026-10-29", true), t("2026-10-28", true), t("2026-10-26", true)], "2026-10-30")).toBe(2);
    expect(streak([t("2026-10-30", true), t("2026-10-29", true)], "2026-10-30")).toBe(2);
    void ({} as TodayPrompt);
  });
});

describe("the node tree", () => {
  it("puts generations in rows, couples together, children under their parents", async () => {
    const t = treeLayout(await dbListMembers("demo-family"), await dbListRelationships("demo-family"), "arjun");
    const at = (id: string) => t.nodes.find((n) => n.id === id)!;
    expect(at("dadi").y).toBeLessThan(at("arjun").y);
    expect(at("arjun").y).toBe(at("kavya").y);
    expect(at("arjun").y).toBeLessThan(at("leo").y);
    expect(Math.abs(at("arjun").x - at("priya").x)).toBeLessThanOrEqual(92);
    expect(t.couples.some((c) => [c.a, c.b].sort().join() === "arjun,priya")).toBe(true);
    expect(t.loose).toEqual([]);
    // No two people on one spot.
    const spots = new Set(t.nodes.map((n) => `${n.x}:${n.y}`));
    expect(spots.size).toBe(t.nodes.length);
  });
});

describe("trusted nearby, both homes", () => {
  it("lets you keep your own list, and needs their consent to list them for emergencies", async () => {
    const { POST: carePost, GET: careGet } = await import("@/app/api/care/route");
    const add = (body: Record<string, unknown>, who = "priya") => carePost(req("/api/care", who, { action: "helper", name: "Asha", role: "friend", phone: "+91 90000 00099", ...body }));
    expect((await add({ forMemberId: "priya", emergency: true, consent: false })).status).toBe(400);
    expect((await add({ forMemberId: "priya", emergency: true, consent: true })).status).toBe(201);
    // A child can't add to someone else's circle.
    expect((await add({ forMemberId: "kavya", emergency: true, consent: true }, "aria")).status).toBe(403);
    const { helpers } = await json<{ helpers: { forMemberId: string; emergency: boolean }[] }>(careGet(req("/api/care", "dadi")));
    expect(helpers.filter((h) => h.forMemberId === "arjun" && h.emergency).length).toBe(3);
  });
});

describe("safe & sound at a glance", () => {
  it("green when active, amber after 6 quiet hours in their day, asleep at their night", async () => {
    const { aliveState } = await import("@/lib/status");
    const noonIST = new Date("2026-10-30T06:30:00.000Z"); // 12:00 in Kolkata
    const nightIST = new Date("2026-10-30T20:30:00.000Z"); // 02:00 in Kolkata
    const tz = "Asia/Kolkata";
    expect(aliveState(new Date(noonIST.getTime() - 2 * 3_600_000).toISOString(), tz, { shares: true, now: noonIST })).toBe("active");
    expect(aliveState(new Date(noonIST.getTime() - 7 * 3_600_000).toISOString(), tz, { shares: true, now: noonIST })).toBe("quiet");
    expect(aliveState(new Date(nightIST.getTime() - 9 * 3_600_000).toISOString(), tz, { shares: true, now: nightIST })).toBe("asleep");
    expect(aliveState(null, tz, { shares: false, now: noonIST })).toBe("private");
  });

  it("the window carries a status for each grown-up on the other side", async () => {
    const son = await json<{ people: { id: string; state: string }[] }>(windowGet(req("/api/window", "arjun")));
    expect(son.people.map((p) => p.id).sort()).toEqual(["dada", "dadi"]);
    expect(son.people.every((p) => ["active", "quiet", "asleep", "unknown", "private"].includes(p.state))).toBe(true);
  });
});
