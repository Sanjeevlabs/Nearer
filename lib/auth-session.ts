// Shared by the sign-in screens: turn a Supabase session into Nearer's own session
// (POST /api/auth/verify), and decide when the Supabase session is dropped.
// Kept free of React and the browser so tests can drive it with a fake client.

export interface SessionClient {
  auth: {
    getSession(): Promise<{ data: { session: { access_token: string; user?: { email?: string | null } } | null } }>;
    signOut(opts: { scope: "local" }): Promise<unknown>;
  };
}

export type VerifyOutcome = { ok: true; welcome?: string; status?: string } | { ok: false; error: string };

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
  let data: { error?: string; welcome?: string; status?: string } = {};
  try {
    const res = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    ok = res.ok;
    data = (await res.json().catch(() => ({}))) as typeof data;
  } catch {
    data = { error: "failed" };
  }
  const error = data.error ?? "failed";
  if (ok || !keepSession(error)) void sb.auth.signOut({ scope: "local" });
  return ok ? { ok: true, welcome: data.welcome, status: data.status } : { ok: false, error };
}
