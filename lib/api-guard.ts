// Wraps a route handler so a failed live-database write answers 503
// "save-failed" instead of a 500 or a false success, and so a sliding session's
// fresh cookie (lib/auth.ts requireSession) rides out on the response. Server only.
import { takeRenewal } from "./auth";
import { DbReadError, DbWriteError } from "./family-db";

/** Attach the sliding-session cookie a request earned, unless the route set its own. */
function withRenewal(req: unknown, res: Response): Response {
  if (!(req instanceof Request)) return res;
  const cookie = takeRenewal(req);
  if (!cookie || res.headers.has("set-cookie")) return res;
  try {
    res.headers.append("set-cookie", cookie);
    return res;
  } catch {
    // A response whose headers are frozen (a proxied fetch): rebuild it around the same body.
    const headers = new Headers(res.headers);
    headers.append("set-cookie", cookie);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
}

/**
 * The answer for a failed live-database read or write, or null for any other error.
 * A failed READ is 503 "read-failed" with no-store, never an empty list: the
 * screen shows Retry (lib/use-json.ts). Logs the error name and table only.
 */
export function dbFailureResponse(e: unknown): Response | null {
  if (e instanceof DbWriteError) {
    console.error("[api] save failed", e.message);
    return Response.json({ error: "save-failed" }, { status: 503 });
  }
  if (e instanceof DbReadError) {
    console.error("[api] read failed", e.name, e.table);
    return Response.json({ error: "read-failed" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  return null;
}

/** dbFailureResponse for a route that has no sliding-session renewal (guardWrites adds that). */
export function guardApi<A extends unknown[]>(handler: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (e) {
      const res = dbFailureResponse(e);
      if (res) return res;
      throw e;
    }
  };
}

export function guardWrites<A extends unknown[]>(handler: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return withRenewal(args[0], await handler(...args));
    } catch (e) {
      const res = dbFailureResponse(e);
      if (res) return res;
      throw e;
    }
  };
}
