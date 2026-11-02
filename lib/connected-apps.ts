// Settings → Connected apps: every app "Send something" can offer this family,
// grouped by where the homes are. For each country a family home is in (from the
// members' time zones, the same resolver as Send something): the partners we can
// connect (data/partners.json) and the link-out apps (data/send-apps.json).
// Pure given its inputs; the route supplies which accounts are connected/enabled.
import { householdName, households } from "./households";
import { PARTNERS, type Partner } from "./partners/registry";
import { callName } from "./people";
import type { Member, Relationship } from "./schemas";
import { appsFor, sendCountry } from "./send-apps";

/** Connected = OAuth done. Connect = OAuth available. No account = open stores. Link = opens their site. Soon = not live yet. */
export type AppStatus = "connected" | "connect" | "no-account" | "link" | "soon";

export interface AppRow {
  key: string;
  name: string;
  /** What it is for ("Groceries"). */
  what: string;
  status: AppStatus;
  url: string | null;
  /** The OAuth account to connect or disconnect. */
  accountId: string | null;
}
export interface AppGroup {
  key: string;
  /** "For Maa & Papa · India" */
  label: string;
  country: string;
  rows: AppRow[];
}

const KIND_LABEL: Record<Partner["kind"], string> = { groceries: "Groceries", food: "Food", dining: "Dining", gifts: "Gifts", "home-services": "House help" };

function countryLabel(code: string): string {
  if (code === "*") return "Elsewhere";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function connectedGroups(input: {
  members: Member[];
  relationships: Relationship[];
  /** OAuth accounts this member has connected. */
  connected: ReadonlySet<string>;
  accountOn: (accountId: string) => boolean;
  partnerOn: (p: Partner) => boolean;
}): AppGroup[] {
  const members = input.members.filter((m) => m.status !== "pending");
  const byCountry = new Map<string, string[]>();
  for (const h of households(members, input.relationships)) {
    const code = sendCountry(h.tz);
    byCountry.set(code, [...(byCountry.get(code) ?? []), householdName(h, callName)]);
  }
  return Array.from(byCountry, ([code, names]) => {
    const rows: AppRow[] = [];
    const seen = new Set<string>();
    for (const p of PARTNERS.filter((x) => x.countries.includes(code))) {
      const on = input.partnerOn(p);
      let status: AppStatus = "soon";
      if (on && p.transport === "mcp-oauth") status = p.account && input.accountOn(p.account) ? (input.connected.has(p.account) ? "connected" : "connect") : "soon";
      else if (on && p.transport === "mcp-public") status = "no-account";
      else if (on) status = "link";
      seen.add(p.name.toLowerCase());
      rows.push({ key: `p-${p.id}`, name: p.name, what: KIND_LABEL[p.kind], status, url: status === "link" ? (p.url ?? null) : null, accountId: p.transport === "mcp-oauth" ? p.account : null });
    }
    for (const c of appsFor(code).categories)
      for (const a of c.apps) {
        if (seen.has(a.name.toLowerCase())) continue;
        seen.add(a.name.toLowerCase());
        rows.push({ key: `l-${c.id}-${a.name}`, name: a.name, what: c.label, status: "link", url: a.url, accountId: null });
      }
    return { key: code, label: `For ${names.join(", ")} · ${countryLabel(code)}`, country: code, rows };
  });
}
