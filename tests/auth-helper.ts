// Test-only session helper: mints a signed cookie with the vitest
// SESSION_SECRET ("test-session-secret") and registers its session row in the
// in-memory store (mock mode). Never used outside tests.
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/lib/auth";
import { memoryInsert, newSid } from "@/lib/sessions";

/** A signed session for this person with a live server-side row. */
export function signedSession(memberId = "dadi", familyId = "demo-family", ttlMs: number = SESSION_TTL_MS): { signed: string; sid: string } {
  const sid = newSid();
  const now = Date.now();
  memoryInsert({ id: sid, memberId, familyId, createdAt: now, expiresAt: now + ttlMs, revokedAt: null, kind: "demo" });
  const signed = signSession({ familyId, memberId, sid }, ttlMs, "test-session-secret");
  if (!signed) throw new Error("test session unavailable");
  return { signed, sid };
}

export function sessionCookie(memberId = "dadi", familyId = "demo-family"): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(signedSession(memberId, familyId).signed)}`;
}

export function authedJson(url: string, body: unknown, memberId = "dadi"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie(memberId) },
    body: JSON.stringify(body),
  });
}

export function authedGet(url: string, memberId = "dadi"): Request {
  return new Request(url, { headers: { cookie: sessionCookie(memberId) } });
}
