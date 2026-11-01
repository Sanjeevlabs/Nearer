"use client";

import { Children, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A row you swipe left and right, one card at a time, with page dots.
 * Native scroll-snap (no JS physics): fast, accessible, works with a trackpad.
 */
export function Carousel({ children, label, className, slide = "86%" }: { children: React.ReactNode; label: string; className?: string; slide?: string }) {
  const items = Children.toArray(children).filter(Boolean);
  const ref = useRef<HTMLUListElement>(null);
  const [at, setAt] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const w = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth;
      setAt(Math.round(el.scrollLeft / Math.max(1, w + 12)));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  if (!items.length) return null;
  const go = (i: number) => {
    const el = ref.current;
    const child = el?.children[i] as HTMLElement | undefined;
    if (el && child) el.scrollTo({ left: child.offsetLeft - 20, behavior: "smooth" });
  };
  return (
    <section aria-label={label} aria-roledescription="carousel" className={className}>
      <ul ref={ref} className="no-scrollbar -mx-4 m-0 flex list-none gap-3 overflow-x-auto px-4 py-1" style={{ scrollSnapType: "x mandatory", scrollPaddingInline: 16 }}>
        {items.map((child, i) => (
          <li key={i} className="shrink-0" style={{ width: items.length === 1 ? "100%" : slide, scrollSnapAlign: "start" }} aria-roledescription="slide" aria-label={`${i + 1} of ${items.length}`}>
            {child}
          </li>
        ))}
      </ul>
      {items.length > 1 && (
        <div className="mt-2.5 flex justify-center gap-1.5">
          {items.map((_, i) => (
            <button key={i} type="button" onClick={() => go(i)} aria-label={`Show ${i + 1} of ${items.length}`} className="grid h-4 w-4 place-items-center">
              <span className={cn("block h-1.5 rounded-full transition-all", i === at ? "w-4 bg-black/80" : "w-1.5 bg-black/20")} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
