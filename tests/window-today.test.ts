import { readFileSync } from "fs";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as cardsGet } from "@/app/api/cards/route";
import { GET as todayGet, POST as todayPost } from "@/app/api/today/route";
import { GET as windowGet, POST as windowPost } from "@/app/api/window/route";
import { GET as weatherGet } from "@/app/api/weather/route";
import { dbListMembers, dbListRelationships } from "@/lib/db";
import type { Card } from "@/lib/schemas";
import { resetDemo } from "@/lib/store";
import { type TodayPrompt } from "@/lib/today";
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
  it("shows Maa's answer to Arjun before he answers (nothing sealed, no streak), then completes", async () => {
    const before = await json<{ task: { id: string; side: string; mine: boolean; theirs: boolean; answers: { cardId: string }[] }; streak?: number }>(todayGet(req("/api/today", "arjun")));
    expect(before.task).toMatchObject({ side: "children", mine: false, theirs: true });
    expect(before.task).not.toHaveProperty("sealed");
    expect(before.task.answers.map((a) => a.cardId)).toContain("demo-today-maa");
    expect(before).not.toHaveProperty("streak");
    const open = await json<{ cards: Card[] }>(cardsGet(req("/api/cards", "arjun")));
    expect(open.cards.some((c) => c.id === "demo-today-maa")).toBe(true);
    // Someone else's card can't be your answer.
    expect((await todayPost(req("/api/today", "arjun", { action: "answer", taskId: before.task.id, cardId: "demo-today-maa" }))).status).toBe(403);
    const done = await json<{ completed: boolean; task: { answers: unknown[] } }>(todayPost(req("/api/today", "arjun", { action: "answer", taskId: before.task.id, cardId: "demo-voice-1" })));
    expect(done.completed).toBe(true);
    expect(done.task.answers).toHaveLength(2);
  });

  it("isn't a task for the grandchildren or in-laws' parents", async () => {
    const kid = await json<{ task: { side: string | null } }>(todayGet(req("/api/today", "leo")));
    expect(kid.task.side).toBeNull();
    expect((await todayPost(req("/api/today", "leo", { action: "answer", taskId: "x", cardId: "y" }))).status).toBe(404);
  });

  it("the Today card asks without a seal: 'Add yours', no 'to hear it', no sealed count", () => {
    const src = readFileSync("components/today.tsx", "utf8");
    expect(src).toContain("Add yours");
    expect(src).not.toMatch(/to hear it|sealed|streak/);
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
  it("the window carries their day for each grown-up on the other side: shared moments, never an inferred state", async () => {
    const son = await json<{ people: Record<string, unknown>[] }>(windowGet(req("/api/window", "arjun")));
    expect(son.people.map((p) => p.id).sort()).toEqual(["dada", "dadi"]);
    for (const p of son.people) {
      expect(Object.keys(p).sort()).toEqual(["checkins", "id", "moments"]);
      expect((p.moments as { label: string }[]).every((m) => m.label !== "here")).toBe(true);
    }
  });
});
