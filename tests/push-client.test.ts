// The phone and browser side of push: the app saves its token (and a refreshed one), forgets it at
// sign-out, opens the page a tapped notification names; the browser path asks only when told to.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listeners = new Map<string, (e: never) => void>();
const channel: unknown[] = [];
let permission = "prompt";

vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    checkPermissions: async () => ({ receive: permission }),
    requestPermissions: async () => ({ receive: (permission = "granted") }),
    createChannel: async (c: unknown) => void channel.push(c),
    addListener: async (ev: string, fn: (e: never) => void) => {
      listeners.set(ev, fn);
      return { remove: async () => void listeners.delete(ev) };
    },
    register: async () => {
      setTimeout(() => (listeners.get("registration") as ((t: { value: string }) => void) | undefined)?.({ value: "fcm-token-from-device-0123456789" }), 0);
    },
  },
}));

import * as native from "@/lib/native";
import * as webPush from "@/lib/web-push";

const g = globalThis as unknown as { window?: unknown; navigator?: unknown; localStorage?: unknown };
const requests: { url: string; method: string; body: unknown }[] = [];
const store = new Map<string, string>();
const tick = () => new Promise((r) => setTimeout(r, 5));
async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await tick();
}

beforeEach(() => {
  requests.length = 0;
  listeners.clear();
  channel.length = 0;
  store.clear();
  permission = "prompt";
  g.window = { location: { origin: "https://nearer.example" }, Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" } };
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    requests.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ ok: true });
  });
});
afterEach(() => {
  delete g.window;
  vi.unstubAllGlobals();
});

describe("in the app", () => {
  it("'Turn on' asks permission, makes the Android channel, and saves the token on the server", async () => {
    expect(await native.registerPush()).toBe("fcm-token-from-device-0123456789");
    expect(channel).toMatchObject([{ id: "family", name: "Family" }]);
    expect(requests).toEqual([{ url: "/api/push/register", method: "POST", body: { kind: "fcm", token: "fcm-token-from-device-0123456789", platform: "android" } }]);
  });

  it("a refused permission saves nothing", async () => {
    permission = "denied";
    expect(await native.registerPush()).toBeNull();
    expect(requests).toEqual([]);
  });

  it("watching: a rotated token is saved again, and a tap opens the page it names", async () => {
    permission = "granted";
    store.set("aangan:push-token", "fcm-token-from-device-0123456789");
    const opened: string[] = [];
    const stop = native.watchPush((r) => opened.push(r));
    await until(() => requests.length > 0);
    expect(requests[0].body).toMatchObject({ kind: "fcm", token: "fcm-token-from-device-0123456789" });
    (listeners.get("registration") as (t: { value: string }) => void)({ value: "rotated-token-0123456789abcdef" });
    await until(() => requests.length > 1);
    expect(requests[1].body).toMatchObject({ token: "rotated-token-0123456789abcdef" });
    (listeners.get("pushNotificationActionPerformed") as (a: unknown) => void)({ notification: { data: { url: "/lane?card=abc" } } });
    (listeners.get("pushNotificationActionPerformed") as (a: unknown) => void)({ notification: { data: { url: "https://evil.example/" } } });
    (listeners.get("pushNotificationActionPerformed") as (a: unknown) => void)({ notification: { data: { url: "//evil.example/" } } });
    expect(opened).toEqual(["/lane?card=abc"]);
    stop();
  });

  it("watching never asks for permission", async () => {
    const stop = native.watchPush(() => undefined);
    await tick();
    await tick();
    expect(permission).toBe("prompt");
    expect(requests).toEqual([]);
    stop();
  });

  it("watching does not register a fresh install with permission already granted by Android", async () => {
    permission = "granted";
    const stop = native.watchPush(() => undefined);
    await tick();
    await tick();
    expect(requests).toEqual([]);
    stop();
  });

  it("sign-out removes the saved token, once", async () => {
    await native.registerPush();
    requests.length = 0;
    await native.unregisterPush();
    expect(requests).toEqual([{ url: "/api/push/register", method: "DELETE", body: { token: "fcm-token-from-device-0123456789" } }]);
    await native.unregisterPush();
    expect(requests).toHaveLength(1);
  });

  it("pushRoute only follows paths inside the app", () => {
    expect(native.pushRoute({ url: "/inbox" })).toBe("/inbox");
    expect(native.pushRoute({ url: "/safe" })).toBe("/safe");
    for (const bad of [{ url: "http://x/y" }, { url: "//x/y" }, { url: "javascript:alert(1)" }, { url: "/a\\b" }, {}, null, undefined, { url: 5 }]) expect(native.pushRoute(bad)).toBeNull();
  });
});

describe("on the web", () => {
  // In a browser `window` is the global object, so Notification lives in both places.
  const notification = (n: unknown) => {
    vi.stubGlobal("Notification", n);
    (g.window as Record<string, unknown>).Notification = n;
  };
  const web = (ua: string, extra: Record<string, unknown> = {}) => {
    g.window = { location: { origin: "https://nearer.example" }, PushManager: function () {}, matchMedia: () => ({ matches: false }) };
    vi.stubGlobal("navigator", { userAgent: ua, maxTouchPoints: 0, serviceWorker: {}, ...extra });
    notification({ permission: "default" });
  };

  it("a browser that can push is ready; one that cannot is unsupported", () => {
    web("Mozilla/5.0 (X11; Linux x86_64) Chrome/130");
    expect(webPush.pushSupport()).toBe("ready");
    notification({ permission: "denied" });
    expect(webPush.pushSupport()).toBe("blocked");
    g.window = { location: { origin: "x" } };
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Chrome/130" });
    expect(webPush.pushSupport()).toBe("unsupported");
  });

  it("iPhone Safari that is not on the Home Screen is told to add it first; installed, it is ready", () => {
    web("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1");
    expect(webPush.pushSupport()).toBe("needs-install");
    web("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1", { standalone: true });
    expect(webPush.pushSupport()).toBe("ready");
  });

  it("'Not now' is remembered for 30 days on this device", () => {
    web("Mozilla/5.0 Chrome/130");
    const t0 = Date.UTC(2026, 9, 28);
    expect(webPush.askIsPaused(t0)).toBe(false);
    webPush.pauseAsk(t0);
    expect(webPush.askIsPaused(t0 + 29 * 86_400_000)).toBe(true);
    expect(webPush.askIsPaused(t0 + 31 * 86_400_000)).toBe(false);
    webPush.clearAskPause();
    expect(webPush.askIsPaused(t0)).toBe(false);
  });

  it("never asks the browser for permission when the server has no keys", async () => {
    web("Mozilla/5.0 Chrome/130");
    const ask = vi.fn(async () => "granted");
    notification({ permission: "default", requestPermission: ask });
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
    expect(await webPush.enableNotifications()).toBe("not-configured");
    expect(ask).not.toHaveBeenCalled();
  });
});
