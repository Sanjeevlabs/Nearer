"use client";

import { entryHref } from "@/lib/auth-session";
import { liveAuth } from "@/lib/supabase-browser";
import { Lockup, Mark, Wordmark } from "./brand";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

// The home page, phone first: what Nearer is and the way in (Open Nearer when signed in;
// the demo, create and sign-in when not). On a laptop or a projector it also shows a QR
// code that opens the demo family on a phone. The installed app skips it (components/welcome.tsx).

// What a family chat can't do, in the words people use. Facts about the app, no claims about outcomes.
const NOT_CHAT: { chat: string; nearer: string }[] = [
  { chat: "A group chat waits for someone to type.", nearer: "Press Voice and talk. Nearer writes it down and translates it, so nobody has to type." },
  { chat: "Her voice notes scroll away.", nearer: "Her voice is kept: recipes, stories and blessings, written down, searchable, starred, in the family's Book." },
  { chat: "A call is all or nothing.", nearer: "Maa opens her door for chai when she's free. Join by voice, only if you tap." },
  { chat: "\"Are you okay?\" needs a reply.", nearer: "A lamp says \"thinking of you\" to one person. Nothing to answer." },
];

const FEATURES: { img: string; alt: string; pos: string; title: string; line: string }[] = [
  { img: "/home/voice.webp", alt: "The voice sheet: a short voice memory for Maa, with the words Nearer wrote down beneath it and a Send button", pos: "object-bottom", title: "Say it once, in any language", line: "Press Voice and say it, in any language. Nearer writes it down, translates it for each of them and keeps her voice, with her recipes and stories. Photos are there too, when words aren't enough." },
  { img: "/home/chorus.webp", alt: "The Chorus: a birthday with a photo and four voice wishes from the family, each with its words and a play button", pos: "object-top", title: "Everyone wishes, together", line: "A week before a birthday or a festival, everyone records a wish by voice. On the day, the Chorus plays them one after another." },
  { img: "/home/window.webp", alt: "The window into Maa and Papa's home at night, with the lamp lit and what each of them is doing", pos: "object-top", title: "A window into their day", line: "Their sky and the time there, the lamp you keep lit for each other, and what they chose to share today." },
  { img: "/home/together.webp", alt: "The Living Room: Maa's door is open for chai, with a Join button, and doors you can open for dinner, a story or a quiz", pos: "object-top", title: "A little time together", line: "Open your door for chai, dinner or a story. They join when they can, by voice or video, and only when they tap." },
];

function useQr(path: string): string | null {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    const url = `${window.location.origin}${path}`;
    void QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1c1b1a", light: "#ffffff" } }).then(setSvg);
  }, [path]);
  return svg;
}

export function HomeSite({ onDemo, signedIn = false, onEnter }: { onDemo: () => Promise<void>; signedIn?: boolean; onEnter?: () => void }) {
  const qr = useQr("/?demo=1");
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-paper text-ink">
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-4 pb-4 sm:px-8 sm:pb-6" style={{ paddingTop: "calc(20px + env(safe-area-inset-top))" }}>
        <Lockup mark={28} word={84} className="text-ink" />
        <nav className="flex items-center gap-4 text-body sm:gap-5">
          {signedIn ? (
            <button type="button" onClick={onEnter} className="press min-h-11 rounded-full bg-accent px-4 py-2 font-semibold text-accent-ink">
              Open Nearer
            </button>
          ) : (
            <>
              <Link href="/signin" className="flex min-h-11 items-center text-ink-soft no-underline hover:text-ink">
                Sign in
              </Link>
              <Link href={entryHref(liveAuth(), "create")} className="press flex min-h-11 items-center rounded-full bg-accent px-4 py-2 font-semibold text-accent-ink no-underline">
                Start your family
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero: the promise, the phone, the QR */}
      <section className="mx-auto grid max-w-[1120px] items-center gap-10 px-4 pb-12 pt-2 sm:px-8 sm:pb-16 sm:pt-6 md:grid-cols-[1.15fr_.85fr] md:gap-12">
        <div>
          {/* The hero lockup: the mark above the name, then the promise. */}
          <div className="mb-6 flex flex-col items-start gap-3 text-ink md:mb-8">
            <Mark size={96} className="md:!h-[140px] md:!w-[140px]" />
            <Wordmark width={140} className="md:!h-[34px] md:!w-[188px]" />
          </div>
          <h1 data-display className="m-0 text-display md:text-[clamp(44px,5.4vw,68px)] font-light leading-[1.02] tracking-[-0.025em]">Talk, don&rsquo;t type.</h1>
          <p className="voice m-0 mt-5 max-w-[34ch] text-title leading-snug text-ink-soft">Her voice is kept, written down, and never lost.</p>
          <p className="m-0 mt-3 max-w-[34ch] text-body leading-snug">Nearer is the voice-first window between two homes: their sky, their time, and what they chose to share.</p>
          {/* The way in: on every screen when signed in, and on a phone when not (no QR there). */}
          <div className={signedIn ? "mt-7 flex flex-col gap-2.5 sm:max-w-[320px]" : "mt-7 flex flex-col gap-2.5 sm:max-w-[320px] md:hidden"} data-ui="home-actions">
            {signedIn ? (
              <button type="button" onClick={onEnter} className="press h-12 rounded-full bg-accent text-headline font-semibold text-accent-ink">
                Open Nearer
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await onDemo();
                    setBusy(false);
                  }}
                  className="press h-12 rounded-full bg-accent text-headline font-semibold text-accent-ink disabled:opacity-60"
                >
                  {busy ? "Opening…" : "Try the demo family"}
                </button>
                <p className="m-0 -mt-1 text-center text-footnote text-ink-soft">No sign-up. Opens a demo family.</p>
                <Link href={entryHref(liveAuth(), "create")} className="press flex h-[50px] items-center justify-center rounded-full bg-tint text-body font-semibold text-ink no-underline">
                  Start your family
                </Link>
                <Link href="/signin" className="flex h-11 items-center justify-center text-body font-medium text-ink-soft no-underline">
                  Sign in
                </Link>
              </>
            )}
          </div>
          <div className="mt-9 hidden items-center gap-6 md:flex rounded-[28px] bg-white p-4 shadow-[0_20px_50px_-30px_rgba(0,0,0,.35)] ring-1 ring-[var(--line)]" style={{ maxWidth: 480 }}>
            <div className="h-[132px] w-[132px] shrink-0 overflow-hidden rounded-[14px] [&_svg]:h-full [&_svg]:w-full" aria-label="QR code: open the Nearer demo on your phone" role="img" dangerouslySetInnerHTML={qr ? { __html: qr } : undefined} />
            <div>
              <p className="m-0 text-title font-semibold leading-tight">Scan to open it on your phone</p>
              <p className="m-0 mt-1.5 text-callout text-ink-soft">Opens straight into a demo family. On your phone, &ldquo;Add to Home Screen&rdquo; makes it an app.</p>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await onDemo();
                }}
                className="press mt-3 text-callout font-semibold text-ink underline underline-offset-4"
              >
                {busy ? "Opening…" : "Or try the demo here"}
              </button>
            </div>
          </div>
        </div>
        <div className="relative mx-auto w-[240px] sm:w-[300px]">
          <div className="overflow-hidden rounded-[46px] border-[10px] border-[#1c1b1a] bg-black shadow-[0_50px_90px_-40px_rgba(0,0,0,.6)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/home/window.webp" alt="The first screen: a drawing of Maa and Papa's window under their real sky, the lamp, and how they are" className="block w-full" />
          </div>
        </div>
      </section>

      {/* The first question everyone asks: "isn't this a WhatsApp group?" Answered before anything else. */}
      <section className="mx-auto max-w-[760px] px-4 pb-12 sm:px-8 sm:pb-16" data-ui="home-not-chat">
        <h2 className="m-0 text-title font-semibold">Not another group chat</h2>
        <dl className="m-0 mt-4 divide-y divide-[var(--line)] overflow-hidden rounded-[22px] bg-white ring-1 ring-black/[.05]">
          {NOT_CHAT.map((row) => (
            <div key={row.chat} className="grid gap-1 px-4 py-4 sm:grid-cols-2 sm:gap-6 sm:px-6">
              <dt className="text-callout text-ink-soft">{row.chat}</dt>
              <dd className="m-0 text-body font-medium">{row.nearer}</dd>
            </div>
          ))}
        </dl>
        <p className="m-0 mt-3 text-footnote text-ink-soft">Keep your family group. Nearer is where you talk instead of type, and where her voice is kept.</p>
      </section>

      {/* The film: one minute, played only when asked (no autoplay, nothing loaded until then). */}
      <section className="mx-auto max-w-[760px] px-4 pb-12 sm:px-8 sm:pb-16" data-ui="home-film">
        <h2 className="m-0 mb-4 text-center text-title font-semibold">See it in a minute</h2>
        <div className="overflow-hidden rounded-[24px] bg-black shadow-[0_30px_70px_-40px_rgba(0,0,0,.55)] ring-1 ring-black/[.06]">
          <video
            className="block aspect-video w-full"
            controls
            playsInline
            preload="none"
            poster="/home/film-poster.webp"
            aria-label="A short film about Nearer: a new city, the same home; the lamp, her voice, a family recipe"
          >
            <source src="/home/film.mp4" type="video/mp4" />
          </video>
        </div>
        <p className="m-0 mt-3 text-center text-footnote text-ink-soft">An illustrative family, the real app.</p>
      </section>

      {/* Four things it does */}
      <section className="bg-card py-12 sm:py-16">
        <div className="mx-auto grid max-w-[1120px] gap-10 px-4 sm:px-8 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <article key={f.title}>
              <div className="overflow-hidden rounded-[26px] bg-paper ring-1 ring-[var(--line)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.img} alt={f.alt} className={`block aspect-[390/560] w-full object-cover ${f.pos}`} loading="lazy" />
              </div>
              <h2 className="m-0 mt-4 text-title font-semibold">{f.title}</h2>
              <p className="m-0 mt-1.5 text-body leading-relaxed text-ink-soft">{f.line}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Why it exists */}
      <section className="mx-auto max-w-[760px] px-4 py-14 text-center sm:px-8 sm:py-20">
        <p data-display className="voice m-0 text-title leading-snug sm:text-display">Millions of parents live far from their children. A call a week isn&rsquo;t enough. Nearer is the courtyard the family shares again.</p>
        <p className="m-0 mt-6 text-body text-ink-soft">Free for every family. 55 languages. Built with Muse on Meta&rsquo;s models.</p>
      </section>

      <footer className="border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-6 sm:px-8 text-footnote text-ink-soft">
          <span className="flex items-center gap-2">
            <Mark size={20} /> Made with <span aria-label="love">♥</span> by{" "}
            <a href="https://sanjeevlabs.com" target="_blank" rel="noopener noreferrer" className="text-ink-soft underline underline-offset-2 hover:text-ink">
              sanjeevlabs.com
            </a>{" "}
            · India
          </span>
          <span className="flex gap-5">
            <Link href="/privacy" className="text-ink-soft no-underline hover:text-ink">
              Privacy
            </Link>
            <Link href={entryHref(liveAuth(), "join")} className="text-ink-soft no-underline hover:text-ink">
              Join with a code
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
