import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as tokenGet } from "@/app/api/sit/token/route";
import { GET as roomGet } from "@/app/api/sit/room/route";
import { POST as sitPost } from "@/app/api/sit/route";
import { jaasEnabled, mintJaasToken } from "@/lib/jaas";
import { resetDemo } from "@/lib/store";
import { sessionCookie } from "./auth-helper";

const APP = "vpaas-magic-cookie-test123";
const KID = `${APP}/abc123`;
let pair: CryptoKeyPair;
let pem = "";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const decode = (s: string) => JSON.parse(new TextDecoder().decode(unb64url(s)));
const req = (url: string, member = "leo", body?: unknown) =>
  new Request(`http://test${url}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", cookie: sessionCookie(member, "demo-family") }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  pem = `-----BEGIN PRIVATE KEY-----\n${b64(der).match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;
});

beforeEach(() => resetDemo());
afterEach(() => vi.unstubAllEnvs());

const enable = (key = pem) => {
  vi.stubEnv("JAAS_APP_ID", APP);
  vi.stubEnv("JAAS_KID", KID);
  vi.stubEnv("JAAS_PRIVATE_KEY", key);
};

describe("JaaS tokens", () => {
  it("is enabled only when all three values are set", () => {
    expect(jaasEnabled()).toBe(false);
    vi.stubEnv("JAAS_APP_ID", APP);
    vi.stubEnv("JAAS_KID", KID);
    expect(jaasEnabled()).toBe(false);
    vi.stubEnv("JAAS_PRIVATE_KEY", pem);
    expect(jaasEnabled()).toBe(true);
  });

  it("mints a verifiable RS256 JWT, accepting a one-line PEM with literal \\n", async () => {
    enable(pem.replace(/\n/g, "\\n"));
    const jwt = await mintJaasToken({ room: `${APP}/Aangan-x1`, user: { id: "leo", name: "Leo", moderator: true } });
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decode(parts[0])).toEqual({ alg: "RS256", typ: "JWT", kid: KID });
    const p = decode(parts[1]);
    expect(p).toMatchObject({ aud: "jitsi", iss: "chat", sub: APP, room: "Aangan-x1" });
    expect(p.context.user).toMatchObject({ id: "leo", name: "Leo", moderator: "true" });
    expect(p.context.features.recording).toBe("false");
    expect(p.exp - p.nbf).toBeGreaterThan(7000);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pair.publicKey, unb64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    expect(ok).toBe(true);
  });
});

describe("GET /api/sit/token", () => {
  it("404s for an unknown id", async () => {
    expect((await tokenGet(req("/api/sit/token?id=nope"))).status).toBe(404);
  });

  it("falls back to public Jitsi when JaaS is not configured", async () => {
    const { knock } = (await (await sitPost(req("/api/sit", "leo", { action: "knock", minutes: 30 }))).json()) as { knock: { id: string } };
    const res = await tokenGet(req(`/api/sit/token?id=${knock.id}`, "dadi"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ provider: "jitsi", domain: "meet.jit.si", room: `Aangan-${knock.id}` });
  });

  it("returns a JaaS token, moderator only for the one who knocked", async () => {
    enable();
    const { knock } = (await (await sitPost(req("/api/sit", "leo", { action: "knock", minutes: 30 }))).json()) as { knock: { id: string } };
    const host = (await (await tokenGet(req(`/api/sit/token?id=${knock.id}`, "leo"))).json()) as { provider: string; domain: string; appId: string; room: string; jwt: string };
    expect(host).toMatchObject({ provider: "jaas", domain: "8x8.vc", appId: APP, room: `Aangan-${knock.id}` });
    expect(decode(host.jwt.split(".")[1]).context.user.moderator).toBe("true");
    const guest = (await (await tokenGet(req(`/api/sit/token?id=${knock.id}`, "dadi"))).json()) as { jwt: string };
    expect(decode(guest.jwt.split(".")[1]).context.user.moderator).toBe("false");
  });
});

describe("GET /api/sit/room", () => {
  it("404s for an unknown id", async () => {
    expect((await roomGet(req("/api/sit/room?id=nope"))).status).toBe(404);
  });

  it("gives a public Jitsi url, and no token, when JaaS is not configured", async () => {
    const { knock } = (await (await sitPost(req("/api/sit", "leo", { action: "knock", minutes: 30 }))).json()) as { knock: { id: string } };
    const res = await roomGet(req(`/api/sit/room?id=${knock.id}`, "dadi"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { url: string };
    expect(new URL(body.url).host).toBe("meet.jit.si");
    expect(body.url).toBe(`https://meet.jit.si/Aangan-${knock.id}`);
    expect(body).not.toHaveProperty("jwt");
  });

  it("follows the JaaS provider when configured, still without a token", async () => {
    enable();
    const { knock } = (await (await sitPost(req("/api/sit", "leo", { action: "knock", minutes: 30 }))).json()) as { knock: { id: string } };
    const body = (await (await roomGet(req(`/api/sit/room?id=${knock.id}`, "dadi"))).json()) as { url: string };
    expect(body.url).toBe(`https://8x8.vc/${APP}/Aangan-${knock.id}`);
    expect(body).not.toHaveProperty("jwt");
  });
});
