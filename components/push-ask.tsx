"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/kit";
import { PUSH_FIRST_ACTION, hasPushFirstAction, askIsPaused, enableNotifications, pauseAsk, pushIsOn, pushSupport, serverVapidKey, type PushSupport } from "@/lib/web-push";

// A soft ask, never on load by itself and never a browser prompt until the person taps
// "Turn on". "Not now" keeps it away for 30 days on this device. Only shown when this
// server can actually push and this device has not said yes.

type Phase = "hidden" | "ask" | "install" | "working" | "done" | "denied";

export function PushAsk({ className = "" }: { className?: string }) {
  const [vapid, setVapid] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("hidden");
  const [support, setSupport] = useState<PushSupport>("unsupported");
  useEffect(() => {
    let live = true;
    const show = async () => {
      if (!hasPushFirstAction()) return;
      const s = pushSupport();
      if (s === "unsupported" || s === "blocked" || askIsPaused()) return;
      const cfg = await fetch("/api/push/settings", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ configured?: { app?: boolean; web?: boolean } }>) : null))
        .catch(() => null);
      const configured = s === "native" ? cfg?.configured?.app : cfg?.configured?.web;
      if (!configured || (await pushIsOn())) return;
      const key = s === "ready" ? await serverVapidKey() : null;
      if (!live || (s === "ready" && !key)) return;
      setVapid(key);
      setSupport(s);
      setPhase(s === "needs-install" ? "install" : "ask");
    };
    void show();
    const onAction = () => void show();
    window.addEventListener(PUSH_FIRST_ACTION, onAction);
    return () => {
      live = false;
      window.removeEventListener(PUSH_FIRST_ACTION, onAction);
    };
  }, []);

  if (phase === "hidden") return null;

  const later = () => {
    pauseAsk();
    setPhase("hidden");
  };
  const turnOn = async () => {
    setPhase("working");
    const r = await enableNotifications(vapid);
    setPhase(r === "on" ? "done" : r === "needs-install" ? "install" : r === "denied" ? "denied" : "ask");
  };

  const pill = "press flex h-11 items-center justify-center rounded-full px-5 text-callout font-semibold";
  return (
    <section aria-label="Notifications" data-ui="push-ask" className={`rounded-card bg-card p-4 shadow-card ${className}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-well text-ink-soft" aria-hidden="true">
          <Icon name="bell" size={20} />
        </span>
        <div className="min-w-0 flex-1" aria-live="polite">
          {phase === "done" ? (
            <p className="m-0 text-body font-semibold">Done. You&rsquo;ll get a gentle note when family sends you something.</p>
          ) : phase === "denied" ? (
            <>
              <p className="m-0 text-body font-semibold">Notifications are off for now.</p>
              <p className="m-0 mt-1 text-footnote text-ink-soft">You can allow them any time in your {support === "native" ? "phone" : "browser"} settings.</p>
            </>
          ) : phase === "install" ? (
            <>
              <p className="m-0 text-body font-semibold">Add Nearer to your Home Screen first</p>
              <p className="m-0 mt-1 text-footnote text-ink-soft">On iPhone and iPad, notes only work from the Home Screen. Tap Share, then Add to Home Screen, and open Nearer from there.</p>
            </>
          ) : (
            <>
              <p className="m-0 text-body font-semibold">Get a gentle note when family sends you something</p>
              <p className="m-0 mt-1 text-footnote text-ink-soft">A few a day at most, and none at night.</p>
            </>
          )}
          {(phase === "ask" || phase === "working") && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={phase === "working"} onClick={() => void turnOn()} className={`${pill} bg-accent text-accent-ink disabled:opacity-60`}>
                {phase === "working" ? "Turning on…" : "Turn on"}
              </button>
              <button type="button" disabled={phase === "working"} onClick={later} className={`${pill} bg-well text-ink`}>
                Not now
              </button>
            </div>
          )}
          {phase === "install" && (
            <div className="mt-3">
              <button type="button" onClick={later} className={`${pill} bg-well text-ink`}>
                Got it
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
