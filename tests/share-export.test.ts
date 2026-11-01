import { beforeEach, describe, expect, it } from "vitest";
import { GET as exportGet } from "@/app/api/export/route";
import { POST as kitchenPost } from "@/app/api/kitchen/route";
import { DELETE as shareDel, GET as shareGet, POST as sharePost } from "@/app/api/share/route";
import { countView, getShare, resetShares } from "@/lib/shares";
import { resetDemo } from "@/lib/store";
import { sessionCookie } from "./auth-helper";

const req = (url: string, member: string, body?: unknown, method?: string) =>
  new Request(`http://test${url}`, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { "content-type": "application/json", cookie: sessionCookie(member) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T = Record<string, unknown>>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const recipe = { title: "Palak paneer", course: "main", prepMins: 15, cookMins: 25, serves: "3", memory: "", prepWork: ["Blanch the spinach"], outcome: "Bright green", ingredients: [{ item: "spinach", said: "", approx: "400 g" }], steps: [{ text: "Blend it.", tip: "" }] };

beforeEach(() => {
  resetDemo();
  resetShares();
});

describe("kitchen library", () => {
  it("anyone shares their own recipe; writing one down for Maa makes it hers, and you can still edit it", async () => {
    const mine = await kitchenPost(req("/api/kitchen", "arjun", { action: "create", ...recipe }));
    expect(mine.status).toBe(201);
    expect((await json<{ recipe: { cookId: string; addedBy: string | null } }>(mine)).recipe).toMatchObject({ cookId: "arjun", addedBy: null });
    const forMaa = await json<{ recipe: { id: string; cookId: string; addedBy: string } }>(kitchenPost(req("/api/kitchen", "priya", { action: "create", cookId: "dadi", ...recipe, title: "Gobi pakoda" })));
    expect(forMaa.recipe).toMatchObject({ cookId: "dadi", addedBy: "priya" });
    expect((await kitchenPost(req("/api/kitchen", "priya", { action: "edit", recipeId: forMaa.recipe.id, ...recipe, title: "Gobi ke pakode" }))).status).toBe(200);
    expect((await kitchenPost(req("/api/kitchen", "kavya", { action: "edit", recipeId: forMaa.recipe.id, ...recipe }))).status).toBe(403);
    expect((await kitchenPost(req("/api/kitchen", "arjun", { action: "create", ...recipe, ingredients: [] }))).status).toBe(400);
  });
});

describe("public recipe links", () => {
  it("share → public frozen copy → one link per recipe → stop sharing", async () => {
    const a = await json<{ token: string; path: string }>(sharePost(req("/api/share", "arjun", { kind: "recipe", id: "recipe-dadi-gobi" })));
    expect(a.path).toBe(`/r/${a.token}`);
    expect(a.token.length).toBeGreaterThanOrEqual(20);
    const again = await json<{ token: string }>(sharePost(req("/api/share", "priya", { kind: "recipe", id: "recipe-dadi-gobi" })));
    expect(again.token).toBe(a.token);
    const s = await getShare(a.token);
    expect(s?.snapshot).toMatchObject({ title: "Gobi ke pakode", from: "Maa" });
    expect(JSON.stringify(s?.snapshot)).not.toMatch(/voiceCardId|cookId|familyId|photo/);
    const list = await json<{ shares: { token: string }[] }>(shareGet(req("/api/share", "leo")));
    expect(list.shares.map((x) => x.token)).toContain(a.token);
    expect((await shareDel(req("/api/share", "kavya", { token: a.token }, "DELETE"))).status).toBe(403);
    expect((await shareDel(req("/api/share", "arjun", { token: a.token }, "DELETE"))).status).toBe(200);
    expect(await getShare(a.token)).toBeNull();
    expect(await getShare("../../etc/passwd")).toBeNull();
  });

  it("children can't publish outside the family", async () => {
    expect((await sharePost(req("/api/share", "aria", { kind: "recipe", id: "recipe-dadi-gobi" }))).status).toBe(403);
  });

  it("counts visits to the public page", async () => {
    const a = await json<{ token: string }>(sharePost(req("/api/share", "arjun", { kind: "recipe", id: "recipe-arjun-palak" })));
    await countView(a.token);
    await countView(a.token);
    expect((await getShare(a.token))?.views).toBe(2);
  });
});

describe("family export", () => {
  it("downloads everything as one file, without emails, Muse logs or safety locations", async () => {
    const res = await exportGet(req("/api/export", "arjun"));
    expect(res.headers.get("content-disposition")).toMatch(/nearer-sharma-\d{4}-\d{2}-\d{2}\.json/);
    const out = (await res.json()) as Record<string, unknown>;
    expect(out.format).toBe("nearer-family-export");
    expect((out.members as unknown[]).length).toBe(12);
    expect((out.recipe as unknown[]).length).toBeGreaterThan(3);
    expect(out).not.toHaveProperty("muse_call");
    expect(out).not.toHaveProperty("safety_checkin");
    expect(JSON.stringify(out.members)).not.toContain('"email"');
    expect((await exportGet(req("/api/export", "aria"))).status).toBe(403);
  });
});
