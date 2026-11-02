import { describe, expect, it, vi } from "vitest";
import { attachSheet, SWIPE_CLOSE_PX, swipeCloses, type SheetEnv } from "@/lib/sheet-core";

// The sheet's behaviour (components/ui/bottom-sheet.tsx wires this to the real document;
// scripts/walk.py checks the same in a real browser: the close control sits inside a 360x640 viewport,
// the close button and Escape both close, and focus goes back to the opener).

function fakeEnv() {
  const handlers = new Set<(e: { key: string; preventDefault(): void }) => void>();
  const env: SheetEnv = {
    body: { style: { overflow: "" } },
    onKey: (h) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
  };
  const press = (key: string) => handlers.forEach((h) => h({ key, preventDefault: () => undefined }));
  return { env, press, listeners: () => handlers.size };
}

describe("bottom sheet behaviour", () => {
  it("Escape calls onClose", () => {
    const { env, press } = fakeEnv();
    const onClose = vi.fn();
    const detach = attachSheet(env, onClose, null);
    press("Tab");
    expect(onClose).not.toHaveBeenCalled();
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    detach();
  });

  it("focus goes back to whatever opened it, if that is still on the page", () => {
    const { env } = fakeEnv();
    const opener = { isConnected: true, focus: vi.fn() };
    attachSheet(env, () => undefined, opener)();
    expect(opener.focus).toHaveBeenCalledTimes(1);
    const gone = { isConnected: false, focus: vi.fn() };
    attachSheet(env, () => undefined, gone)();
    expect(gone.focus).not.toHaveBeenCalled();
  });

  it("locks the page while any sheet is open and lets go after the last", () => {
    const { env } = fakeEnv();
    env.body.style.overflow = "auto";
    const a = attachSheet(env, () => undefined, null);
    expect(env.body.style.overflow).toBe("hidden");
    const b = attachSheet(env, () => undefined, null);
    a();
    expect(env.body.style.overflow).toBe("hidden");
    b();
    expect(env.body.style.overflow).toBe("auto");
  });

  it("with two sheets open, Escape closes only the top one", () => {
    const { env, press } = fakeEnv();
    const under = vi.fn();
    const top = vi.fn();
    const a = attachSheet(env, under, null);
    const b = attachSheet(env, top, null);
    press("Escape");
    expect(top).toHaveBeenCalledTimes(1);
    expect(under).not.toHaveBeenCalled();
    b();
    press("Escape");
    expect(under).toHaveBeenCalledTimes(1);
    a();
  });

  it("stops listening once closed", () => {
    const { env, press, listeners } = fakeEnv();
    const onClose = vi.fn();
    attachSheet(env, onClose, null)();
    expect(listeners()).toBe(0);
    press("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a swipe down closes past 80px, not before", () => {
    expect(SWIPE_CLOSE_PX).toBe(80);
    expect(swipeCloses(80)).toBe(false);
    expect(swipeCloses(81)).toBe(true);
    expect(swipeCloses(-200)).toBe(false);
  });
});
