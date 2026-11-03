"use client";

import { Button } from "./ui/kit";

/** A read failed and there is nothing already shown to keep: say so, with a way to try again (never an empty page). */
export function LoadFailed({ what, onRetry, ui }: { what: string; onRetry: () => void; ui: string }) {
  return (
    <div data-ui={ui} role="alert" className="rounded-[22px] bg-card p-4 text-center shadow-card">
      <p className="m-0 text-body font-semibold">{what} couldn&rsquo;t load just now</p>
      <p className="m-0 mt-1 text-callout text-ink-soft">Check your connection and try again.</p>
      <Button variant="secondary" className="mx-auto mt-3 !bg-well" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
