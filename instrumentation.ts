// Next's register hook. Only used to freeze the mock server's clock for the UI inventory
// (lib/fixed-clock.ts); a no-op everywhere else.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.MOCK === "true" && process.env.AANGAN_FIXED_NOW) {
    const { installFixedClock } = await import("./lib/fixed-clock");
    installFixedClock();
  }
}
