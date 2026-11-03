"use client";

import { useState, useSyncExternalStore } from "react";
import { isGrownUp } from "@/lib/permissions";
import { joinLink, whatsappInvite } from "@/lib/invite-link";
import { callName, memberPhoto } from "@/lib/people";
import type { Member, Relationship } from "@/lib/schemas";
import { resetFamilyCards } from "@/lib/use-family";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { BottomSheet } from "./ui/bottom-sheet";
import { Avatar, Button, Icon } from "./ui/kit";
import { useViewer } from "./viewer";

// Two courtyards, one door. A couple and their children belong to both
// families' homes; each side stays its own (nothing crosses unless shared).

export interface Side {
  familyId: string;
  memberId: string;
  name: string;
  people: number;
  /** Who started that family (their call name), null when it was you. */
  addedBy?: string | null;
  /** Things others shared there this week. */
  fresh?: number;
}

export function useSides(enabled = true) {
  const { data, failed, reload } = useJson<{ current: string; sides: Side[] }>(enabled ? "/api/sides" : null);
  return { sides: data?.sides ?? [], current: data?.current ?? null, loading: data === null && !failed, failed, reload };
}

// The side being opened, from the tap until its courtyard has answered: its name (and its home
// photo) show in the header at once, while the rest is read.
let opening: { familyId: string; name: string } | null = null;
const openingListeners = new Set<() => void>();
function setOpening(next: { familyId: string; name: string } | null): void {
  opening = next;
  openingListeners.forEach((l) => l());
}

/** The side whose courtyard is being opened (null when none). */
export function useOpeningSide(): { familyId: string; name: string } | null {
  return useSyncExternalStore(
    (l) => {
      openingListeners.add(l);
      return () => openingListeners.delete(l);
    },
    () => opening,
    () => null,
  );
}

/** The opened side's courtyard has answered: the header goes back to reading it. */
export function doneOpening(familyId: string): void {
  if (opening?.familyId === familyId) setOpening(null);
}

export async function openSide(side: Pick<Side, "familyId" | "name">): Promise<void> {
  const home = window.location.pathname === "/";
  if (home) setOpening({ familyId: side.familyId, name: side.name });
  const out = await postJson("/api/sides", { action: "switch", familyId: side.familyId });
  if (!out) {
    setOpening(null);
    return;
  }
  resetFamilyCards();
  // Everything re-reads for the other side at once (session, family, courtyard, cards, window), and
  // nothing of this side comes back from the caches: the courtyard remounts for the new family.
  window.dispatchEvent(new Event("aangan:auth"));
  // From elsewhere (Settings), the courtyard is where a switch lands, as before.
  if (!home) window.location.assign("/");
}

/** "Sharma · Iyer" under the courtyard title, only when you have two sides. */
export function SideSwitch() {
  const { sides, current } = useSides();
  const [busy, setBusy] = useState<string | null>(null);
  if (sides.length < 2) return null;
  return (
    <div className="mt-3 inline-flex rounded-full bg-well p-1" role="tablist" aria-label="Family side">
      {sides.map((s) => (
        <button
          key={s.familyId}
          type="button"
          role="tab"
          aria-selected={s.familyId === current}
          disabled={busy !== null}
          onClick={() => {
            if (s.familyId === current) return;
            setBusy(s.familyId);
            void openSide(s).finally(() => setBusy(null));
          }}
          className={cn("press h-9 rounded-full px-4 text-callout font-semibold", s.familyId === current ? "bg-accent text-accent-ink" : "text-ink-soft")}
        >
          {busy === s.familyId ? "Opening…" : `${s.name} side`}
        </button>
      ))}
    </div>
  );
}

/** My spouse and children in this family: the "door" that comes with me. */
export function myHome(viewerId: string, members: Member[], rels: Relationship[]): Member[] {
  const ids = new Set<string>();
  for (const r of rels) {
    if (r.memberId === viewerId && (r.canonicalKind === "spouse" || r.canonicalKind === "child")) ids.add(r.relationMemberId);
    if (r.relationMemberId === viewerId && (r.canonicalKind === "spouse" || r.canonicalKind === "parent")) ids.add(r.memberId);
  }
  return members.filter((m) => ids.has(m.id));
}

/**
 * "You're in N families": each family that added you, who added you, what's
 * new there, and a switch. Never the other families' trees.
 * Join another family = open its link (/join/<CODE>) while signed in.
 */
export function BothSides() {
  const { viewer, members, relationships } = useViewer();
  const { sides, current, loading, failed, reload } = useSides();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const grownUp = isGrownUp(viewer) && viewer.role !== "child";
  const demo = viewer.familyId.startsWith("demo-");
  const n = sides.length;
  return (
    <section aria-label="Your families" className="mt-10">
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 text-title">{n > 1 ? `You're in ${n} families` : "Your family"}</h2>
        {grownUp && !demo && n < 4 && (
          <div className="flex gap-1">
            <a href="/join" aria-label="Join another family with a link" className="press grid h-10 w-10 place-items-center rounded-full bg-surface text-ink no-underline">
              <Icon name="key" size={18} />
            </a>
            <button type="button" aria-label="Start a family for your side" onClick={() => setAdding(true)} className="press grid h-10 w-10 place-items-center rounded-full bg-surface">
              <Icon name="plus" size={18} />
            </button>
          </div>
        )}
      </div>
      <p className="m-0 mb-3 mt-1 min-h-[42px] text-callout text-ink-soft">{n > 1 ? "Each family keeps its own tree. Switch to see theirs." : "Married into another family? Open the link they send you: you'll be in both."}</p>
      {loading && <div className="skeleton h-[68px] rounded-card" aria-busy="true" aria-label="Loading families" />}
      {failed && (
        <button type="button" onClick={() => void reload()} className="press h-11 w-full rounded-full bg-surface text-callout text-ink-soft">
          Couldn&rsquo;t load your families. Tap to retry.
        </button>
      )}
      {n > 0 && (
        <ul className="no-scrollbar -mx-4 m-0 flex list-none snap-x gap-2 overflow-x-auto px-4 p-0">
          {sides.map((s) => {
            const here = s.familyId === current;
            return (
              <li key={s.familyId} className="w-[64%] max-w-[240px] shrink-0 snap-start">
                <button
                  type="button"
                  disabled={here || busy !== null}
                  aria-label={here ? `${s.name}, you're here` : `Switch to ${s.name}`}
                  onClick={() => {
                    setBusy(s.familyId);
                    void openSide(s);
                  }}
                  className={cn("press flex w-full items-center gap-3 rounded-card p-3 text-left", here ? "bg-accent text-accent-ink" : "bg-surface")}
                >
                  <span className={cn("relative grid h-11 w-11 shrink-0 place-items-center rounded-full text-headline font-bold", here ? "bg-accent-ink/15" : "bg-well")}>
                    {s.name.slice(0, 1)}
                    {!here && (s.fresh ?? 0) > 0 && <span className="tnum absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-caption font-semibold text-accent-ink">{s.fresh}</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold">{s.name}</span>
                    <span className={cn("block truncate text-caption", here ? "text-accent-ink/70" : "text-ink-soft")}>
                      {busy === s.familyId ? "Opening…" : here ? "You're here" : s.addedBy ? `Added by ${s.addedBy}` : `${s.people} people`}
                    </span>
                  </span>
                  {!here && <Icon name="chevron" size={16} className="text-ink-faint" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {grownUp && demo && <p className="m-0 mt-2 text-footnote text-ink-faint">In your own family, you can join or start another family here.</p>}
      {adding && <AddSideSheet home={myHome(viewer.id, members, relationships)} onClose={() => setAdding(false)} />}
    </section>
  );
}

export function AddSideSheet({ home, onClose }: { home: Member[]; onClose: () => void }) {
  const [name, setName] = useState("");
  const [bring, setBring] = useState<string[]>(home.map((m) => m.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ familyId: string; invite: { code: string } } | null>(null);
  return (
    <BottomSheet open onClose={onClose} title={made ? `The ${name.trim()} Nearer is ready` : "Add your family\u2019s side"} z={50}>
      <div>
        {made ? (
          <>
            <p className="m-0 text-body text-ink-soft">Send this link to your parents, brothers and sisters. It works for 7 days.</p>
            <p dir="ltr" className="m-0 mt-4 break-all rounded-[22px] bg-surface px-4 py-4 text-center text-headline font-semibold">{joinLink(window.location.origin, made.invite.code).replace(/^https?:\/\//, "")}</p>
            <a href={whatsappInvite(window.location.origin, made.invite.code)} target="_blank" rel="noopener noreferrer" className="press mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-body font-semibold text-accent-ink no-underline">
              <Icon name="whatsapp" size={20} />
              Send on WhatsApp
            </a>
            <Button
              variant="secondary"
              className="mt-2 w-full"
              onClick={() => {
                window.dispatchEvent(new Event("aangan:auth"));
                window.location.assign("/");
              }}
            >
              Open the {name.trim()} family
            </Button>
          </>
        ) : (
          <>
            <p className="m-0 text-body text-ink-soft">A separate home for your parents&rsquo; family. Nothing from this side shows there unless you share it.</p>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-footnote font-medium text-ink-soft">Family name</span>
              <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder="Your parents' family name" className="h-12 w-full rounded-full bg-surface px-5 text-body outline-none focus:ring-2 focus:ring-black/15" />
            </label>
            {home.length > 0 && (
              <>
                <p className="m-0 mb-2 mt-4 text-footnote font-medium text-ink-soft">Your home comes with you</p>
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {home.map((m) => {
                    const on = bring.includes(m.id);
                    return (
                      <li key={m.id}>
                        <button type="button" aria-pressed={on} onClick={() => setBring((b) => (on ? b.filter((x) => x !== m.id) : [...b, m.id]))} className={cn("press flex h-11 items-center gap-2 rounded-full pl-1 pr-4 text-body font-medium", on ? "bg-accent text-accent-ink" : "bg-surface")}>
                          <Avatar src={memberPhoto(m)} name={callName(m)} size={34} />
                          {callName(m)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {error && (
              <p className="m-0 mt-3 text-callout text-[#b42318]" role="alert">
                {error}
              </p>
            )}
            <Button
              className="mt-5 w-full"
              disabled={busy || !name.trim()}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const out = await postJson<{ familyId: string; invite: { code: string } }>("/api/sides", { action: "create", familyName: name.trim(), bring });
                setBusy(false);
                if (out) {
                  resetFamilyCards();
                  setMade(out);
                } else setError("Couldn't create it. Try again in a moment.");
              }}
            >
              {busy ? "Creating…" : "Create the family"}
            </Button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
