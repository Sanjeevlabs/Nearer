// V1 access control (Fix 3): invite code -> httpOnly signed session cookie.
// Session = base64url({familyId, memberId, exp}) + "." + HMAC-SHA256 hex,
// keyed by SESSION_SECRET. Every API route requires the session and checks
// family/member ownership; model routes are rate-limited per session;
// the cron route requires Bearer CRON_SECRET instead.
import { createHmac, timingSafeEqual } from "crypto";
import { memberFor } from "./request-memo";
import { DEMO_FAMILY_IDS as DEMO_IDS, isDemoFamily, isSeedFamily } from "./family";
import { dbLive } from "./family-db";

export const SESSION_COOKIE = "aangan_session";
const SESSION_TTL_MS = 14 * 24 * 3600 * 1000;

export interface Session {
  familyId: string;
  memberId: string;
  exp: number;
}

// Documented demo backdoor (synthetic demo data only): the welcome screen
// redeems this for demo-family when no Privacy code is at hand. Real
// families use Privacy-generated expiring codes.
export const DEMO_INVITE_CODE = "AANGAN-DEMO";
export const DEMO_FAMILY_ID = "demo-family";
/** Synthetic demo Aangans (both sides of the demo couple). */
export const DEMO_FAMILY_IDS: readonly string[] = DEMO_IDS;
export { isDemoFamily };

function secret(): string | null {
  return process.env.SESSION_SECRET ?? null;
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function b64urlDecode(s: string): string | null {
  try {
    return Buffer.from(s, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export function signSession(payload: Omit<Session, "exp">, expMs: number = SESSION_TTL_MS, key?: string): string | null {
  const k = key ?? secret();
  if (!k) return null;
  const body = b64urlEncode(JSON.stringify({ ...payload, exp: Date.now() + expMs }));
  const sig = createHmac("sha256", k).update(body).digest("hex");
  return `${body}.${sig}`;
}

export function verifySession(cookieValue: string | null | undefined, key?: string): Session | null {
  const k = key ?? secret();
  if (!k || !cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot < 1) return null;
  const body = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expected = createHmac("sha256", k).update(body).digest("hex");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const raw = b64urlDecode(body);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    if (
      typeof parsed.familyId !== "string" ||
      typeof parsed.memberId !== "string" ||
      typeof parsed.exp !== "number" ||
      parsed.exp < Date.now()
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function sessionFromRequest(req: Request, key?: string): Session | null {
  const header = req.headers.get("cookie") ?? "";
  const match = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  const session = verifySession(decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)), key);
  // With the database live, the seed is read-only: memory isn't shared
  // between server instances, so a write there would vanish. A cookie from
  // before demo copies existed sends the visitor back to the door, where the
  // demo makes them their own copy (lib/demo-sandbox.ts).
  if (session && isSeedFamily(session.familyId) && dbLive()) return null;
  return session;
}

export function sessionCookieHeader(signed: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Route guard: 401 response when the session is missing/invalid/family-mismatched. */
/** Any signed-in member. Pass a family id only when a route must pin one. */
export async function requireSession(req: Request, familyId?: string): Promise<Session | Response> {
  const session = sessionFromRequest(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (familyId && session.familyId !== familyId) return Response.json({ error: "forbidden-family" }, { status: 403 });
  // A signed cookie isn't enough: the person must still be in that family.
  // Removing someone, or their leaving, ends their session on the next request.
  const member = await memberFor(req, session.memberId);
  if (!member || member.familyId !== session.familyId) return Response.json({ error: "unauthorized" }, { status: 401 });
  // A joiner waiting for an admin has a session, but it only opens
  // GET /api/session (the "waiting" screen). Everything else stays shut.
  if (member.status === "pending") return Response.json({ error: "pending" }, { status: 403 });
  return session;
}

/** Write guard: the acting member must be the session member. */
export function requireMember(session: Session, memberId: unknown): Response | null {
  if (typeof memberId !== "string" || memberId !== session.memberId) {
    return Response.json({ error: "forbidden-member" }, { status: 403 });
  }
  return null;
}

// ---- Per-session rate limiting for model routes (30/min). ----

const MODEL_ROUTES = new Set([
  "/api/transcribe",
  "/api/translate",
  "/api/suggest",
  "/api/cards",
  "/api/gather",
  "/api/suggestions",
  "/api/kitchen",
  "/api/stories",
  "/api/together",
  "/api/keeper",
  "/api/places",
  "/api/kinship",
  "/api/albums",
  "/api/care",
  "/api/weather",
  "/api/window",
  "/api/today",
  "/api/partners/suggest",
  "/api/letters/weekly",
]);

const buckets = new Map<string, number[]>();

export function isModelRoute(pathname: string): boolean {
  return MODEL_ROUTES.has(pathname);
}

export function checkRateLimit(session: Session, pathname: string, now = Date.now(), max = 30): boolean {
  if (!isModelRoute(pathname)) return true;
  const key = `${session.memberId}:${pathname}`;
  const windowStart = now - 60_000;
  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

export function clearRateLimits(): void {
  buckets.clear();
}

export function cronAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

// ---- Permissions (lib/permissions.ts), enforced per request. ----
import type { Member } from "./schemas";

/** 403 unless the session member may do `action`. Returns the member when allowed. */
export async function requireCan(
  session: { familyId: string; memberId: string },
  action: import("./permissions").Action,
  /** The request, when the caller has it: the member is then loaded once per request (lib/request-memo.ts). */
  req?: Request,
): Promise<Member | Response> {
  const [{ dbGetMember }, { can }] = await Promise.all([import("./db"), import("./permissions")]);
  const me = await (req ? memberFor(req, session.memberId) : dbGetMember(session.memberId));
  if (!me || me.familyId !== session.familyId) return Response.json({ error: "unknown-member" }, { status: 404 });
  if (!can(me, action)) return Response.json({ error: "not-allowed", action }, { status: 403 });
  return me;
}
