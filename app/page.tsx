"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Courtyard } from "@/components/courtyard";
import { CourtyardProvider, prefetchCourtyard } from "@/lib/courtyard-data";
import { useShell } from "@/components/shell";
import { useViewer } from "@/components/viewer";
import { WindowLoading } from "@/components/window-hero";
import { WINDOW_PHOTO_HEIGHT } from "@/lib/hero";
import { resetFamilyCards } from "@/lib/use-family";

import { hasEntered, isInstalledApp, markEntered } from "@/lib/entered";
import { isKid } from "@/lib/kids";
import { Mark } from "@/components/brand";

const DOOR_KEY = "aangan:door";

// Each person needs one of these four: the window (signed in, door closed), the courtyard
// (above, door open), the landing (signed out) or the door itself (only when it swings).
// The others stay out of the first download; the likely next one is fetched while idle.
const LiteWindow = dynamic(() => import("@/components/window").then((x) => x.LiteWindow), { ssr: false, loading: () => <WindowLoading /> });
const KidHome = dynamic(() => import("@/components/kid-home").then((x) => x.KidHome), { ssr: false, loading: () => <WindowLoading /> });
const Landing = dynamic(() => import("@/components/welcome").then((x) => x.Landing), { ssr: false });
const HomeSite = dynamic(() => import("@/components/home-site").then((x) => x.HomeSite), { ssr: false });
const DoorTransition = dynamic(() => import("@/components/door").then((x) => x.DoorTransition), { ssr: false });

/**
 * What the server sends and the phone paints before any script has run. Never a photo.
 * Plain paper and the mark, unless the inline hint in app/layout.tsx says this person already
 * stepped inside: then the drawn window frame (no sky drawn yet, nothing claimed about it) in
 * the box the window uses, or, behind the open door, the courtyard's drawn header band.
 * Both are small static SVGs, so the first large paint does not wait for the bundle.
 */
function CheckingShell() {
  return (
    <div className="fixed inset-0 z-30 bg-paper" aria-busy="true" aria-label="Opening Nearer">
      <div className="pre-mark fixed inset-0 grid place-items-center" aria-hidden="true">
        <Mark size={72} />
      </div>
      <div className="pre-window mx-auto w-full max-w-[480px] overflow-hidden" style={{ height: WINDOW_PHOTO_HEIGHT }} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/window/frame-window.svg" alt="" fetchPriority="high" className="window-scene block h-full w-full object-cover" />
      </div>
      <div className="pre-court mx-auto w-full max-w-[480px] px-4" style={{ paddingTop: "calc(16px + env(safe-area-inset-top))" }} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/window/courtyard-band.svg" alt="" fetchPriority="high" className="block h-[150px] w-full rounded-[26px] object-cover" />
      </div>
    </div>
  );
}

// Signed out -> Landing. Signed in -> LITE: the window into the other home.
// The door opens the family courtyard; it stays open for the session.
export default function Page() {
  const { setDockOn } = useShell();
  const { ready, signedIn, viewer } = useViewer();
  const [open, setOpen] = useState<boolean | null>(null);
  const [moving, setMoving] = useState<"opening" | "closing" | null>(null);
  // Once the door has swung it stays mounted, so it can fade out.
  const [doorUsed, setDoorUsed] = useState(false);
  useEffect(() => {
    if (moving) setDoorUsed(true);
  }, [moving]);

  useEffect(() => {
    let isOpen = false;
    try {
      isOpen = sessionStorage.getItem(DOOR_KEY) === "open";
    } catch {
      /* private mode */
    }
    setOpen(isOpen);
    // Start the next screen's code now, in step with the session check.
    if (!isOpen) void import("@/components/window");
    const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => void import("@/components/door"));
  }, []);

  const startDemo = useCallback(async () => {
    const res = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inviteCode: "NEARER-DEMO", memberId: "arjun" }) });
    if (res.ok) {
      resetFamilyCards();
      markEntered();
      setEntered(true);
      window.dispatchEvent(new Event("aangan:auth"));
    }
  }, []);
  // Everyone (phone or laptop) sees the home page first, even with a session from an earlier
  // day; one tap on Open Nearer (or any app route) steps inside for the rest of the session.
  // Straight in: the installed app, ?demo=1, and anyone who already stepped inside.
  const [entered, setEntered] = useState<boolean | null>(null);
  const [direct, setDirect] = useState(false);
  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).get("demo") === "1";
    if (demo) markEntered();
    const skip = demo || isInstalledApp();
    setDirect(skip);
    setEntered(skip || hasEntered());
  }, []);

  // A child never gets the grown-ups' window or courtyard: their first screen is kid-home.
  const gate = !ready || open === null ? "checking" : !signedIn ? "landing" : isKid(viewer) ? "kid" : open ? "family" : "lite";

  useEffect(() => {
    if (gate === "checking") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("demo") !== "1") return;
    url.searchParams.delete("demo");
    window.history.replaceState(null, "", url.pathname + url.search);
    if (gate === "landing") void startDemo();
  }, [gate, startDemo]);

  // What is on screen. The dock is off on "/" unless this says it is the courtyard or kid-home.
  const view = gate === "checking" || entered === null ? "checking" : !signedIn ? (direct ? "landing" : "site") : !entered ? "site" : gate;
  const dock = view === "family" || view === "kid";
  useEffect(() => {
    setDockOn(dock);
    return () => setDockOn(false);
  }, [dock, setDockOn]);

  const settle = useCallback(() => {
    const next = moving === "opening";
    try {
      sessionStorage.setItem(DOOR_KEY, next ? "open" : "closed");
    } catch {
      /* private mode */
    }
    setOpen(next);
    setMoving(null);
    window.scrollTo(0, 0);
  }, [moving]);

  if (view === "checking") return <CheckingShell />;
  if (view === "landing") return <Landing onDemo={startDemo} />;
  if (view === "site")
    return (
      <HomeSite
        onDemo={startDemo}
        signedIn={signedIn}
        onEnter={() => {
          markEntered();
          setEntered(true);
        }}
      />
    );
  if (view === "kid") return <KidHome />;
  return (
    <>
      {view === "lite" ? (
        <LiteWindow
          onOpenDoor={() => {
            // The courtyard's payload is read while the door swings, not after it.
            prefetchCourtyard();
            setMoving("opening");
          }}
        />
      ) : (
        // Keyed by family: switching sides starts the courtyard afresh, so nothing of the last side stays.
        <CourtyardProvider key={viewer.familyId}>
          <Courtyard onCloseDoor={() => setMoving("closing")} />
        </CourtyardProvider>
      )}
      {(moving || doorUsed) && <DoorTransition state={moving} onDone={settle} />}
    </>
  );
}
