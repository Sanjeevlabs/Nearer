// Email one-time codes for sign-in. Passwordless: Supabase Auth sends a
// 6-digit code (the email template must include {{ .Token }}). Mock mode
// accepts 000000 and sends nothing, so demos and tests never need email.
import { createClient } from "@supabase/supabase-js";

export const MOCK_OTP = "000000";

function authClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * "mock" only when MOCK=true is set on purpose (demos, tests). A missing model
 * key never opens sign-in: without Supabase Auth in production, codes fail.
 */
function otpMode(): "live" | "mock" | "off" {
  if (process.env.MOCK === "true") return "mock";
  if (authClient()) return "live";
  return process.env.NODE_ENV === "production" ? "off" : "mock";
}
function otpLive(): boolean {
  return otpMode() === "live";
}

export async function sendCode(email: string): Promise<{ ok: boolean; mock: boolean }> {
  if (otpMode() === "off") return { ok: false, mock: false };
  if (!otpLive()) return { ok: true, mock: true };
  const sb = authClient();
  if (!sb) return { ok: false, mock: false };
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  return { ok: !error, mock: false };
}

export async function verifyCode(email: string, code: string): Promise<boolean> {
  if (otpMode() === "off") return false;
  if (!otpLive()) return code === MOCK_OTP;
  const sb = authClient();
  if (!sb) return false;
  const { error } = await sb.auth.verifyOtp({ email, token: code, type: "email" });
  return !error;
}

/**
 * Who signed in, from a Supabase Auth session token (Google, a magic link, or
 * a phone code verified in the browser). The login identity is the verified
 * email, or "tel:+<digits>" for phone sign-in. null when the token is invalid.
 */
export async function identityFromToken(accessToken: string): Promise<string | null> {
  if (otpMode() !== "live") return null;
  const sb = authClient();
  if (!sb) return null;
  const { data, error } = await sb.auth.getUser(accessToken);
  if (error || !data.user) return null;
  const u = data.user;
  if (u.email && (u.email_confirmed_at || u.app_metadata?.provider === "google")) return u.email.trim().toLowerCase();
  // Phone sign-in is off unless NEXT_PUBLIC_AUTH_PHONE=true (no SMS provider is set up): a phone token is no identity then.
  if (u.phone && u.phone_confirmed_at && process.env.NEXT_PUBLIC_AUTH_PHONE === "true") return `tel:+${u.phone.replace(/\D/g, "")}`;
  return null;
}

// Small in-process limiter for unauthenticated auth endpoints (per key).
const hits = new Map<string, number[]>();
export function allowAuthAttempt(key: string, max = 5, windowMs = 10 * 60_000, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export function clearAuthAttempts(): void {
  hits.clear();
}

/** Who is calling: Cloudflare address header, else the first forwarded hop, else null. */
export function callerKey(req: Request): string | null {
  return req.headers.get("cf-connecting-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;
}
