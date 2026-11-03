"use client";

import { LoadFailed } from "@/components/load-failed";
import { useState } from "react";
import { Suggestions } from "@/components/suggestions";
import { EmptyLine, Icon, MuseMark, RoomHeader, SectionTitle } from "@/components/ui/kit";
import type { MuseCall } from "@/lib/kinds";
import { ago, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";

interface Run {
  id: string;
  goal: string;
  tools: string[];
  status: string;
  createdAt: string;
}
interface TraceData {
  runs: Run[];
  suggestions: { id: string; goal: string; status: string; createdAt: string }[];
  museCalls: MuseCall[];
  spendTotalUsd: number;
  demo?: boolean;
}

// Transparency, not a dashboard: what Muse did for this family, in sentences,
// with the model, time and cost of each step. Nothing Muse proposes runs
// without a person approving it.
export function TraceView() {
  const { data, failed, reload } = useJson<TraceData>("/api/trace");
  const [showRuns, setShowRuns] = useState(false);
  const calls = data?.museCalls ?? [];
  const cached = calls.filter((c) => c.cached).length;

  return (
    <div>
      <RoomHeader title="What Muse did" subtitle="Every step Nearer's helper took for your family, and what it cost" />
      <div className="mb-6 rounded-card bg-surface p-4">
        <p className="m-0 flex items-center gap-2 text-headline font-semibold">
          <Icon name="sparkle" size={18} />
          Powered by Muse, working backstage
        </p>
        <ul className="m-0 mt-3 list-none space-y-1.5 p-0 text-callout text-ink-soft">
          <li>· Writes down voices, recipes and needs. It never speaks for anyone.</li>
          <li>· Translates each person&rsquo;s words into the reader&rsquo;s language.</li>
          <li>· Asks elders one gentle question a week. It never chats with them.</li>
          <li>· Proposes. A person approves before anything happens.</li>
        </ul>
        {data?.demo && <p className="m-0 mt-3 text-caption text-ink-faint">Demo family: some entries below are sample activity.</p>}
      </div>

      <Suggestions />

      <div className="mb-2 grid grid-cols-3 gap-2">
        <Stat label="Muse steps" value={data ? String(calls.length) : "…"} />
        <Stat label="From cache" value={data ? String(cached) : "…"} />
        <Stat label="Spent" value={data ? `$${data.spendTotalUsd.toFixed(2)}` : "…"} sub="of $120 cap" />
      </div>

      <SectionTitle>Recent steps</SectionTitle>
      {failed && !data && <LoadFailed what="Activity" ui="trace-retry" onRetry={() => void reload()} />}
      {data === null && !failed && <div className="skeleton h-40 rounded-card" aria-busy="true" />}
      {data && calls.length === 0 && <EmptyLine>Nothing yet. Teach a recipe or record a voice memory and Muse will help.</EmptyLine>}
      <ol className="m-0 list-none p-0">
        {calls.map((c) => (
          <li key={c.id} className="border-b border-[var(--line)] py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-body font-medium leading-snug">{c.purpose}</span>
              <span className="shrink-0 text-caption text-ink-faint">{ago(c.at)}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-surface px-2.5 py-1 font-mono text-caption text-ink-soft">{c.model}</span>
              <span className="tnum rounded-full bg-surface px-2.5 py-1 text-caption text-ink-soft">{c.cached ? "cached" : `${(c.ms / 1000).toFixed(1)}s`}</span>
              <span className="tnum rounded-full bg-surface px-2.5 py-1 text-caption text-ink-soft">${c.cost.toFixed(2)}</span>
              {!c.ok && <span className="rounded-full bg-[#fdecea] px-2.5 py-1 text-caption font-medium text-[#b42318]">safe fallback used</span>}
            </div>
          </li>
        ))}
      </ol>

      {data && data.runs.length > 0 && (
        <div className="mt-6">
          <button type="button" onClick={() => setShowRuns((v) => !v)} aria-expanded={showRuns} className="flex h-11 items-center gap-1.5 text-body font-semibold">
            Agent runs ({data.runs.length})
            <Icon name="down" size={16} className={cn("transition-transform", showRuns && "rotate-180")} />
          </button>
          {showRuns && (
            <ol className="m-0 list-none p-0">
              {data.runs.map((r) => (
                <li key={r.id} className="border-b border-[var(--line)] py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-body font-semibold">{r.goal}</span>
                    <span className="shrink-0 text-caption text-ink-faint">{ago(r.createdAt)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {r.tools.map((tool) => (
                      <span key={tool} className="rounded-full bg-surface px-2.5 py-1 font-mono text-caption text-ink-soft">
                        {tool}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      <MuseMark show className="mt-8">Meta Muse models · structured output · validated before it reaches you</MuseMark>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[20px] bg-surface px-3 py-3">
      <p className="tnum m-0 text-title font-bold leading-none">{value}</p>
      <p className="m-0 mt-1 text-caption text-ink-soft">{label}</p>
      {sub && <p className="m-0 text-caption text-ink-faint">{sub}</p>}
    </div>
  );
}
