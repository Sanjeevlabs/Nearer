// Two touches meet (experiment): the pair channel is private, symmetric and per family,
// and the window hands it out only for the people at the viewer's window.
import { readFileSync } from "fs";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDemo } from "@/lib/store";
import { touchChannel } from "@/lib/touch-channel";
import { windowState } from "@/lib/window-server";

beforeEach(() => resetDemo());

describe("touchChannel", () => {
  it("is the same for both people, different per pair and per family, and unguessable without the secret", () => {
    const ab = touchChannel("fam", "arjun", "dadi", "s1");
    expect(ab).toMatch(/^touch:[0-9a-f]{40}$/);
    expect(touchChannel("fam", "dadi", "arjun", "s1")).toBe(ab);
    expect(touchChannel("fam", "arjun", "dada", "s1")).not.toBe(ab);
    expect(touchChannel("other", "arjun", "dadi", "s1")).not.toBe(ab);
    expect(touchChannel("fam", "arjun", "dadi", "s2")).not.toBe(ab);
    expect(ab).not.toContain("arjun");
    expect(touchChannel("fam", "arjun", "arjun", "s1")).toBeNull();
    expect(touchChannel("fam", "arjun", "dadi", "")).toBeNull();
  });

  it("the window gives one channel per person at the window, matching theirs when the viewer is at theirs", async () => {
    const arjun = await windowState("demo-family", "arjun", new Date());
    expect(arjun.touchChannel.length).toBeGreaterThan(0);
    expect(arjun.touchChannel.length).toBeLessThanOrEqual(2);
    for (const t of arjun.touchChannel) expect(t.channel).toBe(touchChannel("demo-family", "arjun", t.withId));
    const other = arjun.touchChannel[0].withId;
    const theirs = await windowState("demo-family", other, new Date());
    const back = theirs.touchChannel.find((t) => t.withId === "arjun");
    if (back) expect(back.channel).toBe(arjun.touchChannel[0].channel);
  });

  it("connects only while held: the client leaves on release and sends nothing but presence", () => {
    const src = readFileSync("lib/touch.ts", "utf8");
    expect(src).not.toMatch(/\.send\(|broadcast/);
    expect(src).toMatch(/removeChannel/);
    const win = readFileSync("components/window.tsx", "utf8");
    expect(win).toMatch(/onRelease=\{stopTouch\}/);
    expect(win).toMatch(/import\("@\/lib\/touch"\)/);
  });
});
