import { describe, expect, it } from "vitest";
import { extractJson, REASONING_TOKEN_FLOOR } from "../lib/llm";
import { PicksSchema } from "../lib/partners/suggest";

describe("extractJson (model replies to JSON)", () => {
  it("plain JSON", () => expect(extractJson('{"a":1}')).toEqual({ a: 1 }));
  it("a ```json fence", () => expect(extractJson('Here:\n```json\n{"a":2}\n```')).toEqual({ a: 2 }));
  it("a <think> block first", () => expect(extractJson('<think>pick {x}</think>{"a":3}')).toEqual({ a: 3 }));
  it("a sentence around it", () => expect(extractJson('Sure! {"a":{"b":4}} Hope that helps.')).toEqual({ a: { b: 4 } }));
  it("no JSON throws parse", () => expect(() => extractJson("no idea")).toThrow("parse"));
  it("floor leaves room for reasoning", () => expect(REASONING_TOKEN_FLOOR).toBeGreaterThanOrEqual(2000));
});

describe("PicksSchema", () => {
  it("trims a long why instead of rejecting the pick", () => {
    const r = PicksSchema.safeParse({ picks: [{ id: "x", why: "w".repeat(150) }] });
    expect(r.success && r.data.picks[0].why.length).toBe(90);
  });
});
