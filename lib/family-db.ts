// Which store serves a family: the live database for real families and for
// each demo visitor's copy (lib/demo-sandbox.ts), the in-memory seed only for
// the seed itself (DEMO_FAMILY_IDS). With the database live nobody holds a
// session on the seed: memory isn't shared between Worker isolates, so writes
// there would vanish on the next request.
// Server only (returns the service-role client).
import type { SupabaseClient } from "@supabase/supabase-js";
import { countDbCall } from "./db-stats";
import { isSeedFamily } from "./family";
import { isDbLive, supabaseServer } from "./supabase";

/**
 * True when the database is on at all (keys present, MOCK off). Deliberately
 * independent of the model key: a missing or rotated META_API_KEY turns Muse
 * off, never the family's data.
 */
export function dbLive(): boolean {
  return process.env.MOCK !== "true" && isDbLive();
}

/**
 * A write to the live database failed. Thrown instead of quietly keeping the
 * row in this isolate's memory: on Workers memory isn't shared, so a "saved"
 * row would vanish on the next request while the caller was told it worked.
 * Routes turn it into a 503 "save-failed" (lib/api-guard.ts).
 */
export class DbWriteError extends Error {
  constructor(
    public readonly table: string,
    message: string,
  ) {
    super(`${table}: ${message}`);
    this.name = "DbWriteError";
  }
}

/**
 * The database client for this family's data, or null when it must stay in
 * memory (mock mode, no keys, or a demo family). A missing family id means
 * data that isn't tied to one family; it follows dbLive().
 */
export function dbFor(familyId: string | null | undefined): SupabaseClient | null {
  if (!dbLive()) return null;
  if (familyId && isSeedFamily(familyId)) return null;
  const sb = supabaseServer();
  return sb ? counted(sb) : null;
}

// Each from() is one PostgREST round trip; count it (lib/db-stats.ts).
const wrapped = new WeakMap<object, SupabaseClient>();
function counted(sb: SupabaseClient): SupabaseClient {
  let w = wrapped.get(sb);
  if (!w) {
    w = new Proxy(sb, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (prop === "from" && typeof v === "function") return (table: string) => (countDbCall(table), v.call(target, table));
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    wrapped.set(sb, w);
  }
  return w;
}
