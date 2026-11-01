"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

// The home page (on a laptop or a projector): what Aangan is, and a QR code
// that opens the app straight into the demo family on any phone. On a phone,
// "/" is the app itself (components/welcome.tsx).

const FEATURES: { img: string; title: string; line: string }[] = [
  { img: "/home/window.webp", title: "A window into their day", line: "Their sky right now, their city's moon, the light you keep lit for each other, and how they are against their usual day." },
  { img: "/home/family.webp", title: "The whole family, one place", line: "Who's around today, glowing. Their day in photos with captions. Today's question, answered by both homes." },
  { img: "/home/chorus.webp", title: "Everyone wishes, together", line: "A week before a birthday or a festival, everyone records a wish. On the day, the Chorus plays them one after another." },
  { img: "/home/send.webp", title: "Care, sent in a tap", line: "Muse knows it's Maa's birthday on Friday and what she likes. Groceries, a cake or a gift, from partners, in one tap." },
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
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-8 py-6">
        <span className="flex items-center gap-2.5 text-[18px] font-semibold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={32} height={32} className="rounded-[9px]" />
          Aangan
        </span>
        <nav className="flex items-center gap-5 text-[15px]">
          {signedIn ? (
            <button type="button" onClick={onEnter} className="press rounded-full bg-ink px-4 py-2 font-semibold text-white">
              Open Aangan
            </button>
          ) : (
            <>
              <Link href="/signin" className="text-ink-soft no-underline hover:text-ink">
                Sign in
              </Link>
              <Link href="/create" className="press rounded-full bg-ink px-4 py-2 font-semibold text-white no-underline">
                Start your family
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero: the promise, the phone, the QR */}
      <section className="mx-auto grid max-w-[1120px] items-center gap-12 px-8 pb-16 pt-6 md:grid-cols-[1.15fr_.85fr]">
        <div>
          <h1 className="m-0 text-[clamp(40px,5.4vw,68px)] font-light leading-[1.02] tracking-[-0.025em]">Far from home. Never far from them.</h1>
          <p className="voice m-0 mt-5 max-w-[34ch] text-[22px] leading-snug text-ink-soft">A window into your parents&rsquo; day, and theirs into yours.</p>
          <div className="mt-9 flex items-center gap-6 rounded-[28px] bg-white p-5 shadow-[0_20px_50px_-30px_rgba(0,0,0,.35)] ring-1 ring-black/[.05]" style={{ maxWidth: 480 }}>
            <div className="h-[132px] w-[132px] shrink-0 overflow-hidden rounded-[14px] [&_svg]:h-full [&_svg]:w-full" aria-label="QR code: open the Aangan demo on your phone" role="img" dangerouslySetInnerHTML={qr ? { __html: qr } : undefined} />
            <div>
              <p className="m-0 text-[19px] font-semibold leading-tight">Scan to open it on your phone</p>
              <p className="m-0 mt-1.5 text-[14.5px] text-ink-soft">Opens straight into a demo family. On your phone, &ldquo;Add to Home Screen&rdquo; makes it an app.</p>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await onDemo();
                }}
                className="press mt-3 text-[14.5px] font-semibold text-ink underline underline-offset-4"
              >
                {busy ? "Opening…" : "Or try the demo here"}
              </button>
            </div>
          </div>
        </div>
        <div className="relative mx-auto w-[300px]">
          <div className="overflow-hidden rounded-[46px] border-[10px] border-[#1c1b1a] bg-black shadow-[0_50px_90px_-40px_rgba(0,0,0,.6)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/home/window.webp" alt="The first screen: an arched window into Maa and Papa's home at night, their status below" className="block w-full" />
          </div>
        </div>
      </section>

      {/* Four things it does */}
      <section className="bg-white py-16">
        <div className="mx-auto grid max-w-[1120px] gap-10 px-8 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <article key={f.title}>
              <div className="overflow-hidden rounded-[26px] bg-paper ring-1 ring-black/[.05]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.img} alt="" className="block aspect-[390/560] w-full object-cover object-top" loading="lazy" />
              </div>
              <h2 className="m-0 mt-4 text-[19px] font-semibold">{f.title}</h2>
              <p className="m-0 mt-1.5 text-[15px] leading-relaxed text-ink-soft">{f.line}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Why it exists */}
      <section className="mx-auto max-w-[760px] px-8 py-20 text-center">
        <p className="voice m-0 text-[26px] leading-snug">Millions of parents live far from their children. A call a week isn&rsquo;t enough. Aangan is the courtyard the family shares again.</p>
        <p className="m-0 mt-6 text-[15px] text-ink-soft">Free for every family. 55 languages. Built with Muse on Meta&rsquo;s models.</p>
      </section>

      <footer className="border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-8 py-6 text-[13.5px] text-ink-soft">
          <span>Aangan · made in Bengaluru for families everywhere</span>
          <span className="flex gap-5">
            <Link href="/privacy" className="text-ink-soft no-underline hover:text-ink">
              Privacy
            </Link>
            <Link href="/join" className="text-ink-soft no-underline hover:text-ink">
              Join with a code
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
