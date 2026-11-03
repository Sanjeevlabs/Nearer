"use client";

import { entryHref } from "@/lib/auth-session";
import { liveAuth } from "@/lib/supabase-browser";
import Link from "next/link";
import { useState } from "react";
import { greetingForHour } from "@/lib/i18n";
import { useDocumentLang, useT } from "@/lib/use-t";
import { resolveMediaUrl } from "@/lib/media-session";
import { Button, Icon, Photo } from "./ui/kit";
import { useViewer } from "./viewer";
import { Lockup, Mark } from "./brand";

/** A glass card at the bottom of a calm ground (the home photo when there is one): the frame for every entry screen. */
export function EntryFrame({ image, children }: { image?: string | null; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 overflow-hidden bg-[#2a211c]">
      {image ? (
        <Photo src={image} alt="" sizes="100vw" priority />
      ) : (
        <div className="absolute inset-0 grid place-items-center opacity-25" aria-hidden="true">
          <Mark size={160} />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/30" aria-hidden="true" />
      <div className="relative mx-auto flex h-full max-w-[480px] flex-col px-4" style={{ paddingTop: "calc(20px + env(safe-area-inset-top))", paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}>
        <p className="m-0 px-2 text-white drop-shadow"><Lockup mark={28} word={84} /></p>
        <div className="flex-1" />
        <div className="glass rounded-[30px] p-6">{children}</div>
      </div>
    </div>
  );
}

/** Signed out: one promise, and the four ways in. */
export function Landing({ onDemo }: { onDemo: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const t = useT();
  useDocumentLang();
  return (
    <EntryFrame>
      <h1 data-display className="m-0 text-display leading-[1.1] text-white">{t("landing.tagline")}</h1>
      <p className="voice m-0 mt-2 text-headline leading-snug text-white/85">{t("landing.sub")}</p>
      <div className="mt-6 grid grid-cols-2 gap-2.5">
        <Link href={entryHref(liveAuth(), "create")} className="press flex h-12 items-center justify-center rounded-full bg-white text-body font-semibold text-black no-underline">
          {t("landing.create")}
        </Link>
        <Link href={entryHref(liveAuth(), "join")} className="press flex h-12 items-center justify-center gap-2 rounded-full bg-white/15 text-body font-semibold text-white no-underline">
          <Icon name="key" size={18} />
          {t("landing.join")}
        </Link>
      </div>
      <div className="mt-3 flex items-center justify-between px-1 text-body">
        <Link href="/signin" className="flex h-11 items-center font-medium text-white no-underline">
          {t("landing.signin")}
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onDemo();
            setBusy(false);
          }}
          className="flex h-11 items-center gap-1 font-medium text-white/80"
        >
          {busy ? t("landing.opening") : t("landing.demo")}
          {!busy && <Icon name="chevron" size={16} className="rtl:-scale-x-100" />}
        </button>
      </div>
    </EntryFrame>
  );
}

/** Signed in, once per session: the home you miss, and one warm signal. */
export function Welcome({ onEnter }: { onEnter: () => void }) {
  const { viewer, signalLine } = useViewer();
  const [hour] = useState(() => new Date().getHours());
  const home = resolveMediaUrl(viewer.homeImageRef);
  const t = useT();
  useDocumentLang();
  return (
    <EntryFrame image={home}>
      <p className="m-0 text-body text-white/80">{t(`welcome.${greetingForHour(hour)}`)}</p>
      <h1 data-display className="m-0 mt-1 text-display leading-[1.05] text-white">{t("welcome.title", { name: viewer.firstName })}</h1>
      {signalLine && <p className="voice m-0 mt-3 text-headline leading-snug text-white/90">{signalLine}</p>}
      <Button className="mt-6 w-full !bg-white !text-black" onClick={onEnter}>
        {t("welcome.enter")}
      </Button>
    </EntryFrame>
  );
}
