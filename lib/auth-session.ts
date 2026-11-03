// Shared by the sign-in screens: turn a Supabase session into Nearer's own session
// (POST /api/auth/verify), and decide when the Supabase session is dropped.
// Kept free of React and the browser so tests can drive it with a fake client.

export interface SessionClient {
  auth: {
    getSession(): Promise<{ data: { session: { access_token: string; user?: { email?: string | null; user_metadata?: Record<string, unknown> | null } } | null } }>;
    signOut(opts: { scope: "local" }): Promise<unknown>;
  };
}

export type VerifyOutcome = { ok: true; welcome?: string; status?: string; existing?: boolean } | { ok: false; error: string };

/** The signed-in Supabase session, if there is one (supabase-js refreshes an expired token here). `name` is Google's full name, when it gave one. */
export async function currentSession(sb: SessionClient): Promise<{ token: string; email: string; name: string } | null> {
  try {
    const session = (await sb.auth.getSession()).data.session;
    const meta = session?.user?.user_metadata ?? {};
    const name = [meta.full_name, meta.name].find((v): v is string => typeof v === "string" && v.trim().length > 0)?.trim() ?? "";
    return session?.access_token ? { token: session.access_token, email: session.user?.email ?? "", name } : null;
  } catch {
    return null;
  }
}

/**
 * POST the Supabase token to /api/auth/verify. The Supabase session is dropped (locally) afterwards,
 * except when `keepSession(error)` says the person still needs it for their next step.
 */
export async function verifyAccessToken(
  sb: SessionClient,
  body: Record<string, unknown>,
  keepSession: (error: string) => boolean = () => false,
): Promise<VerifyOutcome> {
  let ok = false;
  let data: { error?: string; welcome?: string; status?: string; existing?: boolean } = {};
  try {
    const res = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    ok = res.ok;
    data = (await res.json().catch(() => ({}))) as typeof data;
  } catch {
    data = { error: "failed" };
  }
  const error = data.error ?? "failed";
  if (ok || !keepSession(error)) void sb.auth.signOut({ scope: "local" });
  return ok ? { ok: true, welcome: data.welcome, status: data.status, ...(data.existing ? { existing: true } : {}) } : { ok: false, error };
}

// ---- One door: sign in, then (only with no family yet) one setup screen. Pure, so tests can drive them.

/**
 * Old links: /signin?next=join&code=XYZ goes to that family's join page; ?next=create is a plain
 * sign-in now (no family yet means the setup screen anyway). Null: stay on /signin.
 */
export function legacySigninRedirect(search: string): string | null {
  const q = new URLSearchParams(search);
  if (q.get("next") !== "join") return null;
  const code = q.get("code")?.trim().slice(0, 64);
  return code ? `/join/${encodeURIComponent(code)}` : "/join";
}

/** /signin after the session ran out. */
export const EXPIRED_SIGNIN = "/signin?expired=1";

export type AfterSignin = { kind: "enter" } | { kind: "setup" } | { kind: "failed"; error: string };

/** A sign-in verify result: a family means in; no-family means the one setup screen (session kept). */
export function afterSignin(out: VerifyOutcome): AfterSignin {
  if (out.ok) return { kind: "enter" };
  return out.error === "no-family" ? { kind: "setup" } : { kind: "failed", error: out.error };
}

/**
 * What the setup screen starts with: your first name and "The {last name} family", from Google's
 * full name when it gave one, else your first name from the email ("asha.rao@…" → "Asha").
 */
export function suggestedNames(fullName: string, email: string): { firstName: string; familyName: string } {
  const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : "");
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length) return { firstName: words[0].slice(0, 40), familyName: words.length > 1 ? `The ${words[words.length - 1]} family`.slice(0, 40) : "" };
  const local = email.split("@")[0] ?? "";
  if (local.startsWith("tel:") || !/[a-z]/i.test(local)) return { firstName: "", familyName: "" };
  const first = local.split(/[._+-]/)[0].replace(/[^\p{L}]/gu, "");
  return { firstName: cap(first.toLowerCase()).slice(0, 40), familyName: "" };
}

// ---- Sign out: one ordered routine for Settings, the waiting screen and "Not you?".

export interface SignOutSteps {
  /** Abort what's in flight and refuse new /api calls: a late response must not renew the cookie we're about to clear. */
  stopPollers(): void;
  /** This device stops being pushed to (needs the session, so before it is cleared). */
  forgetPush(): Promise<void>;
  /** DELETE /api/session. */
  deleteSession(): Promise<void>;
  /** Drop the Supabase session in this browser. */
  supabaseSignOut(): Promise<void>;
  /** The saved sign-in intent, sessionStorage, any Supabase leftovers in localStorage. */
  clearStorage(): void;
  /** In-memory caches: family cards, early requests, JSON cache. */
  clearCaches(): void;
  /** Cached pages and API copies in the service worker. */
  clearServiceWorker(): void | Promise<void>;
  /** A full page load, so no in-memory state survives. */
  goTo(path: string): void;
}

export async function signOutEverywhere(steps: SignOutSteps, to = "/"): Promise<void> {
  const quiet = async (f: () => Promise<void>) => {
    try {
      await f();
    } catch {
      /* every step runs, whatever the one before did */
    }
  };
  steps.stopPollers();
  await quiet(steps.forgetPush);
  await quiet(steps.deleteSession);
  await quiet(steps.supabaseSignOut);
  for (const f of [steps.clearStorage, steps.clearCaches]) {
    try {
      f();
    } catch {
      /* ignore */
    }
  }
  // Awaited: the next page load must not find the last person's kept pages or API copies.
  await quiet(async () => {
    await steps.clearServiceWorker();
  });
  steps.goTo(to);
}

// ---- Callback failures and the signed-in shortcut.

/** Supabase keeps the PKCE verifier here (storageKey "aangan-auth" in lib/supabase-browser.ts). */
export const PKCE_VERIFIER_KEY = "aangan-auth-code-verifier";

/**
 * A `?code=` we can't exchange. The code only works in the browser that asked for it (PKCE): a magic
 * link opened on another phone or computer has no verifier there. Tell that apart from a plain failure.
 */
export function callbackFailure(o: { hasCode: boolean; hasVerifier: boolean; errorMessage?: string | null }): "other-device" | "failed" {
  if (!o.hasCode) return "failed";
  if (!o.hasVerifier) return "other-device";
  return /verifier/i.test(o.errorMessage ?? "") ? "other-device" : "failed";
}

/** /signin with a live Nearer session goes home; a waiting joiner (an older pending row) stays. */
export function signinShortcut(o: { sessionOk: boolean; status?: string }): "home" | "stay" {
  return o.sessionOk && o.status !== "pending" ? "home" : "stay";
}
