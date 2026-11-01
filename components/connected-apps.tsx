"use client";

import { useState } from "react";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./ui/kit";

// Settings → Connected apps: the curated partners, and which of your own
// accounts are connected. Connecting is OAuth on the partner's site; the
// token stays on our server and is never shown here.

interface Account {
  id: string;
  name: string;
  connected: boolean;
  connectedAt: string | null;
  partners: string[];
}

interface Open {
  id: string;
  name: string;
  kind: string;
  transport: "mcp-public" | "link";
  url: string | null;
}

const OPEN_ICON: Record<string, IconName> = { gifts: "gift", "home-services": "wrench" };

function Dot({ on }: { on: boolean }) {
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", on ? "bg-[#2f9e5b]" : "bg-black/20")} aria-hidden="true" />;
}

export function ConnectedApps() {
  const { data, failed, reload } = useJson<{ sample: boolean; accounts: Account[]; open: Open[] }>("/api/partners");
  const [busy, setBusy] = useState<string | null>(null);

  if (failed)
    return (
      <div id="connected-apps" className="rounded-[22px] bg-surface px-4 py-5 text-center">
        <p className="m-0 text-[15px] text-ink-soft">Couldn&rsquo;t load your apps.</p>
        <button type="button" onClick={() => void reload()} className="press mt-2 h-11 rounded-full bg-white px-4 text-[14px] font-semibold">
          Try again
        </button>
      </div>
    );
  if (!data) return <div key="loading" id="connected-apps" className="skeleton h-[200px] rounded-[22px]" aria-busy="true" aria-label="Loading connected apps" />;

  const disconnect = async (a: Account) => {
    setBusy(a.id);
    await postJson(`/api/partners/${encodeURIComponent(a.id)}/connect`, {}, "DELETE");
    await reload();
    setBusy(null);
  };

  return (
    <div id="connected-apps">
      <ul className="m-0 list-none divide-y divide-[var(--line)] rounded-[22px] bg-surface p-0 px-4">
        {data.accounts.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-[15px] font-semibold text-ink" aria-hidden="true">
              {a.name.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[16px] font-semibold">
                {a.name}
                <Dot on={a.connected} />
              </span>
              <span className="block truncate text-[13px] text-ink-soft">{a.partners.join(" · ")}<span className="sr-only">{a.connected ? ", connected" : ", not connected"}</span></span>
            </span>
            {a.connected ? (
              <button type="button" disabled={busy === a.id} onClick={() => void disconnect(a)} aria-label={`Disconnect ${a.name}`} className="press h-11 rounded-full bg-white px-4 text-[14px] font-semibold text-ink-soft disabled:opacity-40">
                Disconnect
              </button>
            ) : (
              <a href={`/api/partners/${encodeURIComponent(a.id)}/connect`} className="press flex h-11 items-center rounded-full bg-ink px-4 text-[14px] font-semibold text-white no-underline">
                Connect
              </a>
            )}
          </li>
        ))}
        {data.open.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-ink-soft" aria-hidden="true">
              <Icon name={OPEN_ICON[p.kind] ?? "store"} size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-semibold">{p.name}</span>
              <span className="block truncate text-[13px] text-ink-soft">{p.transport === "link" ? "Opens their site" : "No account needed · pay at the store"}</span>
            </span>
            {p.url && (
              <a href={p.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${p.name}`} className="press grid h-10 w-10 place-items-center rounded-full bg-white text-ink-soft">
                <Icon name="external" size={18} />
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="m-0 mt-3 px-1 text-[13px] text-ink-soft">Orders are placed from your own account. Aangan never sees your payment details.</p>
      {data.sample && <p className="m-0 mt-1 px-1 text-[12px] text-ink-faint">Sample mode: connections and orders are pretend.</p>}
    </div>
  );
}
