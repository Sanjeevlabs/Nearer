"use client";

import QRCode from "qrcode";
import { useState } from "react";
import { isDemoFamily } from "@/lib/family";
import { isKid } from "@/lib/kids";
import { postJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { useViewer } from "./viewer";

// Demo only: after opening a door, see it arrive on the other side. Pick a person,
// scan the code on a second phone (or open the link in another browser) and you are
// that person in this same demo family, for 30 minutes. Real families never see this.
export function DemoHandoff() {
  const { viewer, members } = useViewer();
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState<{ name: string; url: string; svg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!isDemoFamily(viewer.familyId)) return null;
  const others = members.filter((m) => m.id !== viewer.id && m.familyId === viewer.familyId && !isKid(m)).slice(0, 4);
  if (others.length === 0) return null;

  const make = async (memberId: string) => {
    setBusy(true);
    const out = await postJson<{ path: string; name: string }>("/api/session/pass", { memberId });
    if (out) {
      const url = `${window.location.origin}${out.path}`;
      const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } });
      setPass({ name: out.name, url, svg });
    }
    setBusy(false);
  };

  return (
    <div data-ui="demo-handoff" className="rounded-[14px] bg-tint p-2.5">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="press flex min-h-[44px] w-full items-center text-left text-footnote font-semibold text-ink">
          Demo: see it arrive on their side
        </button>
      ) : pass ? (
        <div className="flex items-center gap-3">
          <div className="h-[112px] w-[112px] shrink-0 overflow-hidden rounded-[10px] bg-white [&_svg]:h-full [&_svg]:w-full" role="img" aria-label={`QR code: open Nearer as ${pass.name}`} dangerouslySetInnerHTML={{ __html: pass.svg }} />
          <div className="min-w-0">
            <p className="m-0 text-callout font-semibold leading-snug">Scan on another phone to be {pass.name}</p>
            <p className="m-0 mt-1 text-footnote text-ink-soft">Or open the link in another browser. Works for 30 minutes.</p>
            <a href={pass.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-[44px] items-center text-footnote font-semibold text-ink underline underline-offset-2">
              Open as {pass.name}
            </a>
          </div>
        </div>
      ) : (
        <div>
          <p className="m-0 px-1 pb-1 text-footnote text-ink-soft">Whose side?</p>
          <div className="flex flex-wrap gap-2">
            {others.map((m) => (
              <button key={m.id} type="button" disabled={busy} onClick={() => void make(m.id)} className={cn("press flex min-h-[44px] items-center rounded-full bg-surface px-4 text-callout font-semibold text-ink disabled:opacity-60")}>
                {m.firstName}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
