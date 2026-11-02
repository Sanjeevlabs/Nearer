"use client";

import { AnimatePresence, m } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The app's one bottom sheet. Small on purpose: the window imports it, so it
// must not pull share/poster/canvas code into the first screen's chunk.

export function BottomSheet({ open, onClose, label, children, z = 80 }: { open: boolean; onClose: () => void; label: string; children: ReactNode; z?: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 flex items-end justify-center text-ink" style={{ zIndex: z }} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
          <m.button type="button" aria-label="Close" className="absolute inset-0 bg-black/35" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <m.div
            className="relative max-h-[94dvh] w-full max-w-[480px] overflow-y-auto rounded-t-[32px] bg-paper px-4 pt-3 shadow-frost"
            style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom))" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 36 }}
          >
            <span className="mx-auto mb-3 block h-1.5 w-10 rounded-full bg-black/15" aria-hidden="true" />
            {children}
          </m.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
