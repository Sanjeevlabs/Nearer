"use client";

import { AnimatePresence, m } from "framer-motion";
import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { attachSheet, swipeCloses } from "@/lib/sheet-core";

// The app's one sheet. Every popup that is not a full-screen player uses it, so every popup closes the same easy way:
//   - a sticky header with the title and a visible close button (44pt, aria-label "Close"),
//   - Escape, a tap on the backdrop, or a swipe down (more than 80px) on the header,
//   - max-height 85dvh with the body scrolling inside, and the home-indicator inset below,
//   - role="dialog" aria-modal, focus kept inside and handed back to whatever opened it, the page behind locked.
// Small on purpose: the window imports it, so it must not pull share/poster/canvas code into the first screen's chunk.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Shown in the sticky header and read out as the dialog's name. */
  title: string;
  children: ReactNode;
  /** "auto" fits the content (up to 85dvh); "tall" always opens at 85dvh. */
  size?: "auto" | "tall";
  /** Stacking order; sheets opened from another sheet use a higher one. */
  z?: number;
  /** Visually hide the title when the content already says it (the header, the close button and the dialog name stay). */
  hideTitle?: boolean;
  /** Testing / inventory hook, set on the dialog. */
  dataUi?: string;
  /** Pinned under the scrolling body (a Done button). */
  footer?: ReactNode;
}

export function BottomSheet({ open, onClose, title, children, size = "auto", z = 80, hideTitle = false, dataUi, footer }: BottomSheetProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Whatever had focus when the sheet opened, read during render (before the sheet's own fields autofocus).
  const opener = useRef<HTMLElement | null>(null);
  if (open && !opener.current && typeof document !== "undefined") opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Open: lock the page, answer Escape (top sheet only), move focus in. Close or unmount: give it all back.
  useEffect(() => {
    if (!open || !mounted) return;
    const detach = attachSheet(
      { body: document.body, onKey: (h) => (window.addEventListener("keydown", h), () => window.removeEventListener("keydown", h)) },
      () => closeRef.current(),
      opener.current,
    );
    const root = panel.current;
    if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
    return () => {
      opener.current = null;
      detach();
    };
  }, [open, mounted]);

  // Tab stays inside the sheet.
  const trap = useCallback((e: ReactKeyboardEvent) => {
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  // Swipe down on the header (the grab bar and the title) to close.
  const drag = useRef<{ id: number; y: number } | null>(null);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const down = (e: ReactPointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { id: e.pointerId, y: e.clientY };
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
  };
  const move = (e: ReactPointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    setDy(Math.max(0, e.clientY - drag.current.y));
  };
  const up = (e: ReactPointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const moved = Math.max(0, e.clientY - drag.current.y);
    drag.current = null;
    setDragging(false);
    setDy(0);
    if (swipeCloses(moved)) closeRef.current();
  };
  const cancel = () => {
    drag.current = null;
    setDragging(false);
    setDy(0);
  };

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div ref={dialog} className="fixed inset-0 flex items-end justify-center text-ink" style={{ zIndex: z }} role="dialog" aria-modal="true" aria-labelledby={titleId} data-ui={dataUi} onClick={(e) => e.stopPropagation()} onKeyDown={trap}>
          <m.div aria-hidden="true" data-sheet-backdrop className="absolute inset-0 bg-black/35" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <div className={`relative w-full max-w-[480px] ${dragging ? "" : "transition-transform duration-200 ease-out motion-reduce:transition-none"}`} style={{ transform: dy ? `translateY(${dy}px)` : undefined }}>
            <m.div
              ref={panel}
              tabIndex={-1}
              data-sheet-panel
              className={`relative flex w-full flex-col overflow-hidden rounded-t-[32px] bg-paper shadow-frost outline-none ${size === "tall" ? "h-[85dvh]" : ""}`}
              style={{ maxHeight: "85dvh" }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 36 }}
            >
              <div
                data-sheet-header
                className="relative z-10 shrink-0 cursor-grab touch-none select-none bg-paper px-4 pt-2"
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={cancel}
              >
                <span className="mx-auto mb-1 block h-1.5 w-10 rounded-full bg-black/15" aria-hidden="true" />
                <div className="flex min-h-11 items-center justify-between gap-2">
                  <h2 id={titleId} className={hideTitle ? "sr-only" : "m-0 min-w-0 flex-1 text-title"}>
                    {title}
                  </h2>
                  {hideTitle && <span className="flex-1" />}
                  <button type="button" aria-label="Close" onClick={onClose} className="press -mr-2 grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft">
                    <X size={20} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div data-sheet-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 pt-1">
                {children}
              </div>
              {footer ? <div className="shrink-0 px-4 pt-2">{footer}</div> : null}
              <div className="shrink-0" style={{ height: "calc(8px + env(safe-area-inset-bottom))" }} aria-hidden="true" />
            </m.div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
