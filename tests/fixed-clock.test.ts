import { describe, expect, it } from "vitest";
import { installFixedClock } from "@/lib/fixed-clock";

const NOW = "2026-11-02T06:30:00Z";
const fresh = () => ({ Date: globalThis.Date }) as unknown as typeof globalThis;

describe("installFixedClock", () => {
  it("is inert without MOCK=true", () => {
    const t = fresh();
    expect(installFixedClock({ AANGAN_FIXED_NOW: NOW }, t)).toBe(false);
    expect(t.Date).toBe(Date);
  });
  it("is inert without AANGAN_FIXED_NOW", () => {
    const t = fresh();
    expect(installFixedClock({ MOCK: "true" }, t)).toBe(false);
    expect(t.Date).toBe(Date);
  });
  it("is inert for an unparseable instant", () => {
    const t = fresh();
    expect(installFixedClock({ MOCK: "true", AANGAN_FIXED_NOW: "nope" }, t)).toBe(false);
    expect(t.Date).toBe(Date);
  });
  it("freezes now() and new Date() but not dated constructors", () => {
    const t = fresh();
    expect(installFixedClock({ MOCK: "true", AANGAN_FIXED_NOW: NOW }, t)).toBe(true);
    const D = t.Date;
    expect(D.now()).toBe(Date.parse(NOW));
    expect(new D().toISOString()).toBe("2026-11-02T06:30:00.000Z");
    expect(new D("2020-01-01T00:00:00Z").getUTCFullYear()).toBe(2020);
    expect(new D(0).getTime()).toBe(0);
    expect(D.parse("2020-01-01T00:00:00Z")).toBe(1577836800000);
    expect(new Date(5) instanceof D).toBe(true);
    expect(new D() instanceof Date).toBe(true);
  });
});
