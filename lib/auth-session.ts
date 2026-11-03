// Shared by the sign-in screens: turn a Supabase session into Nearer's own session
// (POST /api/auth/verify), and decide when the Supabase session is dropped.
// Kept free of React and the browser so tests can drive it with a fake client.

export interface SessionClient {
  auth: {
    getSession(): Promise<{ data: { session: { access_token: string; user?: { email?: string | null } } | null } }>;
    signOut(opts: { scope: "local" }): Promise<unknown>;
  };
}

export type VerifyOutcome = { ok: true; welcome?: string; status?: string; existing?: boolean } | { ok: false; error: string };

/** The signed-in Supabase session, if there is one (supabase-js refreshes an expired token here). */
export async function currentSession(sb: SessionClient): Promise<{ token: string; email: string } | null> {
  try {
    const session = (await sb.auth.getSession()).data.session;
    return session?.access_token ? { token: session.access_token, email: session.user?.email ?? "" } : null;
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

// ---- Identity first, then family: where each screen sends people. Pure, so tests can drive them.

export type NextKind = "create" | "join";
export interface Next {
  next: NextKind | null;
  code?: string;
}

/** ?next=create | ?next=join&code=XYZ from a query string. Anything else is no next. */
export function parseNext(search: string): Next {
  const q = new URLSearchParams(search);
  const next = q.get("next");
  if (next !== "create" && next !== "join") return { next: null };
  const code = q.get("code")?.trim().slice(0, 64);
  return next === "join" && code ? { next, code } : { next };
}

/** The family screen a next points at (the details step; the session is kept). */
export function nextHref({ next, code }: Next): string {
  if (next === "create") return "/create";
  if (next === "join") return code ? `/join?code=${encodeURIComponent(code)}` : "/join";
  return "/";
}

/** The one door: /signin, remembering what they came to do. */
export function signinHref(next: NextKind, code?: string, expired = false): string {
  const q = new URLSearchParams({ next });
  if (next === "join" && code) q.set("code", code);
  if (expired) q.set("expired", "1");
  return `/signin?${q.toString()}`;
}

/** Links into the app: via /signin when Supabase sign-in is live, straight to the form in mock mode. */
export function entryHref(live: boolean, next: NextKind, code?: string): string {
  return live ? signinHref(next, code) : nextHref({ next, code });
}

export type AfterAuth = { to: string; verify: false } | { verify: true; noFamilyTo?: string };

/**
 * After Supabase says who they are. Joining with a code goes straight to that family's form (someone
 * already in one family may join another). Everything else checks for a family first: someone who has
 * one goes in, even from "Start your family", so signing in again never makes a second family. Only
 * someone with no family yet goes on to the create form.
 */
export function afterAuth(n: Next): AfterAuth {
  if (n.next === "join") return { to: nextHref(n), verify: false };
  return n.next === "create" ? { verify: true, noFamilyTo: nextHref(n) } : { verify: true };
}

export type AfterSignin = { kind: "enter" } | { kind: "chooser" } | { kind: "failed"; error: string };

/** A signin verify result: a family means in; no-family means the chooser (session kept). */
export function afterSignin(out: VerifyOutcome): AfterSignin {
  if (out.ok) return { kind: "enter" };
  return out.error === "no-family" ? { kind: "chooser" } : { kind: "failed", error: out.error };
}

/** /create and /join in live mode need a Supabase session; without one they go to /signin. */
export function gateDecision(o: { live: boolean; hasSession: boolean; kind: NextKind; code?: string; resume?: boolean }): { stay: true } | { stay: false; to: string } {
  if (!o.live || o.hasSession || o.resume) return { stay: true };
  return { stay: false, to: signinHref(o.kind, o.code) };
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

/** /signin with a live Nearer session and nothing to do next goes home; a waiting joiner stays. */
export function signinShortcut(o: { next: NextKind | null; sessionOk: boolean; status?: string }): "home" | "stay" {
  return !o.next && o.sessionOk && o.status !== "pending" ? "home" : "stay";
}
