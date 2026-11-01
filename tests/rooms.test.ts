import { beforeEach, describe, expect, it } from "vitest";
import { GET as careGet, POST as carePost } from "@/app/api/care/route";
import { GET as recipeGet } from "@/app/api/kitchen/[id]/route";
import { GET as kitchenGet, POST as kitchenPost } from "@/app/api/kitchen/route";
import { GET as keeperGet, POST as keeperPost } from "@/app/api/keeper/route";
import { GET as presenceGet, POST as presencePost, PUT as presencePut } from "@/app/api/presence/route";
import { GET as sitGet, POST as sitPost } from "@/app/api/sit/route";
import { GET as traceGet } from "@/app/api/trace/route";
import { dbAddCard } from "@/lib/db";
import { listDocs, putDoc, resetDocs, seedDoc } from "@/lib/family-docs";
import { groundedIn, mockRecipe } from "@/lib/kitchen";
import { mockNeed } from "@/lib/care";
import { weekOf } from "@/lib/keeper";
import { awakeWindows, icsFor, roomUrl, suggestTimes } from "@/lib/overlap";
import { quietDay, usualFirstHour, whoseWeek } from "@/lib/presence";
import { resetDemo } from "@/lib/store";
import { sessionCookie } from "./auth-helper";

const req = (url: string, member = "leo", body?: unknown, method = body === undefined ? "GET" : "POST", family = "demo-family") =>
  new Request(`http://test${url}`, { method, headers: { "content-type": "application/json", cookie: sessionCookie(member, family) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T = Record<string, unknown>>(res: Response | Promise<Response>) => (await (await res).json()) as T;

beforeEach(() => {
  resetDemo();
});

describe("family docs", () => {
  it("validates on write and never leaks across families", async () => {
    await expect(putDoc("fam-a", "helper", { id: "h1", name: "" })).rejects.toThrow();
    await putDoc("fam-a", "helper", { id: "h1", name: "Ramesh", role: "groceries", forMemberId: "p1", addedBy: "x", createdAt: new Date().toISOString() });
    expect(await listDocs("fam-a", "helper")).toHaveLength(1);
    expect(await listDocs("fam-b", "helper")).toHaveLength(0);
  });

  it("seeds the demo family's rooms", async () => {
    expect((await listDocs("demo-family", "recipe")).length).toBeGreaterThan(0);
    expect((await listDocs("demo-family", "helper")).length).toBeGreaterThanOrEqual(5);
    resetDocs();
    expect(await listDocs("demo-family", "recipe")).toHaveLength(0);
  });
});

describe("kitchen", () => {
  const SPOKEN = "Take a fistful of rice and wash it. Two cups of milk, a little sugar and cardamom. Stir slowly, don't let it stick.";

  it("mock extraction keeps the cook's measures and invents nothing", () => {
    const d = mockRecipe(SPOKEN, "Rice kheer");
    expect(d.title).toBe("Rice kheer");
    const items = d.ingredients.map((i) => i.item);
    expect(items).toEqual(expect.arrayContaining(["rice", "milk", "sugar", "cardamom"]));
    expect(d.ingredients.find((i) => i.item === "rice")?.said).toMatch(/fistful/);
    expect(items).not.toContain("ghee");
    expect(groundedIn(SPOKEN, d)).toBe(true);
    expect(groundedIn(SPOKEN, { ...d, ingredients: [{ item: "saffron", said: "", approx: "" }, { item: "almonds", said: "", approx: "" }] })).toBe(false);
  });

  it("teach → attempt → bless, with the rules that make blessing mean something", async () => {
    const card = await dbAddCard({ familyId: "demo-family", type: "audio", caption: SPOKEN, lang: "en", takenAt: new Date().toISOString(), authorId: "dadi", transcript: SPOKEN, transcriptLang: "en" });
    const taught = await json<{ recipe: { id: string; cookId: string; madeBy: string; ingredients: unknown[] } }>(kitchenPost(req("/api/kitchen", "dadi", { action: "teach", cardId: card.id, title: "Rice kheer" })));
    expect(taught.recipe).toMatchObject({ cookId: "dadi", madeBy: "muse" });

    const cooked = await json<{ attempt: { id: string } }>(kitchenPost(req("/api/kitchen", "leo", { action: "attempt", recipeId: taught.recipe.id, note: "Bit sweet" })));
    expect((await kitchenPost(req("/api/kitchen", "leo", { action: "bless", attemptId: cooked.attempt.id }))).status).toBe(409);
    const blessed = await json<{ attempt: { blessedBy: string[] } }>(kitchenPost(req("/api/kitchen", "dadi", { action: "bless", attemptId: cooked.attempt.id })));
    expect(blessed.attempt.blessedBy).toEqual(["dadi"]);

    const page = await json<{ recipe: { id: string }; translated: boolean; attempts: unknown[] }>(recipeGet(req(`/api/kitchen/${taught.recipe.id}?lang=en`), { params: Promise.resolve({ id: taught.recipe.id }) }));
    expect(page.translated).toBe(false);
    expect(page.attempts).toHaveLength(1);
  });

  it("refuses a non-voice card and asks an elder for a recipe", async () => {
    expect((await kitchenPost(req("/api/kitchen", "leo", { action: "teach", cardId: "nope" }))).status).toBe(404);
    const asked = await json<{ question: { toMemberId: string; text: string; topic: string } }>(kitchenPost(req("/api/kitchen", "leo", { action: "ask", toMemberId: "dadi", dish: "rajma" })));
    expect(asked.question).toMatchObject({ toMemberId: "dadi", topic: "recipe", text: "How do you make your rajma?" });
    const all = await json<{ recipes: unknown[] }>(kitchenGet(req("/api/kitchen")));
    expect(all.recipes.length).toBeGreaterThan(0);
  });
});

describe("story keeper", () => {
  it("asks each elder once per week, and only they can answer", async () => {
    resetDocs();
    const first = await json<{ created: { id: string; toMemberId: string }[] }>(keeperPost(req("/api/keeper", "leo", { action: "weekly" })));
    expect(first.created.map((q) => q.toMemberId).sort()).toEqual(["dada", "dadi"]);
    const again = await json<{ created: unknown[] }>(keeperPost(req("/api/keeper", "leo", { action: "weekly" })));
    expect(again.created).toHaveLength(0);
    const card = await dbAddCard({ familyId: "demo-family", type: "audio", caption: "When I was small…", lang: "en", takenAt: new Date().toISOString(), authorId: "dadi" });
    const dadis = first.created.find((q) => q.toMemberId === "dadi")!;
    expect((await keeperPost(req("/api/keeper", "leo", { action: "answer", questionId: dadis.id, cardId: card.id }))).status).toBe(403);
    expect((await keeperPost(req("/api/keeper", "dadi", { action: "answer", questionId: dadis.id, cardId: card.id }))).status).toBe(200);
    const list = await json<{ questions: { id: string; answeredCardId: string | null }[] }>(keeperGet(req("/api/keeper")));
    expect(list.questions.find((q) => q.id === dadis.id)?.answeredCardId).toBe(card.id);
  });

  it("weeks start on Monday", () => {
    expect(weekOf(new Date("2026-10-29T10:00:00Z"))).toBe("2026-10-26");
    expect(weekOf(new Date("2026-10-26T00:00:00Z"))).toBe("2026-10-26");
  });
});

describe("presence and the quiet-day rule", () => {
  it("shares a moment; visits are throttled; settings name someone in the family", async () => {
    resetDocs();
    expect((await presencePost(req("/api/presence", "dadi", { moment: "chai", note: "verandah" }))).status).toBe(201);
    expect((await presencePost(req("/api/presence", "dadi", { moment: "here" }))).status).toBe(200); // recent moment → skipped
    expect((await presencePut(req("/api/presence", "dadi", { quietAlert: true, tellMemberId: "nobody" }, "PUT"))).status).toBe(400);
    expect((await presencePut(req("/api/presence", "dadi", { quietAlert: true, tellMemberId: "arjun" }, "PUT"))).status).toBe(200);
    const data = await json<{ presence: { moment: string }[]; settings: { tellMemberId: string }[] }>(presenceGet(req("/api/presence")));
    expect(data.presence.map((p) => p.moment)).toEqual(["chai"]);
    expect(data.settings[0].tellMemberId).toBe("arjun");
  });

  it("is quiet only when opted in, for the chosen person, well past their usual hour", () => {
    const tz = "Asia/Kolkata";
    const settings = { id: "dadi", memberId: "dadi", quietAlert: true, tellMemberId: "arjun", graceHours: 3, shareVisits: true, updatedAt: "2026-10-20T00:00:00.000Z" };
    // Usual first moment ~6:30 AM IST (01:00Z) on 3 prior days.
    const history = ["2026-10-25T01:00:00Z", "2026-10-26T01:05:00Z", "2026-10-27T00:55:00Z"].map((at, i) => ({ id: `p${i}`, memberId: "dadi", moment: "chai" as const, note: "", at }));
    expect(usualFirstHour("dadi", history, tz)).toBeCloseTo(6.5, 0);
    const noon = new Date("2026-10-28T06:30:00Z"); // 12:00 IST, nothing shared today
    expect(quietDay(settings, "arjun", history, tz, noon).quiet).toBe(true);
    expect(quietDay(settings, "leo", history, tz, noon).quiet).toBe(false);
    expect(quietDay({ ...settings, quietAlert: false }, "arjun", history, tz, noon).quiet).toBe(false);
    const sharedToday = [...history, { id: "t", memberId: "dadi", moment: "walk" as const, note: "", at: "2026-10-28T02:00:00Z" }];
    expect(quietDay(settings, "arjun", sharedToday, tz, noon).quiet).toBe(false);
    const night = new Date("2026-10-28T17:00:00Z"); // 22:30 IST: never at night
    expect(quietDay(settings, "arjun", history, tz, night).quiet).toBe(false);
  });

  it("rotates whose week it is", () => {
    expect(whoseWeek(["arjun", "leo"], "2026-10-26", new Date("2026-10-28T00:00:00Z"))).toEqual({ current: "arjun", next: "leo" });
    expect(whoseWeek(["arjun", "leo"], "2026-10-26", new Date("2026-11-03T00:00:00Z")).current).toBe("leo");
  });
});

describe("care circle", () => {
  it("need → claim (note for the parent) → assign a Village helper → done", async () => {
    const need = await json<{ need: { id: string } }>(carePost(req("/api/care", "arjun", { action: "need", forMemberId: "dadi", title: "Fix the geyser", kind: "repair" })));
    const claimed = await json<{ need: { status: string; noteForParent: string } }>(carePost(req("/api/care", "arjun", { action: "claim", needId: need.need.id })));
    expect(claimed.need.status).toBe("claimed");
    expect(claimed.need.noteForParent).toContain("Arjun");
    const assigned = await json<{ need: { helperId: string } }>(carePost(req("/api/care", "arjun", { action: "assign", needId: need.need.id, helperId: "helper-ramesh" })));
    expect(assigned.need.helperId).toBe("helper-ramesh");
    const done = await json<{ need: { status: string; doneAt: string } }>(carePost(req("/api/care", "arjun", { action: "done", needId: need.need.id })));
    expect(done.need.status).toBe("done");
  });

  it("turns a spoken request into the right kind of task, never advice", () => {
    expect(mockNeed("The gas cylinder is almost finished, please book it this week").kind).toBe("gas");
    expect(mockNeed("मुझे सब्ज़ी और दूध चाहिए").kind).toBe("groceries");
    expect(mockNeed("I'm not feeling well today").title).toBe("Someone to visit and check on me");
  });

  it("only helpers in that parent's Village can be sent; the retired rota is gone", async () => {
    await putDoc("demo-family", "helper", { id: "h-other", name: "Other", role: "driver", forMemberId: "arjun", addedBy: "leo", createdAt: new Date().toISOString() });
    const need = await json<{ need: { id: string } }>(carePost(req("/api/care", "leo", { action: "need", forMemberId: "dadi", title: "Ride to the station" })));
    expect((await carePost(req("/api/care", "leo", { action: "assign", needId: need.need.id, helperId: "h-other" }))).status).toBe(404);
    expect((await carePost(req("/api/care", "leo", { action: "take-week", forMemberId: "dadi" }))).status).toBe(400);
    const all = await json<{ helpers: unknown[]; rotas?: unknown }>(careGet(req("/api/care")));
    expect(all.helpers.length).toBeGreaterThan(0);
    expect(all.rotas).toBeUndefined();
  });
});

describe("sit together", () => {
  it("one open door per person; sittings only invite family and never start in the past", async () => {
    await sitPost(req("/api/sit", "leo", { action: "knock", minutes: 30 }));
    await sitPost(req("/api/sit", "leo", { action: "knock", minutes: 45, note: "Come sit" }));
    const s1 = await json<{ knocks: { memberId: string }[] }>(sitGet(req("/api/sit")));
    expect(s1.knocks.filter((k) => k.memberId === "leo")).toHaveLength(1);
    expect((await sitPost(req("/api/sit", "leo", { action: "sit", reason: "chai", title: "Chai", startsAt: "2020-01-01T00:00:00.000Z" }))).status).toBe(400);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const made = await json<{ sitting: { id: string; invites: string[] } }>(sitPost(req("/api/sit", "leo", { action: "sit", reason: "story", title: "Story night", startsAt: future, invites: ["dadi", "stranger", "leo"] })));
    expect(made.sitting.invites).toEqual(["dadi"]);
    expect((await sitPost(req("/api/sit", "dadi", { action: "cancel", sittingId: made.sitting.id }))).status).toBe(403);
    expect((await sitPost(req("/api/sit", "leo", { action: "cancel", sittingId: made.sitting.id }))).status).toBe(200);
  });

  it("finds hours when India and New York are both awake", () => {
    const from = new Date("2026-10-28T12:00:00Z");
    const w = awakeWindows(["Asia/Kolkata", "America/New_York"], from, 36);
    expect(w.length).toBeGreaterThan(0);
    for (const win of w) expect(win.end.getTime()).toBeGreaterThan(win.start.getTime());
    const picks = suggestTimes(["Asia/Kolkata", "America/New_York"], from);
    expect(picks.length).toBeGreaterThan(0);
    expect(picks[0].getTime()).toBeGreaterThanOrEqual(from.getTime() + 3_600_000);
  });

  it("writes a valid calendar entry and a safe room link", () => {
    const ics = icsFor({ id: "sit-1", title: "Chai, together; Sunday", start: new Date("2026-11-01T13:30:00Z") });
    expect(ics).toContain("DTSTART:20261101T133000Z");
    expect(ics).toContain(String.raw`SUMMARY:Chai\, together\; Sunday`);
    expect(roomUrl("sit-<script>")).toBe("https://meet.jit.si/Nearer-sit-script");
  });
});

describe("what Muse did", () => {
  it("logs every Muse step so the family can see it", async () => {
    resetDocs();
    seedDoc("demo-family", "muse_call", { id: "m1", purpose: "Test", model: "muse-spark-1.3", at: new Date().toISOString() });
    const t = await json<{ museCalls: { purpose: string }[]; demo: boolean }>(traceGet(req("/api/trace")));
    expect(t.museCalls[0].purpose).toBe("Test");
    expect(t.demo).toBe(true);
    await carePost(req("/api/care", "arjun", { action: "need", forMemberId: "dadi", title: "Milk" }));
  });
});
