// A healthy (even empty) family never turns into "could not load" because one background refresh failed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { familyCardsFailed, resetFamilyCards, retryFamilyCards } from "@/lib/use-family";

const settle = () => new Promise((r) => setTimeout(r, 30));
const answer = (status: number, body = "{}") => vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));

describe("family cards failed flag", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetFamilyCards();
  });
  it("is set when no read has ever succeeded", async () => {
    answer(500);
    retryFamilyCards();
    await settle();
    expect(familyCardsFailed()).toBe(true);
  });
  it("stays false when a refresh fails after a success (an empty family keeps its empty state)", async () => {
    answer(200, JSON.stringify({ cards: [] }));
    retryFamilyCards();
    await settle();
    expect(familyCardsFailed()).toBe(false);
    answer(500);
    retryFamilyCards();
    await settle();
    expect(familyCardsFailed()).toBe(false);
  });
});
