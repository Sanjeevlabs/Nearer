"use client";

import { WINDOW_PHOTO_HEIGHT, WINDOW_SIZES, rememberedHero } from "@/lib/hero";
import { resolveMediaUrl } from "@/lib/media-session";
import { Photo } from "./ui/kit";

// The first screen's photograph: full-bleed, under half the screen, in a box
// whose size is fixed before the photo arrives (so nothing moves when it does).
// Shared by the window and by the loading frame in app/page.tsx, which is why it
// is small and imports nothing heavy.

export function HeroBox({ src, children }: { src: string | null; children?: React.ReactNode }) {
  return (
    <div className="relative w-full overflow-hidden bg-[#2a211b]" style={{ height: WINDOW_PHOTO_HEIGHT }}>
      {src && <Photo src={src} alt="Their home" sizes={WINDOW_SIZES} priority />}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[96px]" style={{ background: "linear-gradient(rgba(0,0,0,.38), rgba(0,0,0,0))" }} aria-hidden="true" />
      {children}
    </div>
  );
}

/** What to paint before the window's data arrives: the family's own photo this phone showed last, else nothing (plain ground). */
export function earlyHeroSrc(): string | null {
  const ref = rememberedHero();
  return ref ? resolveMediaUrl(ref) : null;
}

/** The loading frame: the photo box and quiet placeholders sized like the real thing. */
export function WindowLoading({ label = "Opening Nearer" }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-30 overflow-hidden bg-paper" aria-busy="true" aria-label={label}>
      <div className="mx-auto w-full max-w-[480px]">
        <HeroBox src={earlyHeroSrc()} />
        <div className="px-4 pt-4">
          <div className="skeleton h-[30px] w-[55%]" />
          <div className="skeleton mt-2 h-[18px] w-[70%]" />
        </div>
      </div>
    </div>
  );
}
