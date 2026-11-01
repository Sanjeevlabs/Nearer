// A request-scoped memo for the one lookup every route repeats: who is the
// signed-in member. requireSession, requireCan and the handlers all ask the
// database for the same row; within one request that is one round trip, not
// one per caller. Keyed by the Request object (WeakMap, so it vanishes with the
// request); a fan-in route hands its memo to the sub-requests it builds.
// Server only.
import { dbGetMember } from "./db";
import type { Member } from "./schemas";

const memos = new WeakMap<Request, Map<string, Promise<unknown>>>();

function memoOf(req: Request): Map<string, Promise<unknown>> {
  let m = memos.get(req);
  if (!m) {
    m = new Map();
    memos.set(req, m);
  }
  return m;
}

/** dbGetMember, once per (request, id). Concurrent callers share the one in-flight lookup. */
export function memberFor(req: Request, id: string): Promise<Member | undefined> {
  return once(req, `member:${id}`, () => dbGetMember(id));
}

/** Run `make` the first time `key` is asked for on this request; every later ask (concurrent or not) gets the same promise. */
export function once<T>(req: Request, key: string, make: () => Promise<T>): Promise<T> {
  const memo = memoOf(req);
  let p = memo.get(key) as Promise<T> | undefined;
  if (!p) {
    p = make();
    memo.set(key, p);
  }
  return p;
}

/** Has `key` been asked for already on this request? */
export function has(req: Request, key: string): boolean {
  return memoOf(req).has(key);
}

/** Let `child` (a sub-request built from `parent`) reuse everything `parent` has already loaded. */
export function adoptMemo(parent: Request, child: Request): void {
  memos.set(child, memoOf(parent));
}
