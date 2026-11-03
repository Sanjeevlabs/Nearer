"use client";

import { useEffect, useState } from "react";
import { setSoundOn, soundOn } from "@/lib/key-sound";
import { cn } from "@/lib/utils";
import { Group } from "./section";

/** "Sounds": the soft key click when you slide the key. On unless switched off; kept on this device. */
export function SoundSection() {
  const [on, setOn] = useState(true);
  useEffect(() => setOn(soundOn()), []);
  return (
    <Group title="Sounds" id="sounds">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Sounds"
        data-ui="sounds-switch"
        onClick={() => {
          setSoundOn(!on);
          setOn(!on);
        }}
        className="press flex min-h-[52px] w-full items-center gap-3 rounded-card bg-surface px-4 py-2 text-left"
        style={{ boxShadow: "var(--surface-edge)" }}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold">Key click</span>
          <span className="block text-footnote text-ink-soft">A soft click when you slide the key. Kept on this phone.</span>
        </span>
        <span className={cn("relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors", on ? "bg-ink" : "bg-black/15")}>
          <span className={cn("absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[21px]" : "left-[3px]")} />
        </span>
      </button>
    </Group>
  );
}
