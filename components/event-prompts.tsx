"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { eventAction, useEvents } from "@/lib/gather-client";
import type { EventPrompt } from "@/lib/gather-prompts";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./ui/kit";

const ICON: Record<EventPrompt["kind"], IconName> = { pick: "calendar", soon: "video", live: "video", suggest: "sparkle" };

/**
 * In-app prompts for family events (no push yet): pick a time, starts in an
 * hour, live now, and Muse's "Plan Maa's birthday celebration?" (one tap
 * drafts it). Pass `prompts` from a page that already fetched them, or let
 * it fetch its own (for the window or Kutumb).
 */
export function EventPrompts({ prompts, onChange, className, kinds }: { prompts?: EventPrompt[]; onChange?: () => void; className?: string; kinds?: EventPrompt["kind"][] }) {
  const own = useEvents(prompts === undefined);
  const list = (prompts ?? own.data?.prompts ?? []).filter((p) => !kinds || kinds.includes(p.kind));
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  const shown = list.filter((p) => !gone.includes(p.id));
  if (!shown.length) return null;
  const refresh = () => (onChange ? onChange() : void own.reload());

  return (
    <ul className={cn("m-0 list-none space-y-2 p-0", className)} aria-label="Celebrations">
      {shown.map((p) => {
        const dark = p.kind === "live" || p.kind === "soon";
        const body = (
          <>
            <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", dark ? "bg-white/10" : "bg-well")}>
              {p.kind === "live" ? <span className="h-2.5 w-2.5 rounded-full bg-[#ffb84d]" style={{ boxShadow: "0 0 0 4px rgba(255,184,77,.25)" }} aria-hidden="true" /> : <Icon name={ICON[p.kind]} size={18} />}
            </span>
            <span className="min-w-0 flex-1 text-body font-semibold leading-snug">{p.text}</span>
          </>
        );
        const row = cn("flex items-center gap-3 rounded-[22px] p-2 pr-2", dark ? "bg-[#1c1b1a] text-white" : "bg-surface text-ink");
        if (p.kind !== "suggest") {
          return (
            <li key={p.id}>
              <Link href={`/gather/${p.eventId}${p.kind === "pick" ? "#times" : ""}`} className={cn(row, "no-underline")}>
                {body}
                <Icon name="chevron" size={18} className={dark ? "text-white/60" : "text-ink-faint"} />
              </Link>
            </li>
          );
        }
        const o = p.occasion;
        return (
          <li key={p.id} className={cn(row, "flex-wrap")}>
            {body}
            <span className="flex basis-full items-center gap-1 pb-1 pl-[52px]">
            <button
              type="button"
              disabled={busy === p.id}
              onClick={async () => {
                setBusy(p.id);
                const out = await eventAction({ action: "create", type: o.type, occasionKey: o.slug, forMemberId: o.memberId, date: o.date });
                setBusy(null);
                if (out?.event) router.push(`/gather/${out.event.id}`);
              }}
              className="press h-10 shrink-0 rounded-full bg-[#1c1b1a] px-4 text-callout font-semibold text-white disabled:opacity-50"
            >
              {busy === p.id ? "…" : "Plan"}
            </button>
            <button
              type="button"
              onClick={async () => {
                setGone((g) => [...g, p.id]);
                await eventAction({ action: "dismiss", key: p.id });
                refresh();
              }}
              className="press h-10 shrink-0 rounded-full px-3 text-callout font-semibold text-ink-soft"
            >
              Not now
            </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
