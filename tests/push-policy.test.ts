import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, MAX_IMMEDIATE_PER_DAY, decidePush, inQuietHours, localClock, type Decision } from "@/lib/push/policy";
import type { PushCategory } from "@/lib/push/types";

// 2026-10-28 in UTC; the hour in each zone is in the name.
const at = (iso: string) => new Date(iso);
const NY = "America/New_York"; // UTC-4 on 28 Oct
const IN = "Asia/Kolkata"; // UTC+5:30

describe("quiet hours are 22:00 to 07:00 where the person is", () => {
  it("edges", () => {
    expect(inQuietHours(NY, at("2026-10-28T02:00:00Z"))).toBe(true); // 22:00 NY
    expect(inQuietHours(NY, at("2026-10-28T01:59:00Z"))).toBe(false); // 21:59
    expect(inQuietHours(NY, at("2026-10-28T10:59:00Z"))).toBe(true); // 06:59
    expect(inQuietHours(NY, at("2026-10-28T11:00:00Z"))).toBe(false); // 07:00
    expect(inQuietHours(IN, at("2026-10-28T17:00:00Z"))).toBe(true); // 22:30 IST
    expect(inQuietHours(IN, at("2026-10-28T09:00:00Z"))).toBe(false); // 14:30 IST
    expect(inQuietHours("UTC", at("2026-10-28T00:00:00Z"))).toBe(true);
    expect(inQuietHours("Not/AZone", at("2026-10-28T12:00:00Z"))).toBe(false); // falls back to UTC
  });
  it("the person's own day, not the server's", () => {
    expect(localClock(NY, at("2026-10-28T02:30:00Z"))).toEqual({ day: "2026-10-27", hour: 22 });
    expect(localClock(IN, at("2026-10-28T20:00:00Z"))).toEqual({ day: "2026-10-29", hour: 1 });
  });
});

const noon = at("2026-10-28T16:00:00Z"); // 12:00 NY
const night = at("2026-10-28T05:00:00Z"); // 01:00 NY

describe("decision table", () => {
  const rows: [string, PushCategory, Date, number, Partial<typeof DEFAULT_PREFS>, Decision][] = [
    // category, when, sent today, prefs, expected
    ["voice by day, nothing sent yet", "voice", noon, 0, {}, "now"],
    ["voice at the 6th of the day", "voice", noon, MAX_IMMEDIATE_PER_DAY - 1, {}, "now"],
    ["voice after the cap of 6: waits for the morning", "voice", noon, MAX_IMMEDIATE_PER_DAY, {}, "batch"],
    ["voice at night: waits for the morning", "voice", night, 0, {}, "batch"],
    ["lamp by day", "lamp", noon, 3, {}, "now"],
    ["lamp at night", "lamp", night, 0, {}, "batch"],
    ["ask by day", "ask", noon, 0, {}, "now"],
    ["ask over the cap", "ask", noon, 9, {}, "batch"],
    ["safety at night, always", "safety", night, 0, {}, "now"],
    ["safety over the cap, always", "safety", noon, 99, {}, "now"],
    ["voice switched off", "voice", noon, 0, { voice: false }, "skip"],
    ["lamp switched off", "lamp", noon, 0, { lamp: false }, "skip"],
    ["ask switched off", "ask", noon, 0, { asks: false }, "skip"],
    ["safety switched off by the person", "safety", night, 0, { safety: false }, "skip"],
    ["held back but no morning summary wanted: dropped", "voice", night, 0, { digest: false }, "skip"],
    ["over the cap, summary off: dropped", "voice", noon, 6, { digest: false }, "skip"],
    ["digest is not capped", "digest", noon, 99, {}, "now"],
    ["digest switched off", "digest", noon, 0, { digest: false }, "skip"],
  ];
  for (const [name, category, now, sentToday, prefs, want] of rows) {
    it(name, () => {
      expect(decidePush({ category, tz: NY, now, prefs: { ...DEFAULT_PREFS, ...prefs }, sentToday })).toBe(want);
    });
  }

  it("the cap is six", () => {
    expect(MAX_IMMEDIATE_PER_DAY).toBe(6);
  });
});
