"use client";

import { AnimatePresence, MotionConfig, m } from "framer-motion";
import { useEffect, useState } from "react";
import { armDoorSound, playDoorClose, playDoorOpen } from "@/lib/door-sound";

// The door between the window and the house: a real photographed pair of wooden doors
// (public/demo/door-closed.jpg and the same door edited open, door-open.jpg). The closed
// photo is split into a left and a right panel; each swings inward on its outer edge to
// about 75 degrees, uncovering the open photo, then you step through. Timed to the
// recorded key and latch in lib/door-sound.ts. Reduced motion: a 200 ms cross-fade.
//
// The module is imported while the browser is idle after the window has painted
// (app/page.tsx), and only then are the door photos fetched, so none of it is on the first-load path.

const OPEN_MS = 1950;
const CLOSE_MS = 950;
const SWING_AT = 0.7; // the key and latch are done; the leaves start to move
const SWING = 0.9;
const ANGLE = 75;
const PERSPECTIVE = 1200;
const REDUCED_MS = 200;
const WALL = "#e6d9ca"; // the plaster in the photos, for the margins around the frame

/** Widths published by scripts/demo-variants.mjs; the larger one on high-density or wide screens. */
function doorSrc(name: "door-closed" | "door-open"): string {
  let w = 390;
  try {
    if (window.devicePixelRatio >= 2 || window.innerWidth >= 560) w = 780;
  } catch {
    /* default */
  }
  return `/demo/${name}-${w}.webp`;
}

let warmed = false;
/** Fetch both door photos and get the sound ready, once, off the critical path. */
export function warmDoor(): void {
  if (warmed || typeof window === "undefined") return;
  warmed = true;
  armDoorSound();
  for (const n of ["door-closed", "door-open"] as const) {
    const img = new Image();
    img.decoding = "async";
    img.src = doorSrc(n);
  }
}
if (typeof window !== "undefined") {
  const idle =
    (window as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 600));
  idle(warmDoor);
}

/** The photo, covering the screen at its own 3:4 shape; panels are cut from it by background-position. */
const STAGE: React.CSSProperties = {
  width: "max(100vw, 75dvh)",
  aspectRatio: "3 / 4",
};

export type DoorSrcs = { closed: string; open: string } | null;

/** The photographed door: closed halves swinging in over the open photo, or a cross-fade. Pure of effects, so it can be rendered on its own. */
export function DoorScene({
  opening,
  reduce,
  srcs,
}: {
  opening: boolean;
  reduce: boolean;
  srcs: DoorSrcs;
}) {
  const ease = [0.16, 0.6, 0.3, 1] as const; // ease-out
  const swing = opening
    ? { delay: SWING_AT, duration: SWING, ease }
    : { duration: 0.45, ease };
  const leaf = (side: "l" | "r") => {
    const open = side === "l" ? -ANGLE : ANGLE;
    return {
      initial: { rotateY: opening ? 0 : open },
      animate: { rotateY: opening ? open : 0 },
      transition: swing,
    };
  };
  // As a leaf turns away from the light it darkens.
  const shade = {
    initial: { opacity: opening ? 0 : 0.5 },
    animate: { opacity: opening ? 0.5 : 0 },
    transition: swing,
  };
  const panel = (side: "l" | "r"): React.CSSProperties => ({
    backgroundImage: srcs ? `url(${srcs.closed})` : undefined,
    backgroundSize: "200% 100%",
    backgroundPosition: side === "l" ? "0% 0%" : "100% 0%",
    transformOrigin: side === "l" ? "left center" : "right center",
    backfaceVisibility: "hidden",
    backgroundColor: "#8a5a34",
  });

  // Stepping through: the doorway grows as the leaves open.
  return (
    <m.div
      className="absolute left-1/2 top-1/2"
      style={{ ...STAGE, x: "-50%", y: "-50%", transformOrigin: "50% 50%" }}
      initial={{ scale: opening ? 1 : 2.2 }}
      animate={{ scale: opening && !reduce ? [1, 1, 2.2] : 1 }}
      transition={
        opening
          ? {
              duration: OPEN_MS / 1000,
              times: [0, 0.62, 1],
              ease: [0.6, 0, 0.4, 1],
            }
          : { duration: 0.4, ease }
      }
    >
      {/* what is beyond: the same door, open */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        data-door="beyond"
        style={{ backgroundImage: srcs ? `url(${srcs.open})` : undefined }}
        aria-hidden="true"
      />
      {reduce ? (
        // A quiet cross-fade, no travel.
        <m.div
          data-door="closed"
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: srcs ? `url(${srcs.closed})` : undefined }}
          initial={{ opacity: opening ? 1 : 0 }}
          animate={{ opacity: opening ? 0 : 1 }}
          transition={{ duration: REDUCED_MS / 1000 }}
          aria-hidden="true"
        />
      ) : (
        <div
          className="absolute inset-0 flex"
          style={{ perspective: PERSPECTIVE }}
          aria-hidden="true"
        >
          {(["l", "r"] as const).map((side) => (
            <m.div
              key={side}
              data-door="leaf"
              className="relative h-full w-1/2"
              style={panel(side)}
              {...leaf(side)}
            >
              <m.div className="absolute inset-0 bg-black" {...shade} />
            </m.div>
          ))}
        </div>
      )}
    </m.div>
  );
}

export function DoorTransition({
  state,
  onDone,
}: {
  state: "opening" | "closing" | null;
  onDone: () => void;
}) {
  const [reduce, setReduce] = useState(false);
  const [srcs, setSrcs] = useState<{ closed: string; open: string } | null>(
    null,
  );
  useEffect(() => {
    try {
      setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
      setReduce(false);
    }
    setSrcs({ closed: doorSrc("door-closed"), open: doorSrc("door-open") });
  }, []);
  useEffect(() => {
    if (!state) return;
    if (state === "opening") playDoorOpen();
    else playDoorClose();
    const t = window.setTimeout(
      onDone,
      reduce ? REDUCED_MS + 50 : state === "opening" ? OPEN_MS : CLOSE_MS,
    );
    return () => window.clearTimeout(t);
  }, [state, onDone, reduce]);

  const opening = state === "opening";
  return (
    <MotionConfig reducedMotion={reduce ? "always" : "never"}>
      <AnimatePresence>
        {state && (
          <m.div
            className="fixed inset-0 z-[70] overflow-hidden"
            style={{ background: WALL }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            transition={{ duration: 0.18 }}
            role="status"
            aria-live="polite"
            aria-label={opening ? "Opening home" : "Closing the door"}
          >
            <DoorScene opening={opening} reduce={reduce} srcs={srcs} />
            {/* the room beyond is bright: finish into it */}
            {opening && !reduce && (
              <m.div
                className="pointer-events-none absolute inset-0 bg-[#f6f3ee]"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0, 1] }}
                transition={{ duration: OPEN_MS / 1000, times: [0, 0.82, 1] }}
              />
            )}
          </m.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
