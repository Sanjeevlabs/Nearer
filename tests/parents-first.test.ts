import { beforeEach, describe, expect, it } from "vitest";
import { GET as giftsGet } from "@/app/api/gifts/route";
import { GET as keeperGet, POST as keeperPost } from "@/app/api/keeper/route";
import type { Gift } from "@/lib/gifts";
import type { Question } from "@/lib/kinds";
import { shareableFor } from "@/lib/presence";
import { spacesFor } from "@/lib/spaces";
import { roomsFor } from "@/lib/menu";
import { resetDemo } from "@/lib/store";
import { sessionCookie } from "./auth-helper";

const req = (url: string, member: string, body?: unknown) =>
  new Request(`http://test${url}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", cookie: sessionCookie(member) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;

beforeEach(() => resetDemo());

describe("parents first", () => {
  it("tells Maa what her gifts did this week, in words, from what really happened", async () => {
    const { gifts } = await json<{ gifts: Gift[] }>(giftsGet(req("/api/gifts", "dadi")));
    const lines = gifts.map((g) => `${g.byId} ${g.text}`);
    expect(lines).toEqual(expect.arrayContaining(["arjun cooked your Dal tadka", "priya listened to your story, “The elephant and the tailor”", "arjun heard your advice on “How do I stay patient when Vihaan won't sleep”"]));
    expect(gifts.every((g) => g.byId !== "dadi")).toBe(true);
  });

  it("asks a parent for advice or a blessing; never yourself", async () => {
    const a = await json<{ question: Question }>(keeperPost(req("/api/keeper", "priya", { action: "ask", toMemberId: "dadi", topic: "blessing", text: "Will you bless me for my new job?" })));
    expect(a.question).toMatchObject({ topic: "blessing", askedBy: "priya", toMemberId: "dadi" });
    expect((await keeperPost(req("/api/keeper", "priya", { action: "ask", toMemberId: "priya", text: "Advice for myself?" }))).status).toBe(400);
    const { questions } = await json<{ questions: Question[] }>(keeperGet(req("/api/keeper", "dadi")));
    expect(questions.some((q) => q.id === a.question.id)).toBe(true);
  });

  it("keeps the parent's menu about what they give; children share their day too", () => {
    expect(spacesFor(false).map((s) => s.id)).toEqual(["memories", "kitchen", "care", "family", "celebrations"]);
    expect(spacesFor(true).find((s) => s.id === "care")?.rooms.map((r) => r.href)).not.toContain("/around");
    expect(shareableFor("adult")).toContain("work");
    expect(shareableFor("child")).toContain("school");
  });

  it("keeps every family feature in five rooms, with no duplicate Ask", () => {
    const kid = roomsFor(false);
    expect(kid.map((r) => r.title)).toEqual(["Memories", "Kitchen", "Care", "Family", "Celebrations"]);
    const hrefs = kid.flatMap((r) => r.tabs.map((t) => t.href));
    for (const h of ["/care", "/care/helpers", "/nearby", "/kitchen", "/stories", "/advice", "/bond", "/bond/homes","/lane", "/rituals", "/book", "/send", "/portrait", "/together/visits", "/together/holidays", "/gather", "/gather/play"]) expect(hrefs).toContain(h);
    expect(hrefs).not.toContain("/ask");
    expect(hrefs).not.toContain("/around");
    expect(hrefs).not.toContain("/safe");
    expect(kid.find((r) => r.id === "kitchen")?.tabs.map((t) => t.href)).toEqual(["/kitchen"]);
  });
});
