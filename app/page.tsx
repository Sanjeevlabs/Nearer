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

import { ENTER_MS, HOUSE_KEY, entryMotion, houseValue, isInside } from "@/lib/house-entry";
import { hasEntered, isInstalledApp, markEntered } from "@/lib/entered";
import { isKid } from "@/lib/kids";
import { Mark } from "@/components/brand";

// Each person needs one of these: the window (signed in, key not yet slid), the family page
// (after the key), the landing (signed out) or the home page. The others stay out of the first
// download; the likely next one is fetched while idle.
const LiteWindow = dynamic(() => import("@/components/window").then((x) => x.LiteWindow), { ssr: false, loading: () => <WindowLoading /> });
const KidHome = dynamic(() => import("@/components/kid-home").then((x) => x.KidHome), { ssr: false, loading: () => <WindowLoading /> });
const Landing = dynamic(() => import("@/components/welcome").then((x) => x.Landing), { ssr: false });
const HomeSite = dynamic(() => import("@/components/home-site").then((x) => x.HomeSite), { ssr: false });

/**
 * What the server sends and the phone paints before any script has run. Never a photo.
 * Plain paper and the mark, unless the inline hint in app/layout.tsx says this person already
 * stepped inside: then the drawn window frame (no sky drawn yet, nothing claimed about it) in
 * the box the window uses, or, once the key has been slid, the family page's drawn header band.
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
// Sliding the key goes straight to the family page (a quick fade); it stays that way for the session.
export default function Page() {
  const { setDockOn } = useShell();
  const { ready, signedIn, viewer } = useViewer();
  const [open, setOpen] = useState<boolean | null>(null);
  // Set when the screen was changed by the person (key or back), so only that change fades in.
  const [fade, setFade] = useState(0);

  useEffect(() => {
    const push = new URLSearchParams(window.location.search).get("push");
    let isOpen = false;
    try {
      isOpen = isInside(sessionStorage.getItem(HOUSE_KEY));
    } catch {
      /* private mode */
    }
    if (push === "habit") isOpen = true;
    if (push === "lamp") isOpen = false;
    setOpen(isOpen);
    // Start the next screen's code now, in step with the session check.
    if (!isOpen) void import("@/components/window");
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
    const push = new URLSearchParams(window.location.search).get("push");
    const skip = demo || push === "lamp" || push === "habit" || isInstalledApp();
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

  // The key was slid (inside = true) or "back to the window" was tapped: change screens at once.
  // The new screen fades in over ENTER_MS (instant under reduced motion); no door, nothing swings.
  const go = useCallback((inside: boolean) => {
    try {
      sessionStorage.setItem(HOUSE_KEY, houseValue(inside));
    } catch {
      /* private mode */
    }
    let calm = false;
    try {
      calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      /* motion is fine */
    }
    setFade(entryMotion(calm).ms);
    setOpen(inside);
    window.scrollTo(0, 0);
  }, []);

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
    <div key={view} className={fade ? "enter-fade" : undefined} style={fade ? ({ "--enter-ms": `${Math.min(fade, ENTER_MS)}ms` } as React.CSSProperties) : undefined}>
      {view === "lite" ? (
        <LiteWindow
          onUnlock={() => {
            // The family page's payload is read as the page changes, not after it.
            prefetchCourtyard();
            go(true);
          }}
        />
      ) : (
        // Keyed by family: switching sides starts the family page afresh, so nothing of the last side stays.
        <CourtyardProvider key={viewer.familyId}>
          <Courtyard onBack={() => go(false)} />
        </CourtyardProvider>
      )}
    </div>
  );
}
