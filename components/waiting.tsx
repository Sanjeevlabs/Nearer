"use client";

import { useEffect, useState } from "react";
import { signOutNow } from "@/lib/sign-out";
import { Mark } from "./brand";
import { Icon } from "./ui/kit";

const CHECK_MS = 30_000;

/**
 * A joiner whose owner/admin hasn't let them in yet. Their session opens only
 * this screen (the server answers every other API with 403 "pending"). It
 * checks again on its own every 30 s and when they come back to the tab.
 */
export function Waiting({ hostName, onCheck }: { hostName: string | null; onCheck: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const who = hostName || "your family";
  const ask = `Hi${hostName ? ` ${hostName}` : ""}, I've joined our family on Nearer. Could you let me in? (Settings, Family, Waiting to join)`;

  useEffect(() => {
    const tick = () => void onCheck();
    const id = window.setInterval(tick, CHECK_MS);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [onCheck]);

  const signOut = async () => {
    setBusy(true);
    await signOutNow();
  };

  return (
    <div className="fixed inset-0 z-30 overflow-hidden bg-[#2a211c]">
      <div className="absolute inset-0 grid place-items-center opacity-25" aria-hidden="true">
        <Mark size={160} />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/40" aria-hidden="true" />
      <main className="relative mx-auto flex h-full max-w-[480px] flex-col px-4" style={{ paddingTop: "calc(20px + env(safe-area-inset-top))", paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}>
        <p className="m-0 px-2 text-title font-bold tracking-[-0.02em] text-white drop-shadow">Nearer</p>
        <div className="flex-1" />
        <section aria-live="polite" className="glass rounded-[30px] p-6">
          <span className="relative mb-4 flex h-3 w-3" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#e8a33d] opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-[#e8a33d]" />
          </span>
          <h1 data-display className="m-0 text-display leading-[1.15] text-white">Waiting for {who} to let you in</h1>
          <p className="voice m-0 mt-2 text-headline leading-snug text-white/85">You&rsquo;re at the door. Once they say yes, the window opens here on its own.</p>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(ask)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="press mt-6 flex h-12 items-center justify-center gap-2 rounded-full bg-white text-body font-semibold text-black no-underline"
          >
            <Icon name="whatsapp" size={20} />
            Ask them on WhatsApp
          </a>
          <button type="button" disabled={busy} onClick={() => void signOut()} className="press mt-2 h-11 w-full text-callout font-medium text-white/80 disabled:opacity-50">
            Not you? Sign out
          </button>
        </section>
      </main>
    </div>
  );
}
