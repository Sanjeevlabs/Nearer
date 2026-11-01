// Run push work without making the person's action wait for it, and without ever
// failing it. On Workers `after()` keeps the isolate alive until the work is done
// (OpenNext maps it to ctx.waitUntil); outside a request (tests, scripts) the promise
// just runs. Server only.
import { after } from "next/server";

const pending = new Set<Promise<unknown>>();

/** Start `work` now; its result is never awaited by the caller and its errors are only logged. */
export function inBackground(work: () => Promise<unknown>): void {
  let run: Promise<unknown>;
  try {
    run = work().catch((e: unknown) => console.error("[push] background failed", String(e)));
  } catch (e) {
    console.error("[push] background failed", String(e));
    return;
  }
  pending.add(run);
  void run.finally(() => pending.delete(run));
  try {
    after(() => run);
  } catch {
    /* not inside a request: the promise simply runs */
  }
}

/** Tests: wait for everything started with inBackground. */
export async function pushIdle(): Promise<void> {
  while (pending.size) await Promise.allSettled(Array.from(pending));
}
