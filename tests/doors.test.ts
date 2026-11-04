// Open doors (lib/doors.ts): who may see and join a knock, what the Together card shows,
// the one push a one-person door sends, and the call page's consent gate (lib/call-gate.ts).
import { readFileSync } from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as sitGet, POST as sitPost } from "@/app/api/sit/route";
import { GET as tokenGet } from "@/app/api/sit/token/route";
import { GET as roomGet } from "@/app/api/sit/room/route";
import { GET as windowGet } from "@/app/api/window/route";
import { deniedReason, jitsiConfig, jitsiHash, mediaAllowed, stillOpen } from "@/lib/call-gate";
import { canSeeKnock, doorPush, doorsFor, togetherView, type Door } from "@/lib/doors";
import { getDoc, putDoc } from "@/lib/family-docs";
import { KnockSchema, SittingSchema, type Knock } from "@/lib/kinds";
import { pushIdle } from "@/lib/push/background";
import { getPushSettings } from "@/lib/push/prefs";
import { pushDoorNow, pushSittingInvite } from "@/lib/push/events";
import { clearOutbox, outbox } from "@/lib/push/send";
import { resetPushStore, upsertSub } from "@/lib/push/store";
import { mockAddMember, resetDemo } from "@/lib/store";
import { windowState } from "@/lib/window-server";
import { authedGet, authedJson } from "./auth-helper";

const FAM = "demo-family";
// 11:30 in India: outside quiet hours for Dadi.
const NOW = new Date("2026-10-28T06:00:00.000Z");
const json = async <T = Record<string, unknown>>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const open = (as: string, body: Record<string, unknown>) => json<{ knock: Knock; error?: string }>(sitPost(authedJson("http://t/api/sit", { action: "knock", ...body }, as)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetDemo();
  resetPushStore();
  clearOutbox();
});
afterEach(() => vi.useRealTimers());

describe("the demo starts with no open door", () => {
  it("seeds no knock (nothing fabricated)", async () => {
    const s = await json<{ knocks: Knock[] }>(sitGet(authedGet("http://t/api/sit", "dadi")));
    expect(s.knocks).toEqual([]);
  });
});

describe("knock invites are enforced", () => {
  it("rejects eleven invitees at both the schema and API boundaries", async () => {
    const invites = Array.from({ length: 11 }, (_, i) => `guest-${i}`);
    const at = NOW.toISOString();
    const sitting = { id: "sit-test", title: "Tea together", reason: "chai", hostId: "arjun", startsAt: at, createdAt: at, invites };
    const knock = { id: "knock-test", memberId: "arjun", at, until: at, invites };
    expect(SittingSchema.safeParse(sitting).success).toBe(false);
    expect(KnockSchema.safeParse(knock).success).toBe(false);
    expect((await sitPost(authedJson("http://t/api/sit", { ...sitting, action: "sit" }, "arjun"))).status).toBe(400);
    expect((await sitPost(authedJson("http://t/api/sit", { action: "knock", invites }, "arjun"))).status).toBe(400);
  });

  it("pushes at most ten distinct recipients even if a caller supplies too many", async () => {
    const invites = Array.from({ length: 11 }, (_, i) => `guest-${i}`);
    for (const id of invites) {
      mockAddMember({ id, familyId: FAM, firstName: id, displayName: id, role: "adult", tz: "Asia/Kolkata" });
      await upsertSub({ familyId: FAM, memberId: id, kind: "fcm", token: `fcm-token-${id}-aaaaaaaaaaaaaaaa`, platform: "android" });
    }
    const at = NOW.toISOString();
    const knock = await putDoc(FAM, "knock", { id: "knock-cap", memberId: "arjun", at, until: new Date(+NOW + 30 * 60_000).toISOString(), invites: invites.slice(0, 10) });
    await pushDoorNow(FAM, { ...knock, invites: ["arjun", ...invites, invites[0]] }, NOW);
    expect(outbox.map((entry) => entry.memberId)).toEqual(invites.slice(0, 10));
    clearOutbox();
    const sitting = SittingSchema.parse({ id: "sit-cap", title: "Tea together", reason: "chai", hostId: "arjun", startsAt: at, createdAt: at });
    await pushSittingInvite(FAM, { ...sitting, invites: ["arjun", ...invites, invites[0]] }, NOW);
    expect(outbox.map((entry) => entry.memberId)).toEqual(invites.slice(0, 10));
  });

  it("a door for Dadi only: Dadi sees and may join it, Leo and Priya do not, Arjun sees his own", async () => {
    const { knock } = await open("arjun", { activity: "chai", invites: ["dadi"] });
    expect(knock).toMatchObject({ memberId: "arjun", activity: "chai", invites: ["dadi"] });
    // 30 minutes by default.
    expect(Date.parse(knock.until) - Date.parse(knock.at)).toBe(30 * 60_000);

    const seen = async (as: string) => (await json<{ knocks: Knock[] }>(sitGet(authedGet("http://t/api/sit", as)))).knocks.map((k) => k.id);
    expect(await seen("dadi")).toEqual([knock.id]);
    expect(await seen("arjun")).toEqual([knock.id]);
    expect(await seen("leo")).toEqual([]);
    expect(await seen("priya")).toEqual([]);

    expect((await tokenGet(authedGet(`http://t/api/sit/token?id=${knock.id}`, "dadi"))).status).toBe(200);
    expect((await tokenGet(authedGet(`http://t/api/sit/token?id=${knock.id}`, "leo"))).status).toBe(404);
    expect((await roomGet(authedGet(`http://t/api/sit/room?id=${knock.id}`, "leo"))).status).toBe(404);

    const win = async (as: string) => json<{ doors: Door[]; myDoor: Door | null }>(windowGet(authedGet("http://t/api/window", as)));
    const dadi = await win("dadi");
    expect(dadi.doors.map((d) => d.id)).toEqual([knock.id]);
    expect(dadi.doors[0]).toMatchObject({ hostId: "arjun", activity: "chai", justYou: true });
    expect(dadi.myDoor).toBeNull();
    expect((await win("leo")).doors).toEqual([]);
    const arjun = await win("arjun");
    expect(arjun.doors).toEqual([]);
    expect(arjun.myDoor?.id).toBe(knock.id);
  });

  it("a family-wide door is seen by everyone; an expired one by no one and cannot be joined", async () => {
    const { knock } = await open("dadi", { activity: "dinner", minutes: 15 });
    expect(knock.invites).toBeUndefined();
    for (const as of ["arjun", "leo", "priya"]) expect((await windowState(FAM, as, NOW)).doors.map((d) => d.id)).toEqual([knock.id]);
    vi.setSystemTime(new Date(NOW.getTime() + 16 * 60_000));
    expect((await json<{ knocks: Knock[] }>(sitGet(authedGet("http://t/api/sit", "arjun")))).knocks).toEqual([]);
    expect((await tokenGet(authedGet(`http://t/api/sit/token?id=${knock.id}`, "arjun"))).status).toBe(404);
    expect((await windowState(FAM, "arjun", new Date())).doors).toEqual([]);
  });

  it("closing (unknock) removes it for everyone; a new door replaces the old one", async () => {
    const first = await open("arjun", { activity: "chai", invites: ["dadi"] });
    const second = await open("arjun", { activity: "catchup" });
    const all = (await json<{ knocks: Knock[] }>(sitGet(authedGet("http://t/api/sit", "arjun")))).knocks;
    expect(all.map((k) => k.id)).toEqual([second.knock.id]);
    expect(all.map((k) => k.id)).not.toContain(first.knock.id);
    await sitPost(authedJson("http://t/api/sit", { action: "unknock" }, "arjun"));
    expect((await windowState(FAM, "dadi", NOW)).doors).toEqual([]);
  });

  it("invites outside the family are refused rather than opening the door to everyone", async () => {
    const res = await sitPost(authedJson("http://t/api/sit", { action: "knock", invites: ["someone-else"] }, "arjun"));
    expect(res.status).toBe(400);
  });
});

describe("the one push", () => {
  it("a one-person door tells that person once; a family-wide door tells no one", async () => {
    await upsertSub({ familyId: FAM, memberId: "dadi", kind: "fcm", token: "fcm-token-dadi-aaaaaaaaaaaaaaaa", platform: "android" });
    await upsertSub({ familyId: FAM, memberId: "leo", kind: "fcm", token: "fcm-token-leo-aaaaaaaaaaaaaaaaa", platform: "android" });
    const { knock } = await open("arjun", { activity: "chai", invites: ["dadi"] });
    await pushIdle();
    expect(outbox.map((o) => [o.memberId, o.msg.body])).toEqual([["dadi", "Arjun is having tea. Join?"]]);
    expect(outbox[0].msg.url).toBe(`/call/${knock.id}`);
    // Never resent: the knock is marked told.
    const stored = await getDoc(FAM, "knock", knock.id);
    expect(stored?.seenAt).toBeTruthy();
    expect(await pushDoorNow(FAM, stored!, NOW)).toBe("skipped");
    clearOutbox();
    await open("arjun", { activity: "dinner" });
    await pushIdle();
    expect(outbox).toHaveLength(0);
  });

  it("in Dadi's quiet hours the invitation is held for the morning summary", async () => {
    await upsertSub({ familyId: FAM, memberId: "dadi", kind: "fcm", token: "fcm-token-dadi-aaaaaaaaaaaaaaaa", platform: "android" });
    const night = new Date("2026-10-28T18:30:00.000Z"); // 00:00 in India
    vi.setSystemTime(night);
    const { knock } = await open("arjun", { activity: "chai", invites: ["dadi"] });
    await pushIdle();
    expect(outbox).toHaveLength(0);
    expect((await getDoc(FAM, "knock", knock.id))?.seenAt).toBeTruthy();
    expect((await getPushSettings(FAM, "dadi")).overflow).toBe(1);
  });

  it("the words say only what the host chose", () => {
    expect(doorPush("Maa", "chai", "")).toBe("Maa is having chai. Join?");
    expect(doorPush("Papa", null, "Come sit")).toBe("Papa opened the door: Come sit. Join?");
  });
});

describe("door states (the Together card)", () => {
  const k = (id: string, memberId: string, at: number, extra: Partial<Knock> = {}): Knock => ({
    id,
    memberId,
    note: "",
    venue: "courtyard",
    at: new Date(NOW.getTime() + at * 60_000).toISOString(),
    until: new Date(NOW.getTime() + (at + 30) * 60_000).toISOString(),
    ...extra,
  });
  const name = (id: string) => id.toUpperCase();

  it("loading, error, empty and open are distinct; an error never says nobody is around", () => {
    expect(togetherView(null, false)).toEqual({ kind: "loading" });
    expect(togetherView(null, true)).toEqual({ kind: "error" });
    expect(togetherView({ doors: [], myDoor: null }, false)).toEqual({ kind: "empty" });
    // A failed refresh keeps what was shown.
    expect(togetherView({ doors: [], myDoor: null }, true)).toEqual({ kind: "empty" });
  });

  it("doors for me first, then newest; my own door separately; others' private doors never", () => {
    const knocks = [k("a", "dadi", -5), k("b", "dada", -1), k("c", "priya", -2, { invites: ["leo"] }), k("d", "kavya", -10, { invites: ["arjun"] }), k("mine", "arjun", -3, { activity: "chai" }), k("old", "dadi", -60)];
    const { doors, myDoor } = doorsFor(knocks, "arjun", name, NOW.getTime());
    expect(doors.map((d) => d.id)).toEqual(["d", "b", "a"]);
    expect(doors[0].justYou).toBe(true);
    expect(myDoor).toMatchObject({ id: "mine", activity: "chai" });
    const v = togetherView({ doors, myDoor }, false);
    expect(v).toMatchObject({ kind: "doors", first: { id: "d" } });
    if (v.kind === "doors") expect(v.more.map((d) => d.id)).toEqual(["b", "a"]);
    // "Not now" hides it on this device only.
    const after = togetherView({ doors, myDoor: null }, false, new Set(["d", "b", "a"]));
    expect(after).toEqual({ kind: "empty" });
  });

  it("canSeeKnock: host, family-wide, invited", () => {
    expect(canSeeKnock({ memberId: "a", invites: ["b"] }, "a")).toBe(true);
    expect(canSeeKnock({ memberId: "a", invites: ["b"] }, "b")).toBe(true);
    expect(canSeeKnock({ memberId: "a", invites: ["b"] }, "c")).toBe(false);
    expect(canSeeKnock({ memberId: "a", invites: [] }, "c")).toBe(true);
    expect(canSeeKnock({ memberId: "a" }, "c")).toBe(true);
  });

  it("the card's words never infer availability", () => {
    const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const src = code("components/together-card.tsx") + code("lib/doors.ts");
    expect(src).not.toMatch(/is available|on a (video )?call|no one is available|nobody is (around|available)|all good|asleep/i);
  });
});

describe("the call page's consent gate", () => {
  it("nothing that can start media exists before the tap", () => {
    expect(mediaAllowed("checking")).toBe(false);
    expect(mediaAllowed("prejoin")).toBe(false);
    expect(mediaAllowed("closed")).toBe(false);
    expect(mediaAllowed("denied")).toBe(false);
    expect(mediaAllowed("ended")).toBe(false);
    expect(mediaAllowed("connecting")).toBe(true);
    expect(mediaAllowed("in")).toBe(true);
  });

  it("audio means no camera; video turns both on; Jitsi's own pre-join stays off", () => {
    expect(jitsiConfig("audio")).toMatchObject({ startWithVideoMuted: true, startAudioOnly: true, startWithAudioMuted: false, prejoinConfig: { enabled: false } });
    expect(jitsiConfig("video")).toMatchObject({ startWithVideoMuted: false, startAudioOnly: false, startWithAudioMuted: false });
    expect(jitsiHash("audio", "Dadi")).toContain("config.startAudioOnly=true");
  });

  it("no virtual background or noise-suppression ML in the call (Meta-only models)", () => {
    expect(jitsiConfig("video")).toMatchObject({ disableVirtualBackground: true });
    const bar = (jitsiConfig("video").toolbarButtons as string[]) ?? [];
    expect(bar).not.toContain("select-background");
    expect(bar).not.toContain("noisesuppression");
    expect(jitsiHash("video", "Dadi")).toContain("config.disableVirtualBackground=true");
  });

  it("an expired or unknown door is closed", () => {
    const t = NOW.getTime();
    expect(stillOpen(undefined, t)).toBe(false);
    expect(stillOpen({ until: new Date(t - 1).toISOString() }, t)).toBe(false);
    expect(stillOpen({ until: new Date(t + 60_000).toISOString() }, t)).toBe(true);
    expect(stillOpen({ startsAt: new Date(t - 2 * 3_600_000).toISOString() }, t)).toBe(true);
    expect(stillOpen({ startsAt: new Date(t - 4 * 3_600_000).toISOString() }, t)).toBe(false);
  });

  it("a blocked microphone reads as blocked; a missing camera as missing", () => {
    expect(deniedReason({ name: "NotAllowedError" })).toBe("blocked");
    expect(deniedReason({ name: "NotFoundError" })).toBe("missing");
    expect(deniedReason(null)).toBe("other");
  });

  it("the page creates the room, the iframe and getUserMedia only behind the tap", () => {
    const src = readFileSync("app/call/[id]/page.tsx", "utf8");
    // The only getUserMedia call is inside askBrowser, which only join() calls.
    expect(src.match(/getUserMedia\(/g)).toHaveLength(1);
    expect(src).toMatch(/async function askBrowser/);
    expect(src.match(/askBrowser\(/g)?.length).toBe(3); // the definition and two calls, both in join()
    // The Jitsi effect returns unless the phase is "in", and the iframe renders only in that phase.
    expect(src).toMatch(/if \(!inRoom \|\| !info \|\| !media\) return;/);
    expect(src).toMatch(/phase === "in" && mediaAllowed\(phase\) && info && media/);
    // No direct public room links anywhere in the join paths.
    expect(src).not.toMatch(/meet\.jit\.si/);
    expect(readFileSync("components/event-card.tsx", "utf8")).not.toMatch(/roomUrl\(/);
  });
});

describe("door participants", () => {
  it("alerts each invitee with neutral copy and alerts the host when an invitee joins", async () => {
    const { knock } = await open("arjun", { invites: ["dadi", "leo"], note: "Private message" });
    await pushIdle();
    expect(outbox.map(({ memberId, msg }) => [memberId, msg.body, msg.url])).toEqual([
      ["dadi", "Arjun opened the door for you. Join?", `/call/${knock.id}`],
      ["leo", "Arjun opened the door for you. Join?", `/call/${knock.id}`],
    ]);
    clearOutbox();
    const joined = (member: string) => sitPost(authedJson("http://t/api/sit", { action: "joined", id: knock.id }, member));
    expect((await joined("priya")).status).toBe(404);
    expect((await joined("dadi")).status).toBe(200);
    expect((await joined("dadi")).status).toBe(200);
    await pushIdle();
    expect(outbox.map(({ memberId, msg }) => [memberId, msg.body, msg.url])).toEqual([["arjun", "Maa joined you", `/call/${knock.id}`]]);
  });
});

it("a planned tea invitation alerts the invited person and opens the call", async () => {
  const res = await sitPost(authedJson("http://t/api/sit", {
    action: "sit", reason: "chai", title: "Private title", startsAt: NOW.toISOString(), invites: ["dadi"], note: "Private note",
  }, "arjun"));
  expect(res.status).toBe(201);
  const { sitting } = await json<{ sitting: { id: string } }>(res);
  await pushIdle();
  expect(outbox.map(({ memberId, msg }) => [memberId, msg.body, msg.url])).toEqual([["dadi", "Arjun invited you for tea", `/call/${sitting.id}`]]);
});
