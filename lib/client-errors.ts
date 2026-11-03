// Errors the app hit on someone's phone, so they get fixed before anyone has to write in.
// What is kept is deliberately thin and free of anything personal: the page (path only, ids
// blanked), the error's message, the first lines of its stack, the build, and a coarse device
// class. No names, no emails, no query strings, no member ids, no IP address.
// The pure half (sanitising) is client-safe; the store is server only: Postgres `client_errors`
// when live, memory otherwise (demo families and mock mode), the same split as lib/family-docs.ts.
import { z } from "zod";

/** A report is at most this many bytes on the wire. */
export const BEACON_MAX_BYTES = 2048;
export const ERRORS_SHOWN = 50;
export const ERRORS_KEEP_DAYS = 30;

export const UA_CLASSES = ["ios", "android", "mac", "windows", "linux", "other"] as const;
export type UaClass = (typeof UA_CLASSES)[number];

/** What a browser may send. Everything is re-cleaned on the server. */
export const BeaconBodySchema = z.object({
  route: z.string().max(300).default(""),
  message: z.string().max(600).default(""),
  stack: z.string().max(2000).default(""),
  build: z.string().max(60).default(""),
});

export interface ClientError {
  id: string;
  familyId: string;
  route: string;
  message: string;
  stack: string;
  build: string;
  ua: UaClass;
  at: string;
}

const ID_SEGMENT = /^(?:[0-9a-f]{8,}(?:-[0-9a-f]+)*|[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\d[A-Za-z0-9_-]{4,})$/i;

/** "/lane?card=abc" -> "/lane"; a long id in the path -> ":id". Never a query string or hash. */
export function cleanRoute(input: string): string {
  let path = input.trim();
  try {
    path = new URL(path, "https://x.invalid").pathname;
  } catch {
    path = path.split(/[?#]/)[0];
  }
  const clean = path
    .split("/")
    .map((s) => (ID_SEGMENT.test(s) ? ":id" : s))
    .join("/")
    .slice(0, 120);
  return clean.startsWith("/") ? clean : `/${clean}`;
}

/** Message or stack text with the personal bits taken out. */
export function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\bhttps?:\/\/[^\s)'"]+/gi, (u) => cleanRoute(u))
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[number]")
    .replace(/\b\d{5,}\b/g, "#")
    .replace(/\b[A-Za-z0-9_-]{28,}\b/g, "[token]");
}

export function uaClassOf(userAgent: string | null | undefined): UaClass {
  const ua = userAgent ?? "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
  return "other";
}

/** A clean, bounded report, or null when there is nothing to say. */
export function cleanReport(raw: unknown, userAgent: string | null | undefined): Omit<ClientError, "id" | "familyId" | "at"> | null {
  const parsed = BeaconBodySchema.safeParse(raw);
  if (!parsed.success) return null;
  const message = scrub(parsed.data.message).trim().slice(0, 200);
  if (!message) return null;
  const stack = scrub(parsed.data.stack)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("\n")
    .slice(0, 600);
  const build = /^[\w.-]{1,40}$/.test(parsed.data.build) ? parsed.data.build : "";
  return { route: cleanRoute(parsed.data.route || "/"), message, stack, build, ua: uaClassOf(userAgent) };
}

// ------------------------------------------------------------------ the store (server only)

const mem: ClientError[] = [];
const MEM_CAP = 500;

export function resetClientErrors(): void {
  mem.length = 0;
}

type Row = { id: string; family_id: string; route: string; message: string; stack: string; build: string; ua: string; at: string };
const fromRow = (r: Row): ClientError => ({ id: r.id, familyId: r.family_id, route: r.route, message: r.message, stack: r.stack, build: r.build, ua: (UA_CLASSES as readonly string[]).includes(r.ua) ? (r.ua as UaClass) : "other", at: r.at });

export async function recordClientError(familyId: string, report: Omit<ClientError, "id" | "familyId" | "at">, now: Date = new Date()): Promise<void> {
  const row: ClientError = { ...report, id: crypto.randomUUID(), familyId, at: now.toISOString() };
  const { dbFor, DbWriteError } = await import("./family-db");
  const sb = dbFor(familyId);
  if (!sb) {
    mem.unshift(row);
    mem.length = Math.min(mem.length, MEM_CAP);
    return;
  }
  const { error } = await sb.from("client_errors").insert({ id: row.id, family_id: familyId, route: row.route, message: row.message, stack: row.stack, build: row.build, ua: row.ua, at: row.at });
  if (error) throw new DbWriteError("client_errors", error.message);
}

/** The newest errors for one family, newest first. Bounded: one query, `limit` rows. */
export async function listClientErrors(familyId: string, limit = ERRORS_SHOWN): Promise<ClientError[]> {
  const { dbFor, DbReadError } = await import("./family-db");
  const sb = dbFor(familyId);
  if (!sb) return mem.filter((e) => e.familyId === familyId).slice(0, limit);
  const { data, error } = await sb.from("client_errors").select("*").eq("family_id", familyId).order("at", { ascending: false }).limit(limit);
  if (error) throw new DbReadError("client_errors", error.message);
  if (!data) return mem.filter((e) => e.familyId === familyId).slice(0, limit);
  return (data as Row[]).map(fromRow);
}

/** Old errors go (run by the daily purge). Returns how many were removed (memory only; the database does not say). */
export async function purgeClientErrors(familyId: string, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ERRORS_KEEP_DAYS * 86_400_000).toISOString();
  const { dbFor } = await import("./family-db");
  const sb = dbFor(familyId);
  if (!sb) {
    const before = mem.length;
    for (let i = mem.length - 1; i >= 0; i--) if (mem[i].familyId === familyId && mem[i].at < cutoff) mem.splice(i, 1);
    return before - mem.length;
  }
  await sb.from("client_errors").delete().eq("family_id", familyId).lt("at", cutoff);
  return 0;
}
