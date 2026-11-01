// A request-scoped memo for the one lookup every route repeats: who is the
// signed-in member. requireSession, requireCan and the handlers all ask the
// database for the same row; within one request that is one round trip, not
// one per caller. Keyed by the Request object (WeakMap, so it vanishes with the
// request); a fan-in route hands its memo to the sub-requests it builds.
// Server only.
import { dbGetMember } from "./db";
import type { Member } from "./schemas";

const memos = new WeakMap<Request, Map<string, Promise<Member | undefined>>>();

function memoOf(req: Request): Map<string, Promise<Member | undefined>> {
  let m = memos.get(req);
  if (!m) {
    m = new Map();
    memos.set(req, m);
  }
  return m;
}

/** dbGetMember, once per (request, id). Concurrent callers share the one in-flight lookup. */
export function memberFor(req: Request, id: string): Promise<Member | undefined> {
  const memo = memoOf(req);
  let p = memo.get(id);
  if (!p) {
    p = dbGetMember(id);
    memo.set(id, p);
  }
  return p;
}

/** Let `child` (a sub-request built from `parent`) reuse everything `parent` has already loaded. */
export function adoptMemo(parent: Request, child: Request): void {
  memos.set(child, memoOf(parent));
}
