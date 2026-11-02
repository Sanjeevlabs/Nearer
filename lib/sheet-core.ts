// The sheet's behaviour without the DOM: which open sheet answers Escape, when the page behind is locked, where
// focus goes back to, how far a swipe must travel. components/ui/bottom-sheet.tsx wires it to the real document;
// tests/bottom-sheet.test.ts drives it with a fake one.

export const SWIPE_CLOSE_PX = 80;

/** A swipe down on the header closes the sheet once it passes 80px. */
export const swipeCloses = (dy: number): boolean => dy > SWIPE_CLOSE_PX;

export interface FocusTarget {
  isConnected: boolean;
  focus(opts?: { preventScroll?: boolean }): void;
}

export interface SheetEnv {
  body: { style: { overflow: string } };
  /** Listen for keydown on the window; returns the unlisten. */
  onKey(handler: (e: { key: string; preventDefault(): void }) => void): () => void;
}

// Open sheets, topmost last: Escape closes only the top one; the page stays locked until the last closes.
const open: symbol[] = [];
let before = "";

/** A sheet opened: lock the page, answer Escape (if topmost). Returns what to call when it closes: unlock, and hand focus back to `opener`. */
export function attachSheet(env: SheetEnv, onClose: () => void, opener: FocusTarget | null): () => void {
  const id = Symbol("sheet");
  if (open.length === 0) {
    before = env.body.style.overflow;
    env.body.style.overflow = "hidden";
  }
  open.push(id);
  const off = env.onKey((e) => {
    if (e.key === "Escape" && open[open.length - 1] === id) {
      e.preventDefault();
      onClose();
    }
  });
  return () => {
    off();
    const at = open.indexOf(id);
    if (at >= 0) open.splice(at, 1);
    if (open.length === 0) env.body.style.overflow = before;
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  };
}
