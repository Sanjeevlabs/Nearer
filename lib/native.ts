/**
 * Native helpers for the Capacitor shell (iOS / Android).
 *
 * The native app loads the deployed site, and Capacitor's bridge injects
 * `window.Capacitor` into it. Every helper here is safe to call on the web:
 * plugins load by dynamic import only when running natively, and each call is
 * a no-op (or a web fallback) otherwise. Nothing here throws.
 */

/** The custom URL scheme registered in AndroidManifest.xml and Info.plist. */
export const APP_SCHEME = "com.sanjeevlabs.nearer";

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function capacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap ?? null;
}

/** True inside the iOS / Android app, false in any browser (and on the server). */
export function isNative(): boolean {
  try {
    return capacitor()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** "ios" | "android" | "web". */
export function platform(): string {
  try {
    return isNative() ? (capacitor()?.getPlatform?.() ?? "web") : "web";
  } catch {
    return "web";
  }
}

/**
 * Where sign-in should come back to. In the app, OAuth returns through the
 * custom scheme (works without App Links verification); email magic links use
 * the https callback, which App Links / Universal Links route into the app.
 * On the web it is always the site's own /auth/callback.
 */
export function authRedirectUrl(kind: "oauth" | "email" = "oauth"): string {
  if (typeof window === "undefined") return "/auth/callback";
  if (isNative() && kind === "oauth") return `${APP_SCHEME}://auth/callback`;
  return `${window.location.origin}/auth/callback`;
}

/**
 * Turn a URL the OS opened the app with into an in-app route:
 *   https://<origin>/auth/callback?code=x      -> /auth/callback?code=x
 *   com.sanjeevlabs.nearer://auth/callback?code=x   -> /auth/callback?code=x
 * Returns null for anything that is not ours or not parseable.
 */
export function urlToRoute(raw: string, origin?: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol === `${APP_SCHEME}:`) {
    // The host is the first path segment: com.sanjeevlabs.nearer://auth/callback.
    const path = `/${u.host}${u.pathname === "/" ? "" : u.pathname}`.replace(/\/{2,}/g, "/");
    return `${path}${u.search}${u.hash}`;
  }
  if (u.protocol === "https:") {
    if (origin) {
      try {
        if (new URL(origin).host !== u.host) return null;
      } catch {
        return null;
      }
    }
    return `${u.pathname}${u.search}${u.hash}`;
  }
  return null;
}

/** Open a URL outside the webview (in-app browser natively, a new tab on the web). */
export async function openExternal(url: string): Promise<void> {
  try {
    if (isNative()) {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "popover" });
      return;
    }
    if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    /* nothing to open with */
  }
}

/**
 * Listen for the OS opening the app with a URL (sign-in callbacks, shared
 * links) and hand the in-app route to `cb` (e.g. router.push). Closes the
 * in-app browser left open by sign-in. Returns an unsubscribe function.
 */
export function onAppUrlOpen(cb: (route: string) => void): () => void {
  if (!isNative()) return () => undefined;
  let cancelled = false;
  let remove: (() => Promise<void>) | null = null;
  void (async () => {
    try {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("appUrlOpen", (event: { url: string }) => {
        const route = urlToRoute(event.url, typeof window !== "undefined" ? window.location.origin : undefined);
        if (!route) return;
        void import("@capacitor/browser").then(({ Browser }) => Browser.close()).catch(() => undefined);
        cb(route);
      });
      if (cancelled) void handle.remove();
      else remove = () => handle.remove();
    } catch {
      /* plugin unavailable */
    }
  })();
  return () => {
    cancelled = true;
    if (remove) void remove().catch(() => undefined);
  };
}

export type HapticKind = "light" | "medium" | "heavy" | "selection" | "success" | "warning" | "error";

/** A short tap of the Taptic Engine / vibrator. No-op on the web. */
export async function haptic(kind: HapticKind = "light"): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
    if (kind === "selection") return void (await Haptics.selectionChanged());
    if (kind === "success" || kind === "warning" || kind === "error") {
      const type = { success: NotificationType.Success, warning: NotificationType.Warning, error: NotificationType.Error }[kind];
      return void (await Haptics.notification({ type }));
    }
    const style = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }[kind];
    await Haptics.impact({ style });
  } catch {
    /* no haptics */
  }
}

/**
 * Status bar over the webview with dark text (Nearer's light paper). Pass
 * `dark: true` on dark screens for light text. No-op on the web.
 */
export async function setStatusBar(opts: { dark?: boolean } = {}): Promise<void> {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: opts.dark ? Style.Dark : Style.Light });
    if (platform() === "android") await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    /* no status bar control */
  }
}

/**
 * Ask for notification permission and register with FCM (Android) / APNs (iOS).
 * Resolves to the device token, or null on the web, on refusal, or on error.
 */
export async function registerPush(timeoutMs = 10_000): Promise<string | null> {
  if (!isNative()) return null;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return null;
    const token = await new Promise<string | null>((resolve) => {
      const handles: { remove: () => Promise<void> }[] = [];
      const done = (v: string | null) => {
        clearTimeout(timer);
        for (const h of handles) void h.remove().catch(() => undefined);
        resolve(v);
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      void PushNotifications.addListener("registration", (t: { value: string }) => done(t.value)).then((h) => handles.push(h));
      void PushNotifications.addListener("registrationError", () => done(null)).then((h) => handles.push(h));
      void PushNotifications.register().catch(() => done(null));
    });
    // TODO(push): POST the token to the server (e.g. /api/push/register) once FCM sending exists.
    if (token) console.info("[nearer] push token ready (server registration is a TODO)");
    return token;
  } catch {
    return null;
  }
}

/**
 * Share sheet: native Share plugin in the app, navigator.share on the web.
 * Resolves true when the sheet opened and was not cancelled.
 */
export async function share(data: { title?: string; text?: string; url?: string }): Promise<boolean> {
  try {
    if (isNative()) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ ...data, dialogTitle: data.title });
      return true;
    }
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share(data);
      return true;
    }
  } catch {
    /* cancelled or unsupported */
  }
  return false;
}
