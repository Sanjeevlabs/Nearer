// The error beacon: thin, impersonal reports from signed-in people; at most 2 KB; rate limited;
// the last 50 visible to an owner or admin only.
import { beforeEach, describe, expect, it } from "vitest";
import { GET as beaconGet, POST as beaconPost } from "@/app/api/beacon/route";
import { cleanReport, cleanRoute, resetClientErrors, scrub, uaClassOf } from "@/lib/client-errors";
import { clearAuthAttempts } from "@/lib/otp";
import { resetDemo } from "@/lib/store";
import { authedGet, sessionCookie } from "./auth-helper";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const send = (body: unknown, as = "dadi", ua = IPHONE) =>
  beaconPost(new Request("http://t/api/beacon", { method: "POST", headers: { "content-type": "application/json", cookie: sessionCookie(as), "user-agent": ua }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const list = async (as = "arjun") => ((await (await beaconGet(authedGet("http://t/api/beacon", as))).json()) as { errors: { route: string; message: string; stack: string; build: string; ua: string }[] }).errors;

beforeEach(() => {
  resetDemo();
  resetClientErrors();
  clearAuthAttempts();
});

describe("cleaning (pure)", () => {
  it("keeps the page path, never the query, the hash or an id", () => {
    expect(cleanRoute("https://nearer.app/lane?card=abc123&who=maa#x")).toBe("/lane");
    expect(cleanRoute("/kitchen/3f2a9c1e-77aa-4b1c-9d0e-123456789abc")).toBe("/kitchen/:id");
    expect(cleanRoute("/settings")).toBe("/settings");
  });
  it("takes emails, phone numbers, long numbers, tokens and full URLs out of text", () => {
    const out = scrub("Failed for maa@example.com at https://nearer.app/lane?card=1234567 call +91 98765 43210 token=abcdefghijklmnopqrstuvwxyz0123456789");
    expect(out).not.toMatch(/maa@|example|98765|1234567|abcdefghijklmnop|card=/);
    expect(out).toContain("[email]");
    expect(out).toContain("/lane");
  });
  it("classifies the device coarsely and never keeps the user-agent string", () => {
    expect(uaClassOf(IPHONE)).toBe("ios");
    expect(uaClassOf("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
    expect(uaClassOf("curl/8")).toBe("other");
    expect(cleanReport({ message: "boom", route: "/x" }, IPHONE)).toEqual({ route: "/x", message: "boom", stack: "", build: "", ua: "ios" });
  });
  it("keeps four lines of stack, ignores an empty message and a bad build", () => {
    const r = cleanReport({ message: "x", stack: "a\nb\nc\nd\ne\nf", build: "bad build!" }, "");
    expect(r?.stack.split("\n")).toHaveLength(4);
    expect(r?.build).toBe("");
    expect(cleanReport({ message: "   " }, "")).toBeNull();
  });
});

describe("POST /api/beacon", () => {
  it("stores a clean report for the family, with no name, email or id in it", async () => {
    const res = await send({ route: "/lane?card=abc", message: "Cannot read x of undefined (maa@example.com)", stack: "TypeError: x\n at f (https://nearer.app/_next/static/a.js:1:2)", build: "a1b2c3d" });
    expect(res.status).toBe(204);
    const [e] = await list();
    expect(e).toMatchObject({ route: "/lane", build: "a1b2c3d", ua: "ios" });
    expect(JSON.stringify(e)).not.toMatch(/maa@|example\.com|card=|dadi/);
  });

  it("needs a signed-in person", async () => {
    const res = await beaconPost(new Request("http://t/api/beacon", { method: "POST", body: JSON.stringify({ message: "x" }) }));
    expect(res.status).toBe(401);
  });

  it("refuses more than 2 KB, and anything that is not a report", async () => {
    expect((await send({ message: "x", stack: "y".repeat(2100) })).status).toBe(413);
    expect((await send("{not json")).status).toBe(400);
    expect((await send({ message: "" })).status).toBe(400);
    expect(await list()).toEqual([]);
  });

  it("slows a flood: six a minute per person", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await send({ message: `boom ${i}` })).status);
    expect(codes).toEqual([204, 204, 204, 204, 204, 204, 429, 429]);
    expect(await list()).toHaveLength(6);
  });
});

describe("GET /api/beacon", () => {
  it("is for the owner or an admin; a member gets 403", async () => {
    await send({ message: "boom" });
    expect((await beaconGet(authedGet("http://t/api/beacon", "dadi"))).status).toBe(403);
    expect(await list("arjun")).toHaveLength(1);
  });

  it("shows the newest 50 at most, newest first", async () => {
    for (let i = 0; i < 60; i++) {
      clearAuthAttempts();
      await send({ message: `boom ${i}` });
    }
    const errors = await list();
    expect(errors).toHaveLength(50);
    expect(errors[0].message).toBe("boom 59");
  });
});
