"use client";

import { useCallback, useEffect, useState } from "react";
import { strings } from "@/lib/i18n";
import type { Suggestion } from "@/lib/schemas";
import { useRouter } from "next/navigation";
import { FestivalStepsSheet, useFestivalWeek } from "./festival-header";
import { useViewer } from "./viewer";

// "Nearer suggests · Review / Approve" — flat surface card. Actions execute
// ONLY after approval (POST to the approve route).
export function Suggestions({ compact }: { compact?: boolean }) {
  const { lang } = useViewer();
  const t = strings(lang);
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const router = useRouter();
  const { week } = useFestivalWeek();
  const [stepsOpen, setStepsOpen] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/suggestions?status=pending", { cache: "no-store" });
      if (!res.ok) throw new Error("suggestions-fetch-failed");
      setItems(((await res.json()) as { suggestions: Suggestion[] }).suggestions);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, approve: boolean) => {
    // "Record a wish": the one place to record it is the wish card in Coming up.
    const sug = items?.find((x) => x.id === id);
    const p = (sug?.payload ?? {}) as { action?: string; ritualRunId?: string; kind?: string; prompt?: string };
    // "You lead this year": open the steps as a checklist, then acknowledge it.
    if (approve && p.action === "request_lead") {
      setStepsOpen(true);
      setBusyId(id);
      await fetch(`/api/suggestions/${id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approve" }) }).catch(() => null);
      await load();
      setBusyId(null);
      return;
    }
    if (approve && p.action === "request_wish" && p.ritualRunId) {
      router.push("/gather");
      setBusyId(id);
      await fetch(`/api/suggestions/${id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "reject" }) }).catch(() => null);
      await load();
      setBusyId(null);
      return;
    }
    setBusyId(id);
    try {
      await fetch(`/api/suggestions/${id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: approve ? "approve" : "reject" }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (items === null) {
    if (failed) return null;
    return null;
  }
  if (items.length === 0) return <FestivalStepsSheet week={week} open={stepsOpen} onClose={() => setStepsOpen(false)} />;

  // Agent proposals: nothing happens until a person approves.
  return (
    <section aria-label="Nearer suggests" className="mb-6">
      <ul className="m-0 list-none space-y-2 p-0">
        {items.map((s) => (
          <li key={s.id} className="rounded-[22px] bg-tint px-4 py-3.5">
            <p className="m-0 mt-1 text-body leading-snug text-ink">{s.goal}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busyId === s.id}
                onClick={() => void act(s.id, true)}
                className="press h-10 rounded-full bg-accent px-5 text-callout font-semibold text-accent-ink disabled:opacity-40"
              >
                Do it
              </button>
              <button
                type="button"
                disabled={busyId === s.id}
                onClick={() => void act(s.id, false)}
                className="press h-10 rounded-full px-4 text-callout font-semibold text-ink-soft disabled:opacity-40"
              >
                Not now
              </button>
            </div>
          </li>
        ))}
      </ul>
      <FestivalStepsSheet week={week} open={stepsOpen} onClose={() => setStepsOpen(false)} />
    </section>
  );
}
