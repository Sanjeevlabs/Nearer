"use client";

import { useCallback, useEffect, useState } from "react";
import { toggleStar } from "./stars";
import { postJson, useJson } from "./use-json";

/** Your own starred memories: read once, starred or unstarred at once on tap, saved behind. */
export function useStars(): { starred: string[]; isStarred: (id: string) => boolean; toggle: (id: string) => void; ready: boolean } {
  const q = useJson<{ starred: string[] }>("/api/stars");
  const [starred, setStarred] = useState<string[] | null>(null);
  useEffect(() => {
    if (q.data && starred === null) setStarred(q.data.starred);
  }, [q.data, starred]);
  const list = starred ?? q.data?.starred ?? [];
  const toggle = useCallback(
    (id: string) => {
      const on = !list.includes(id);
      setStarred(toggleStar(list, id, on));
      void postJson<{ starred: string[] }>("/api/stars", { cardId: id, on }).then((out) => {
        // A refused save puts the star back where it was.
        if (!out) setStarred((now) => toggleStar(now ?? [], id, !on));
      });
    },
    [list],
  );
  return { starred: list, isStarred: (id) => list.includes(id), toggle, ready: q.data !== null || q.failed };
}
