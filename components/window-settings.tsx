"use client";

import { useState } from "react";
import { QUIET_CHOICES } from "@/lib/status";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";

// How long someone may be quiet (in their daytime) before their dot turns
// amber. The photo and who is at your window live in app/settings/window-options.tsx.

interface W {
  quietAfterHours: number;
}

export function WindowSettings() {
  const { data, reload } = useJson<W>("/api/window");
  const [busy, setBusy] = useState(false);
  if (!data) return <div key="loading" className="skeleton h-[96px] rounded-card" aria-busy="true" aria-label="Loading" />;
  return (
    <div>
      <p className="m-0 mb-2 text-footnote font-medium text-ink-soft">Turn their dot amber when they&rsquo;ve been quiet for</p>
      <div className="flex gap-1.5" role="radiogroup" aria-label="Amber after">
        {QUIET_CHOICES.map((h) => (
          <button
            key={h}
            type="button"
            role="radio"
            aria-checked={data.quietAfterHours === h}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await postJson("/api/window", { action: "quiet", hours: h });
              await reload();
              setBusy(false);
            }}
            className={cn("press h-11 flex-1 rounded-full text-callout font-semibold", data.quietAfterHours === h ? "bg-accent text-accent-ink" : "bg-surface text-ink-soft")}
          >
            {h} h
          </button>
        ))}
      </div>
      <p className="m-0 mt-1.5 text-caption text-ink-faint">Only during their day. At night it shows &ldquo;asleep&rdquo;. Based on activity in Nearer.</p>
    </div>
  );
}
