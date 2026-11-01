import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGetMember, dbListMembers } from "@/lib/db";
import { getDoc } from "@/lib/family-docs";
import { resetDemo } from "@/lib/store";
import { deepEqual, draftReducer, initDraft, isDirty, type DraftAction, type DraftState } from "@/lib/settings-draft";
import { saveLamp, saveLanguage, saveNudges, saveProfile, saveRoles, saveWhere, saveWindow, sameWindow, type WindowDraft } from "@/lib/settings-save";
import { clearAllPending, getPending, getPendingTabs, pendingSnapshot, setPending, clearPending } from "@/lib/settings-pending";
import { PATCH as profilePATCH } from "@/app/api/members/profile/route";
import { POST as displayLangPOST } from "@/app/api/members/display-lang/route";
import { POST as homeImagePOST } from "@/app/api/members/home-image/route";
import { PATCH as memberPATCH } from "@/app/api/members/[id]/route";
import { PUT as nudgePUT } from "@/app/api/nudges/settings/route";
import { PUT as presencePUT } from "@/app/api/presence/route";
import { POST as windowPOST } from "@/app/api/window/route";
import { sessionCookie } from "./auth-helper";

const FAM = "demo-family";

// ---- The pure reducer -------------------------------------------------------

type D = { a: string; n: number };
const run = (s: DraftState<D>, ...actions: DraftAction<D>[]) => actions.reduce(draftReducer<D>, s);
const base = initDraft<D>({ a: "x", n: 1 });

describe("useDraft reducer", () => {
  it("starts clean and idle", () => {
    expect(isDirty(base)).toBe(false);
    expect(base.status).toBe("idle");
  });

  it("an edit makes it dirty; editing back makes it clean", () => {
    const s = run(base, { type: "edit", patch: { a: "y" } });
    expect(isDirty(s)).toBe(true);
    expect(s.saved).toEqual({ a: "x", n: 1 });
    expect(isDirty(run(s, { type: "edit", patch: { a: "x" } }))).toBe(false);
  });

  it("discard returns to what was saved and clears errors", () => {
    const s = run(base, { type: "edit", patch: { n: 9 } }, { type: "saving" }, { type: "failed", error: "nope" });
    expect(s.status).toBe("error");
    const d = run(s, { type: "discard" });
    expect(d.draft).toEqual(base.saved);
    expect(d.status).toBe("idle");
    expect(d.error).toBeNull();
  });

  it("saving -> saved: the draft becomes the saved value, status saved, then settles to idle", () => {
    const sent = { a: "y", n: 1 };
    let s = run(base, { type: "edit", patch: { a: "y" } }, { type: "saving" });
    expect(s.status).toBe("saving");
    s = run(s, { type: "saved", sent });
    expect(s).toMatchObject({ status: "saved", saved: sent, draft: sent, error: null });
    expect(isDirty(s)).toBe(false);
    expect(run(s, { type: "settle" }).status).toBe("idle");
  });

  it("an edit made while saving survives the save", () => {
    let s = run(base, { type: "edit", patch: { a: "y" } }, { type: "saving" });
    s = run(s, { type: "edit", patch: { a: "z" } });
    expect(s.status).toBe("saving");
    s = run(s, { type: "saved", sent: { a: "y", n: 1 } });
    expect(s.saved.a).toBe("y");
    expect(s.draft.a).toBe("z");
    expect(isDirty(s)).toBe(true);
  });

  it("failure keeps the draft and the error; editing clears the error; partial progress moves the baseline", () => {
    let s = run(base, { type: "edit", patch: { a: "y", n: 2 } }, { type: "saving" }, { type: "failed", error: "Couldn't save", saved: { a: "y", n: 1 } });
    expect(s).toMatchObject({ status: "error", error: "Couldn't save", saved: { a: "y", n: 1 }, draft: { a: "y", n: 2 } });
    s = run(s, { type: "edit", patch: { n: 3 } });
    expect(s.status).toBe("idle");
    expect(s.error).toBeNull();
  });

  it("a flash only settles from saved", () => {
    expect(run(base, { type: "edit", patch: { n: 2 } }, { type: "settle" }).draft.n).toBe(2);
  });

  it("rebase follows the server under a clean draft, and keeps an edit in progress", () => {
    const clean = run(base, { type: "rebase", value: { a: "server", n: 5 } });
    expect(clean.draft).toEqual({ a: "server", n: 5 });
    const dirty = run(base, { type: "edit", patch: { a: "mine" } }, { type: "rebase", value: { a: "server", n: 5 } });
    expect(dirty.saved).toEqual({ a: "server", n: 5 });
    expect(dirty.draft.a).toBe("mine");
  });

  it("deepEqual and a custom equality (window people in any order)", () => {
    expect(deepEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    const w: WindowDraft = { photo: null, people: ["a", "b"], quietAfterHours: 4 };
    expect(sameWindow(w, { ...w, people: ["b", "a"] })).toBe(true);
    const reordered = { ...initDraft(w), draft: { ...w, people: ["b", "a"] } };
    expect(isDirty(reordered, sameWindow)).toBe(false);
    expect(isDirty(reordered)).toBe(true);
  });
});

describe("pending drafts (the unsaved-changes banner and a return visit)", () => {
  afterEach(() => clearAllPending());
  it("tracks dirty sections by tab and forgets them when clean", () => {
    setPending("nudges", { title: "Mail and nudges", tab: "you", draft: { email: true } });
    setPending("window", { title: "Your first screen", tab: "window", draft: {} });
    expect(pendingSnapshot().map(([id]) => id).sort()).toEqual(["nudges", "window"]);
    expect(getPendingTabs().sort()).toEqual(["window", "you"]);
    expect(getPending("nudges")?.draft).toEqual({ email: true });
    clearPending("nudges");
    expect(getPendingTabs()).toEqual(["window"]);
    clearAllPending();
    expect(pendingSnapshot()).toEqual([]);
  });
});

// ---- Choosing something never writes ---------------------------------------

describe("mock mode: selecting an option performs no fetch", () => {
  it("edits, discards and rebases never call fetch; only a save function does", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("no network in this test")));
    try {
      let s = initDraft({ email: false, maxPerWeek: 3 });
      s = draftReducer(s, { type: "edit", patch: { maxPerWeek: 0 } });
      s = draftReducer(s, { type: "edit", patch: { email: true } });
      s = draftReducer(s, { type: "rebase", value: { email: false, maxPerWeek: 3 } });
      s = draftReducer(s, { type: "discard" });
      expect(spy).not.toHaveBeenCalled();
      // Save is the one thing that fetches.
      await saveNudges((i, init) => fetch(i, init), { email: true, maxPerWeek: 2 });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toBe("/api/nudges/settings");
    } finally {
      spy.mockRestore();
    }
  });
});

// ---- Save calls the right endpoint with the draft (through the real routes) --

/** A fetch that runs the app's own route handlers, signed in as `memberId`, and records each call. */
function routeFetch(memberId = "dadi") {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const req = new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json", cookie: sessionCookie(memberId) }, body: init?.body ?? undefined });
    const member = path.match(/^\/api\/members\/([^/]+)$/);
    if (path === "/api/members/profile" && method === "PATCH") return profilePATCH(req);
    if (path === "/api/members/display-lang") return displayLangPOST(req);
    if (path === "/api/members/home-image") return homeImagePOST(req);
    if (member && method === "PATCH") return memberPATCH(req, { params: Promise.resolve({ id: decodeURIComponent(member[1]) }) });
    if (path === "/api/nudges/settings" && method === "PUT") return nudgePUT(req);
    if (path === "/api/presence" && method === "PUT") return presencePUT(req);
    if (path === "/api/window" && method === "POST") return windowPOST(req);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

beforeEach(() => resetDemo());

const NOB = { birthMonth: "", birthDay: "", birthYear: "" };

describe("Profile Save", () => {
  it("one PATCH /api/members/profile with only what changed", async () => {
    const { f, calls } = routeFetch("dadi");
    const before = (await dbGetMember("dadi"))!;
    const r = await saveProfile(f, { firstName: "  Dadima ", photoRef: before.photoRef, ...NOB }, { firstName: before.firstName, photoRef: before.photoRef, ...NOB });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([{ method: "PATCH", path: "/api/members/profile", body: { firstName: "Dadima" } }]);
    expect((await dbGetMember("dadi"))!.firstName).toBe("Dadima");
  });
  it("a birthday with a year is one request; a year without a day is refused before any request", async () => {
    const { f, calls } = routeFetch("dadi");
    const r = await saveProfile(f, { firstName: "A", photoRef: null, birthMonth: "01", birthDay: "22", birthYear: "1955" }, { firstName: "A", photoRef: null, ...NOB });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([{ method: "PATCH", path: "/api/members/profile", body: { birthday: "1955-01-22" } }]);
    const none = routeFetch("dadi");
    expect(await saveProfile(none.f, { firstName: "A", photoRef: null, birthMonth: "", birthDay: "", birthYear: "1955" }, { firstName: "A", photoRef: null, ...NOB })).toMatchObject({ ok: false });
    expect(none.calls).toHaveLength(0);
  });
  it("no request when nothing changed, and a failed request is reported", async () => {
    const { f, calls } = routeFetch();
    expect((await saveProfile(f, { firstName: "A", photoRef: null, ...NOB }, { firstName: "A", photoRef: null, ...NOB })).ok).toBe(true);
    expect(calls).toHaveLength(0);
    const bad = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    expect(await saveProfile(bad, { firstName: "B", photoRef: null, ...NOB }, { firstName: "A", photoRef: null, ...NOB })).toMatchObject({ ok: false });
  });
});

describe("Language Save", () => {
  it("POST /api/members/display-lang with the member and the chosen language", async () => {
    const { f, calls } = routeFetch("dadi");
    const r = await saveLanguage(f, { lang: "hi-deva" }, "dadi");
    expect(r.ok).toBe(true);
    expect(calls).toEqual([{ method: "POST", path: "/api/members/display-lang", body: { memberId: "dadi", displayLang: "hi-deva" } }]);
    expect((await dbGetMember("dadi"))!.displayLang).toBe("hi-deva");
  });
});

describe("Mail and nudges Save", () => {
  it("one PUT /api/nudges/settings with both fields", async () => {
    const { f, calls } = routeFetch("dadi");
    const r = await saveNudges(f, { email: true, maxPerWeek: 0 });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([{ method: "PUT", path: "/api/nudges/settings", body: { email: true, maxPerWeek: 0 } }]);
    expect(await getDoc(FAM, "nudge_settings", "dadi")).toMatchObject({ email: true, maxPerWeek: 0 });
  });
});

describe("Where you are Save", () => {
  it("PATCH profile for zone and city, then POST home-image for a new photo", async () => {
    const { f, calls } = routeFetch("dadi");
    const m = (await dbGetMember("dadi"))!;
    const saved = { tz: m.tz, city: m.city ?? "", home: null };
    const r = await saveWhere(f, { tz: "America/New_York", city: " Pune ", home: { mediaRef: "uploads/home.jpg", palette: ["#fff"] } }, saved, "dadi");
    expect(r.ok).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["PATCH /api/members/profile", "POST /api/members/home-image"]);
    expect(calls[0].body).toEqual({ tz: "America/New_York", city: "Pune" });
    expect(calls[1].body).toEqual({ memberId: "dadi", mediaRef: "uploads/home.jpg", palette: ["#fff"] });
    const after = (await dbGetMember("dadi"))!;
    expect(after).toMatchObject({ tz: "America/New_York", city: "Pune", homeImageRef: "uploads/home.jpg" });
    // The pending photo is gone from the draft once saved.
    expect(r).toMatchObject({ ok: true, draft: { home: null, city: "Pune" } });
  });
  it("zone only: no home-image request", async () => {
    const { f, calls } = routeFetch("dadi");
    await saveWhere(f, { tz: "Asia/Tokyo", city: "", home: null }, { tz: "Asia/Kolkata", city: "", home: null }, "dadi");
    expect(calls.map((c) => c.path)).toEqual(["/api/members/profile"]);
  });
});

describe("Your first screen Save", () => {
  it("sends only the changed parts, in order: photo, people, amber hours", async () => {
    const { f, calls } = routeFetch("dadi");
    const others = (await dbListMembers(FAM)).filter((x) => x.id !== "dadi" && x.role !== "child" && x.access !== "child" && x.access !== "teen").slice(0, 1).map((x) => x.id);
    const saved: WindowDraft = { photo: null, people: [], quietAfterHours: 4 };
    const r = await saveWindow(f, { photo: null, people: others, quietAfterHours: 6 }, saved);
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.body)).toEqual([{ action: "people", people: others }, { action: "quiet", hours: 6 }]);
    const view = await getDoc(FAM, "window_view", "dadi");
    expect(view).toMatchObject({ quietAfterHours: 6, people: others });
  });
  it("a failure part-way reports what did save, so Retry sends only the rest", async () => {
    let n = 0;
    const flaky = (async () => (++n === 1 ? new Response("{}", { status: 200 }) : new Response("{}", { status: 500 }))) as unknown as typeof fetch;
    const saved: WindowDraft = { photo: null, people: [], quietAfterHours: 4 };
    const r = await saveWindow(flaky, { photo: "p1", people: ["x"], quietAfterHours: 8 }, saved);
    expect(r).toMatchObject({ ok: false, saved: { photo: "p1", people: [], quietAfterHours: 4 } });
  });
});

describe("People and roles Save", () => {
  it("one PATCH per changed person; owner handover is never part of it", async () => {
    const { f, calls } = routeFetch("arjun");
    const kids = (await dbListMembers(FAM)).filter((x) => x.access === "member" && x.id !== "arjun");
    const target = kids[0];
    expect(target).toBeTruthy();
    const r = await saveRoles(f, { [target.id]: "admin" });
    expect(calls).toEqual([{ method: "PATCH", path: `/api/members/${target.id}`, body: { access: "admin" } }]);
    expect(r.ok).toBe(true);
    expect((await dbGetMember(target.id))!.access).toBe("admin");
  });
  it("a refused change keeps that person's choice in the draft with a plain reason", async () => {
    const refuse = (async () => new Response(JSON.stringify({ error: "admins-full" }), { status: 409 })) as unknown as typeof fetch;
    const r = await saveRoles(refuse, { a: "admin", b: "teen" });
    expect(r).toMatchObject({ ok: false, error: "A family can have up to 3 admins, the owner included.", draft: { a: "admin", b: "teen" } });
  });
});

describe("Privacy (lamp) Save", () => {
  it("one PUT /api/presence with the whole care settings row", async () => {
    const { f, calls } = routeFetch("dadi");
    const r = await saveLamp(f, { quietAlert: false, tellMemberId: null, graceHours: 3, shareVisits: false });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([{ method: "PUT", path: "/api/presence", body: { quietAlert: false, tellMemberId: null, graceHours: 3, shareVisits: false } }]);
    expect(await getDoc(FAM, "care_settings", "dadi")).toMatchObject({ shareVisits: false });
  });
});
