import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let appUrlListener: ((e: { url: string }) => void) | null = null;
let registrationListener: ((t: { value: string }) => void) | null = null;

vi.mock("@capacitor/haptics", () => ({
  ImpactStyle: { Light: "LIGHT", Medium: "MEDIUM", Heavy: "HEAVY" },
  NotificationType: { Success: "SUCCESS", Warning: "WARNING", Error: "ERROR" },
  Haptics: {
    impact: async (o: { style: string }) => void calls.push(`impact:${o.style}`),
    notification: async (o: { type: string }) => void calls.push(`notify:${o.type}`),
    selectionChanged: async () => void calls.push("selection"),
  },
}));
vi.mock("@capacitor/browser", () => ({
  Browser: { open: async (o: { url: string }) => void calls.push(`open:${o.url}`), close: async () => void calls.push("close") },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: async (o: { url?: string }) => void calls.push(`share:${o.url}`) } }));
vi.mock("@capacitor/status-bar", () => ({
  Style: { Light: "LIGHT", Dark: "DARK" },
  StatusBar: { setStyle: async (o: { style: string }) => void calls.push(`style:${o.style}`), setOverlaysWebView: async () => void calls.push("overlay") },
}));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: async (_: string, fn: (e: { url: string }) => void) => {
      appUrlListener = fn;
      return { remove: async () => void calls.push("removed") };
    },
  },
}));
vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    checkPermissions: async () => ({ receive: "prompt" }),
    requestPermissions: async () => ({ receive: "granted" }),
    addListener: async (ev: string, fn: (t: { value: string }) => void) => {
      if (ev === "registration") registrationListener = fn;
      return { remove: async () => undefined };
    },
    register: async () => {
      calls.push("register");
      setTimeout(() => registrationListener?.({ value: "tok-123" }), 0);
    },
  },
}));

import * as native from "@/lib/native";

const g = globalThis as unknown as { window?: unknown; navigator?: unknown };
const tick = () => new Promise((r) => setTimeout(r, 5));
/** Wait (up to ~1 s) for a condition that follows a dynamic import, whose timing a busy runner stretches. */
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await tick();
}

function fakeWindow(nativeApp: boolean, platform = "android") {
  g.window = {
    location: { origin: "https://aangan.example" },
    open: (u: string) => calls.push(`window.open:${u}`),
    Capacitor: nativeApp ? { isNativePlatform: () => true, getPlatform: () => platform } : undefined,
  };
}

beforeEach(() => {
  calls.length = 0;
  appUrlListener = null;
});
afterEach(() => {
  delete g.window;
  vi.unstubAllGlobals();
});

describe("urlToRoute", () => {
  it("maps the custom scheme to an in-app route", () => {
    expect(native.urlToRoute("app.aangan.family://auth/callback?code=abc")).toBe("/auth/callback?code=abc");
    expect(native.urlToRoute("app.aangan.family://auth/callback#access_token=t")).toBe("/auth/callback#access_token=t");
  });
  it("maps App Links on our origin and rejects other hosts", () => {
    expect(native.urlToRoute("https://aangan.example/auth/callback?code=1", "https://aangan.example")).toBe("/auth/callback?code=1");
    expect(native.urlToRoute("https://evil.example/auth/callback", "https://aangan.example")).toBeNull();
  });
  it("rejects junk and other schemes", () => {
    expect(native.urlToRoute("not a url")).toBeNull();
    expect(native.urlToRoute("javascript:alert(1)")).toBeNull();
    expect(native.urlToRoute("http://aangan.example/auth/callback")).toBeNull();
  });
});

describe("on the web (and server) every helper is a safe no-op", () => {
  it("works with no window at all", async () => {
    expect(native.isNative()).toBe(false);
    expect(native.platform()).toBe("web");
    await native.haptic("success");
    await native.setStatusBar();
    expect(await native.registerPush()).toBeNull();
    expect(native.onAppUrlOpen(() => undefined)).toBeTypeOf("function");
    expect(calls).toEqual([]);
  });
  it("falls back to window.open and navigator.share", async () => {
    fakeWindow(false);
    expect(native.authRedirectUrl("oauth")).toBe("https://aangan.example/auth/callback");
    await native.openExternal("https://accounts.google.com/x");
    expect(calls).toEqual(["window.open:https://accounts.google.com/x"]);
    expect(await native.share({ url: "u" })).toBe(false);
    const webShare = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { share: webShare });
    expect(await native.share({ title: "t", url: "u" })).toBe(true);
    expect(webShare).toHaveBeenCalledOnce();
  });
});

describe("in the native app", () => {
  it("detects Capacitor and uses the custom scheme for OAuth", () => {
    fakeWindow(true, "ios");
    expect(native.isNative()).toBe(true);
    expect(native.platform()).toBe("ios");
    expect(native.authRedirectUrl("oauth")).toBe("app.aangan.family://auth/callback");
    expect(native.authRedirectUrl("email")).toBe("https://aangan.example/auth/callback");
  });
  it("calls the plugins", async () => {
    fakeWindow(true);
    await native.haptic("light");
    await native.haptic("success");
    await native.haptic("selection");
    await native.openExternal("https://accounts.google.com/o");
    await native.setStatusBar();
    expect(await native.share({ url: "https://aangan.example/x" })).toBe(true);
    expect(calls).toEqual(["impact:LIGHT", "notify:SUCCESS", "selection", "open:https://accounts.google.com/o", "style:LIGHT", "overlay", "share:https://aangan.example/x"]);
  });
  it("routes appUrlOpen and closes the sign-in browser", async () => {
    fakeWindow(true);
    const routes: string[] = [];
    const off = native.onAppUrlOpen((r) => routes.push(r));
    await tick();
    appUrlListener?.({ url: "app.aangan.family://auth/callback?code=z" });
    appUrlListener?.({ url: "https://elsewhere.example/" });
    await until(() => calls.includes("close"));
    expect(routes).toEqual(["/auth/callback?code=z"]);
    expect(calls).toContain("close");
    off();
    await until(() => calls.includes("removed"));
    expect(calls).toContain("removed");
  });
  it("asks permission and returns the push token", async () => {
    fakeWindow(true);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect(await native.registerPush()).toBe("tok-123");
    expect(calls).toContain("register");
    info.mockRestore();
  });
});
