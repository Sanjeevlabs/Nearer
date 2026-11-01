/**
 * Frozen server clock for the UI inventory (scripts/ui-inventory.py).
 *
 * The mock demo's screens depend on the date and hour (festival week, birthdays, "door is open"
 * notes, wish-ahead). To make docs/ui-inventory.csv a pure function of the code, the inventory
 * starts the mock server with AANGAN_FIXED_NOW=<ISO instant> and the browser gets the same instant.
 *
 * FROZEN, not "fixed start then advancing": an advancing clock would let the output depend on how
 * fast the run is (an "online within 5 min" or hour-boundary check could flip between a slow CI
 * runner and a laptop). Timers (setTimeout, performance.now) are untouched, so timeouts and
 * animations still progress; only wall-clock reads (Date.now, new Date()) are pinned.
 *
 * Inert unless BOTH MOCK=true and AANGAN_FIXED_NOW (a valid ISO instant) are set. Never active in
 * production or Cloudflare builds, which do not set AANGAN_FIXED_NOW.
 */
export function installFixedClock(env: Record<string, string | undefined> = process.env, target: typeof globalThis = globalThis): boolean {
  if (env.MOCK !== "true" || !env.AANGAN_FIXED_NOW) return false;
  const fixed = Date.parse(env.AANGAN_FIXED_NOW);
  if (!Number.isFinite(fixed)) return false;
  const Real = target.Date;
  if ((Real as unknown as { __aanganFixed?: boolean }).__aanganFixed) return true;
  const Shim: DateConstructor = new Proxy(Real, {
    construct(t, args, nt): object {
      return Reflect.construct(t, args.length === 0 ? [fixed] : args, nt === Shim ? t : nt);
    },
    apply() {
      return new Real(fixed).toString();
    },
    get(t, p, r) {
      if (p === "now") return () => fixed;
      if (p === "__aanganFixed") return true;
      return Reflect.get(t, p, r === Shim ? t : r);
    },
  });
  target.Date = Shim;
  return true;
}
