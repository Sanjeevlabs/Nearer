"use client";

import { useState } from "react";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { Icon } from "./ui/kit";

// Settings → Connected apps: every app Send something offers this family, by
// the country of each home: partners you can connect, open stores, and the
// apps that open on their own site. Connecting is OAuth on the partner's site;
// the token stays on our server and is never shown here.

type Status = "connected" | "connect" | "no-account" | "link" | "soon";
interface Row {
  key: string;
  name: string;
  what: string;
  status: Status;
  url: string | null;
  accountId: string | null;
}
interface Group {
  key: string;
  label: string;
  rows: Row[];
}

const STATUS_TEXT: Record<Status, string> = { connected: "Connected", connect: "Not connected", "no-account": "No account needed", link: "Opens their site", soon: "Coming soon" };

function Dot({ on }: { on: boolean }) {
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", on ? "bg-[#2f9e5b]" : "bg-black/20")} aria-hidden="true" />;
}

export function ConnectedApps() {
  const { data, failed, reload } = useJson<{ sample: boolean; groups: Group[] }>("/api/partners");
  const [busy, setBusy] = useState<string | null>(null);

  if (failed)
    return (
      <div id="connected-apps" className="rounded-[22px] bg-surface px-4 py-5 text-center">
        <p className="m-0 text-body text-ink-soft">Couldn&rsquo;t load your apps.</p>
        <button type="button" onClick={() => void reload()} className="press mt-2 h-11 rounded-full bg-surface px-4 text-callout font-semibold">
          Try again
        </button>
      </div>
    );
  if (!data) return <div key="loading" id="connected-apps" className="skeleton h-[200px] rounded-[22px]" aria-busy="true" aria-label="Loading connected apps" />;

  const disconnect = async (accountId: string) => {
    setBusy(accountId);
    await postJson(`/api/partners/${encodeURIComponent(accountId)}/connect`, {}, "DELETE");
    await reload();
    setBusy(null);
  };

  return (
    <div id="connected-apps" className="space-y-5">
      {data.groups.length === 0 && <p className="m-0 text-body text-ink-soft">Add a home to the family and the apps for it appear here.</p>}
      {data.groups.map((g) => (
        <section key={g.key} aria-label={g.label}>
          <h3 className="m-0 mb-2 px-1 text-callout font-semibold text-ink-soft">{g.label}</h3>
          <ul className="m-0 list-none divide-y divide-[var(--line)] rounded-[22px] bg-surface p-0 px-4">
            {g.rows.map((r) => (
              <li key={r.key} data-status={r.status} className="flex min-h-[64px] items-center gap-3 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-body font-semibold text-ink" aria-hidden="true">
                  {r.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-body font-semibold">
                    <span className="truncate">{r.name}</span>
                    {r.status === "connected" && <Dot on />}
                  </span>
                  <span className="block truncate text-footnote text-ink-soft">
                    {r.what} · {STATUS_TEXT[r.status]}
                  </span>
                </span>
                {r.status === "connected" && r.accountId && (
                  <button type="button" disabled={busy === r.accountId} onClick={() => void disconnect(r.accountId as string)} aria-label={`Disconnect ${r.name}`} className="press h-11 rounded-full bg-surface px-4 text-callout font-semibold text-ink-soft disabled:opacity-40">
                    Disconnect
                  </button>
                )}
                {r.status === "connect" && r.accountId && (
                  <a href={`/api/partners/${encodeURIComponent(r.accountId)}/connect`} className="press flex h-11 items-center rounded-full bg-accent px-4 text-callout font-semibold text-accent-ink no-underline">
                    Connect
                  </a>
                )}
                {r.status === "link" && r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${r.name}`} className="press grid h-11 w-11 place-items-center rounded-full bg-surface text-ink-soft">
                    <Icon name="external" size={18} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="m-0 px-1 text-footnote text-ink-soft">Orders are placed from your own account. Nearer never sees your payment details.</p>
      {data.sample && <p className="m-0 px-1 text-caption text-ink-faint">Sample mode: connections and orders are pretend.</p>}
    </div>
  );
}
