"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Courtyard } from "@/components/courtyard";
import { CourtyardProvider } from "@/lib/courtyard-data";
import { useShell } from "@/components/shell";
import { useViewer } from "@/components/viewer";
import { Photo } from "@/components/ui/kit";
import { HERO_SIZES } from "@/lib/hero";
import { resetFamilyCards } from "@/lib/use-family";

import { hasEntered, markEntered } from "@/lib/entered";

const DOOR_KEY = "aangan:door";

// Each person needs one of these four: the window (signed in, door closed), the courtyard
// (above, door open), the landing (signed out) or the door itself (only when it swings).
// The others stay out of the first download; the likely next one is fetched while idle.
const LiteWindow = dynamic(() => import("@/components/window").then((x) => x.LiteWindow), { ssr: false, loading: () => <div className="lite-ground fixed inset-0 z-30" aria-busy="true" aria-label="Opening Aangan" /> });
const Landing = dynamic(() => import("@/components/welcome").then((x) => x.Landing), { ssr: false });
const HomeSite = dynamic(() => import("@/components/home-site").then((x) => x.HomeSite), { ssr: false });
const DoorTransition = dynamic(() => import("@/components/door").then((x) => x.DoorTransition), { ssr: false });

/**
 * What the server sends and the phone paints before any script has run. Behind the
 * door (the inline script in app/layout.tsx sets html[data-door=open]) that is the
 * courtyard's header photo, in the box the real header uses, so the largest paint
 * does not wait for the bundle; otherwise the plain dark ground. See .door-hero in globals.css.
 */
function CheckingShell() {
  return (
    <div className="lite-ground checking-ground fixed inset-0 z-30" aria-busy="true" aria-label="Opening Aangan">
      <div className="door-hero mx-auto w-full max-w-[480px] px-5" style={{ paddingTop: "calc(32px + env(safe-area-inset-top))" }} aria-hidden="true">
        <div className="relative h-[150px] overflow-hidden rounded-[26px] bg-[#2a211b]">
          <Photo src="/demo/courtyard.jpg" alt="" sizes={HERO_SIZES} position="center 55%" />
        </div>
      </div>
    </div>
  );
}

// Signed out -> Landing. Signed in -> LITE: the window into the other home.
// The door opens the family courtyard; it stays open for the session.
export default function Page() {
  const { setChromeHidden } = useShell();
  const { ready, signedIn } = useViewer();
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

  // Wide screens see the home page; phones go straight to the app.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const startDemo = useCallback(async () => {
    const res = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inviteCode: "AANGAN-DEMO", memberId: "arjun" }) });
    if (res.ok) {
      resetFamilyCards();
      markEntered();
      setEntered(true);
      window.dispatchEvent(new Event("aangan:auth"));
    }
  }, []);
  // A laptop visitor sees the home page first, even with a session from an
  // earlier day; one tap on Open Aangan (or any app route) steps inside.
  const [entered, setEntered] = useState<boolean | null>(null);
  useEffect(() => setEntered(hasEntered()), []);

  const gate = !ready || open === null ? "checking" : !signedIn ? "landing" : open ? "family" : "lite";

  useEffect(() => {
    if (gate === "checking") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("demo") !== "1") return;
    url.searchParams.delete("demo");
    window.history.replaceState(null, "", url.pathname + url.search);
    if (gate === "landing") void startDemo();
  }, [gate, startDemo]);

  useEffect(() => {
    setChromeHidden(gate !== "family");
  }, [gate, setChromeHidden]);

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

  if (gate === "checking" || (wide && entered === null)) return <CheckingShell />;
  if (gate === "landing") return wide ? <HomeSite onDemo={startDemo} /> : <Landing onDemo={startDemo} />;
  if (wide && !entered)
    return (
      <HomeSite
        onDemo={startDemo}
        signedIn
        onEnter={() => {
          markEntered();
          setEntered(true);
        }}
      />
    );
  return (
    <>
      {gate === "lite" ? <LiteWindow onOpenDoor={() => setMoving("opening")} /> : (
        <CourtyardProvider>
          <Courtyard onCloseDoor={() => setMoving("closing")} />
        </CourtyardProvider>
      )}
      {(moving || doorUsed) && <DoorTransition state={moving} onDone={settle} />}
    </>
  );
}
