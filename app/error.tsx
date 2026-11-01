"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/kit";

// A load failure never leaves a blank screen, and says what to do next.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Nearer failed to load:", error);
  }, [error]);
  return (
    <div className="pt-16 text-center" role="alert">
      <h1 data-display className="m-0 text-display">This page didn&rsquo;t load</h1>
      <p className="m-0 mx-auto mt-2 max-w-[300px] text-body text-ink-soft">Your memories are safe. Check your connection, then try again.</p>
      <Button className="mx-auto mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
