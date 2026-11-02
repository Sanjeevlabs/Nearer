import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DoorScene } from "@/components/door";

const SRCS = { closed: "/demo/door-closed-390.webp", open: "/demo/door-open-390.webp" };

const synth = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }));
type G = Record<string, unknown>;
const g = globalThis as unknown as G;

describe("the door is a photograph", () => {
  it("renders two photo panels cut from the closed photo, over the open photo", () => {
    const html = renderToStaticMarkup(createElement(DoorScene, { opening: true, reduce: false, srcs: SRCS }));
    expect(html.match(/data-door="leaf"/g)?.length).toBe(2);
    expect(html).toContain(SRCS.closed);
    expect(html).toContain(SRCS.open);
    // Left half and right half of the same image.
    expect(html).toContain("background-position:0% 0%");
    expect(html).toContain("background-position:100% 0%");
    expect(html).toContain("background-size:200% 100%");
    // Hinged on the outer edges.
    expect(html).toContain("transform-origin:left center");
    expect(html).toContain("transform-origin:right center");
    // No drawn door left behind.
    expect(html).not.toContain("radial-gradient");
  });

  it("with reduced motion shows a cross-fade of two photos, not swinging leaves", () => {
    const html = renderToStaticMarkup(createElement(DoorScene, { opening: true, reduce: true, srcs: SRCS }));
    expect(html).not.toContain('data-door="leaf"');
    expect(html).toContain('data-door="closed"');
    expect(html).toContain('data-door="beyond"');
    expect(html).not.toContain("perspective");
  });

  it("renders without any images before the sources are known", () => {
    const html = renderToStaticMarkup(createElement(DoorScene, { opening: false, reduce: false, srcs: null }));
    expect(html.match(/data-door="leaf"/g)?.length).toBe(2);
    expect(html).not.toContain("url(");
  });
});

describe("the door sound", () => {
  const saved = { window: g.window, Audio: g.Audio, navigator: g.navigator };

  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/door-synth", () => ({ synthDoorOpen: synth.open, synthDoorClose: synth.close }));
    synth.open.mockClear();
    synth.close.mockClear();
  });
  afterEach(() => {
    g.window = saved.window;
    g.Audio = saved.Audio;
    vi.doUnmock("@/lib/door-synth");
    vi.useRealTimers();
  });

  function browser(reduced: boolean) {
    vi.useFakeTimers();
    const vibrate = vi.fn();
    g.window = {
      matchMedia: () => ({ matches: reduced }),
      addEventListener: () => {},
      removeEventListener: () => {},
      setTimeout: globalThis.setTimeout,
    };
    Object.defineProperty(globalThis, "navigator", { value: { vibrate }, configurable: true });
    return vibrate;
  }

  it("falls back to the synthesis when Audio does not exist", async () => {
    browser(false);
    delete g.Audio;
    const { playDoorOpen, armDoorSound } = await import("@/lib/door-sound");
    expect(() => armDoorSound()).not.toThrow();
    expect(() => playDoorOpen()).not.toThrow();
    expect(synth.open).toHaveBeenCalledTimes(1);
  });

  it("falls back when play() is rejected", async () => {
    browser(false);
    const play = vi.fn(() => Promise.reject(new Error("NotAllowedError")));
    g.Audio = function () {
      return { canPlayType: () => "maybe", addEventListener: () => {}, play, load: () => {}, volume: 0, currentTime: 0 };
    };
    const { playDoorOpen } = await import("@/lib/door-sound");
    playDoorOpen();
    await Promise.resolve();
    await Promise.resolve();
    expect(play).toHaveBeenCalled();
    expect(synth.open).toHaveBeenCalledTimes(1);
  });

  it("plays the recording at volume 0.6 and ticks the phone at the key turn", async () => {
    const vibrate = browser(false);
    const play = vi.fn(() => Promise.resolve());
    const made: Record<string, unknown>[] = [];
    g.Audio = function () {
      const a = { canPlayType: () => "maybe", addEventListener: () => {}, play, load: () => {}, volume: 1, currentTime: 5, src: "" };
      made.push(a);
      return a;
    };
    const { playDoorOpen, KEY_TURN_MS } = await import("@/lib/door-sound");
    playDoorOpen();
    expect(play).toHaveBeenCalledTimes(1);
    expect(synth.open).not.toHaveBeenCalled();
    expect(made[0].volume).toBe(0.6);
    expect(made[0].src).toBe("/sound/door-unlock.mp3");
    expect(made[0].currentTime).toBe(0);
    vi.advanceTimersByTime(KEY_TURN_MS + 1);
    expect(vibrate).toHaveBeenCalledWith(12);
  });

  it("is silent under reduced motion", async () => {
    const vibrate = browser(true);
    const play = vi.fn(() => Promise.resolve());
    g.Audio = function () {
      return { canPlayType: () => "maybe", addEventListener: () => {}, play, load: () => {}, volume: 0, currentTime: 0 };
    };
    const { playDoorOpen, playDoorClose } = await import("@/lib/door-sound");
    playDoorOpen();
    playDoorClose();
    vi.advanceTimersByTime(1000);
    expect(play).not.toHaveBeenCalled();
    expect(synth.open).not.toHaveBeenCalled();
    expect(synth.close).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });
});
