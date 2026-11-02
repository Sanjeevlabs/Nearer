"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CHIP_ACTIVITIES, PRESETS, doorLine, togetherView, type Activity, type Door } from "@/lib/doors";
import { postJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { timeIn } from "@/lib/zones";
import { Icon } from "./ui/kit";
import { useViewer } from "./viewer";

// Together, on the first window, under the lamp. It renders only from the window's own
// payload (doors, myDoor: no request of its own), so it never holds the first paint.
// What it says is only what someone declared: "{Host}'s door is open". Never that
// someone is available, awake or on a call, and an error never reads as "nobody is around".

const DISMISSED_KEY = "aangan:doors-not-now";
const BOX = "rounded-[18px] bg-surface";
const EDGE = { boxShadow: "var(--surface-edge)" } as const;
const PILL = "press flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-callout font-semibold";

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function TogetherCard({
  data,
  failed,
  onRetry,
  onOpen,
}: {
  /** The window payload's doors (undefined while it loads). */
  data: { doors?: Door[]; myDoor?: Door | null } | null;
  failed: boolean;
  onRetry: () => void;
  /** Open the "Open your door" sheet, with a chip's activity. */
  onOpen: (activity?: Activity) => void;
}) {
  const router = useRouter();
  const { viewer } = useViewer();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [listOpen, setListOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closedId, setClosedId] = useState<string | null>(null);
  useEffect(() => setDismissed(readDismissed()), []);

  const view = togetherView(data && closedId && data.myDoor?.id === closedId ? { ...data, myDoor: null } : data, failed, dismissed);
  const until = (iso: string) => timeIn(viewer.tz, new Date(iso));

  // "Not now": only on this device; the host is never told.
  const notNow = (id: string) => {
    const next = new Set(dismissed).add(id);
    setDismissed(next);
    try {
      sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(next)));
    } catch {
      /* private mode: this visit only */
    }
  };
  const closeDoor = async () => {
    setClosing(true);
    const out = await postJson<{ closed: number }>("/api/sit", { action: "unknock" });
    setClosing(false);
    if (out && view.kind === "doors" && view.mine) setClosedId(view.mine.id);
  };

  return (
    <section data-ui="together" aria-label="Time together" className={cn(BOX, "min-h-[112px] p-3")} style={EDGE}>
      <div aria-live="polite" aria-atomic="false">
        {view.kind === "loading" && (
          <div aria-busy="true" aria-label="Checking open doors" className="space-y-2">
            <div className="skeleton h-[20px] w-[60%]" />
            <div className="skeleton h-[44px] w-full" />
          </div>
        )}

        {view.kind === "error" && (
          <div className="flex min-h-[88px] items-center gap-3">
            <p className="m-0 min-w-0 flex-1 text-callout text-ink-soft">Couldn&rsquo;t check right now.</p>
            <button type="button" onClick={onRetry} className={cn(PILL, "bg-tint text-ink")}>
              Retry
            </button>
          </div>
        )}

        {view.kind === "empty" && (
          <div>
            <p className="m-0 text-body font-semibold">Spend a little time together</p>
            <div className="no-scrollbar -mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-0.5">
              {CHIP_ACTIVITIES.map((a) => (
                <button key={a} type="button" data-ui="together-chip" onClick={() => onOpen(a)} className={cn(PILL, "bg-tint text-ink")}>
                  <Icon name={PRESETS[a].icon} size={16} /> {PRESETS[a].label}
                </button>
              ))}
              <Link href="/gather/play" className={cn(PILL, "text-ink no-underline")}>
                More <Icon name="chevron" size={14} />
              </Link>
            </div>
          </div>
        )}

        {view.kind === "doors" && (
          <div className="space-y-2">
            {view.mine && (
              <div data-ui="together-mine" className="flex min-h-[44px] items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-ink" aria-hidden="true">
                  <Icon name="door" size={18} />
                </span>
                <p className="m-0 min-w-0 flex-1 text-callout font-medium leading-snug" suppressHydrationWarning>
                  Your door is open until {until(view.mine.until)}
                  <span className="block text-footnote font-normal text-ink-soft">{doorLine(view.mine)}</span>
                </p>
                <button type="button" onClick={() => void closeDoor()} disabled={closing} className={cn(PILL, "bg-tint text-ink disabled:opacity-60")}>
                  {closing ? "Closing…" : "Close door"}
                </button>
              </div>
            )}
            {view.first && (
              <div data-ui="together-door" className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-2">
                <p className="m-0 min-w-0 flex-1 basis-[180px] text-callout font-medium leading-snug" suppressHydrationWarning>
                  {view.first.hostName}&rsquo;s door is open · {doorLine(view.first)}
                  <span className="block text-footnote font-normal text-ink-soft">until {until(view.first.until)}</span>
                </p>
                <div className="flex gap-2">
                  {view.first.justYou && (
                    <button type="button" onClick={() => notNow(view.first!.id)} className={cn(PILL, "bg-tint text-ink")}>
                      Not now
                    </button>
                  )}
                  <button type="button" onClick={() => router.push(`/call/${encodeURIComponent(view.first!.id)}`)} className={cn(PILL, "bg-accent text-accent-ink")}>
                    Join
                  </button>
                </div>
              </div>
            )}
            {view.more.length > 0 && (
              <>
                <button type="button" aria-expanded={listOpen} onClick={() => setListOpen((o) => !o)} className="press flex min-h-[44px] items-center gap-1 px-1 text-footnote font-semibold text-ink-soft">
                  +{view.more.length} more <Icon name="down" size={14} />
                </button>
                {listOpen && (
                  <ul className="m-0 list-none space-y-1 p-0">
                    {view.more.map((d) => (
                      <li key={d.id} className="flex min-h-[44px] items-center gap-3 border-t border-[var(--line)] pt-1">
                        <p className="m-0 min-w-0 flex-1 text-callout leading-snug" suppressHydrationWarning>
                          {d.hostName}&rsquo;s door is open · {doorLine(d)}
                          <span className="block text-footnote text-ink-soft">until {until(d.until)}</span>
                        </p>
                        <button type="button" onClick={() => router.push(`/call/${encodeURIComponent(d.id)}`)} className={cn(PILL, "bg-accent text-accent-ink")}>
                          Join
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {!view.mine && (
              <button type="button" onClick={() => onOpen()} className="press flex min-h-[44px] items-center gap-1.5 px-1 text-footnote font-semibold text-ink-soft">
                <Icon name="door" size={15} /> Open your door
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
