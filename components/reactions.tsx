"use client";

import { useCallback, useEffect, useState } from "react";
import { strings } from "@/lib/i18n";
import { REACTION_ORDER, REACTION_WORD, toggleReaction } from "@/lib/reaction-names";
import { memberPhoto } from "@/lib/people";
import { Avatar, Icon } from "./ui/kit";
import { ReactionGlyph } from "./ui/glyphs";
import type { Member, Play, Reaction } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { useViewer } from "./viewer";
import { heardLine } from "@/lib/voice";

// What the family calls this person (Dadi, Dad, Maa). Same word in every UI language.
function kinshipName(member: Member | undefined, _displayLang: string): string {
  if (!member) return "Family";
  return member.displayName || member.firstName;
}

async function fetchMembers(): Promise<Member[]> {
  try {
    const res = await fetch("/api/members", { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { members: Member[] };
    return data.members;
  } catch {
    return [];
  }
}

// Heard loop: the latest play by someone other than the viewer,
// e.g. "Dadi heard this · 09:14". Plain text, never a count.
export function HeardChip({ cardId }: { cardId: string }) {
  const { viewer, displayLang } = useViewer();
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch(`/api/plays?cardId=${encodeURIComponent(cardId)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetchMembers(),
    ]).then(([playsData, members]: [{ plays?: Play[] } | null, Member[]]) => {
      if (!live) return;
      const plays = playsData?.plays ?? [];
      const other = plays.find((p) => p.memberId !== viewer.id) ?? plays[0];
      if (!other) {
        setLine(null);
        return;
      }
      const member = members.find((m) => m.id === other.memberId);
      setLine(heardLine(kinshipName(member, displayLang), other.playedAt, displayLang));
    });
    return () => {
      live = false;
    };
  }, [cardId, viewer.id, displayLang]);

  if (!line) return null;
  return <p className="m-0 text-caption text-ink-soft">{line}</p>;
}

const KINDS = REACTION_ORDER;

/** Send a blessing on a card (the "bless" reaction). True when it landed. */
export async function sendBlessing(cardId: string, memberId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/reactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cardId, memberId, kind: "bless" }) });
    return res.ok;
  } catch {
    return false;
  }
}

// Exactly three reactions as text buttons. Never a count: a reaction is a
// gesture to the sender, not a tally (who reacted shows as names, see
// ReactorsLine). One per member per card; tapping replaces the prior kind.
// Long-press on Bless replies by voice.
export function ReactionBar({ cardId, tone = "light", onReply }: { cardId: string; compact?: boolean; tone?: "light" | "glass"; onReply?: () => void }) {
  const { viewer, displayLang } = useViewer();
  const t = strings(displayLang);
  const [reactions, setReactions] = useState<Reaction[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/reactions?cardId=${encodeURIComponent(cardId)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { reactions: Reaction[] };
        setReactions(data.reactions);
      }
    } catch {
      // Offline: keep prior state.
    }
  }, [cardId]);

  useEffect(() => {
    setReactions(null);
    void load();
  }, [load]);

  const react = async (kind: (typeof KINDS)[number]) => {
    // Tapping your current reaction again takes it back.
    const mine = reactions?.find((r) => r.memberId === viewer.id);
    try {
      const res =
        mine?.kind === kind
          ? await fetch("/api/reactions", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ cardId }) })
          : await fetch("/api/reactions", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ cardId, memberId: viewer.id, kind }),
            });
      if (res.ok) await load();
    } catch {
      // Offline: keep prior state.
    }
  };

  const labelFor = (kind: (typeof KINDS)[number]): string =>
    kind === "love" ? t.reactions.love : kind === "laugh" ? t.reactions.laugh : t.reactions.bless;

  const mine = reactions?.find((r) => r.memberId === viewer.id)?.kind;
  const glass = tone === "glass";

  return (
    <div>
      <div
        className={cn("flex items-stretch gap-1 rounded-full p-1", glass ? "glass" : "bg-surface")}
        role="group"
        aria-label="React"
      >
        {KINDS.map((kind) => {
          const on = mine === kind;
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={on}
              onClick={() => void react(kind)}
              title={labelFor(kind)}
              className={cn(
                "press flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full text-body font-medium",
                on ? (glass ? "bg-white text-black" : "bg-accent text-accent-ink") : glass ? "text-accent-ink" : "text-ink",
              )}
            >
              <ReactionGlyph kind={kind} selected={on} size={22} />
              {labelFor(kind)}
            </button>
          );
        })}
        {onReply && (
          <button
            type="button"
            onClick={onReply}
            className={cn("press flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full text-body font-medium", glass ? "text-white" : "text-ink")}
          >
            <Icon name="reply" size={18} />
            Reply
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------- who reacted, by name */

/** The family's reactions on one card, with an optimistic toggle for the viewer. */
export function useCardReactions(cardId: string | null) {
  const { viewer } = useViewer();
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const load = useCallback(async () => {
    if (!cardId) return;
    try {
      const res = await fetch(`/api/reactions?cardId=${encodeURIComponent(cardId)}`, { cache: "no-store" });
      if (res.ok) setReactions(((await res.json()) as { reactions: Reaction[] }).reactions);
    } catch {
      // Offline: keep what we have.
    }
  }, [cardId]);
  useEffect(() => {
    setReactions([]);
    void load();
  }, [load]);
  const mine = reactions.find((r) => r.memberId === viewer.id)?.kind ?? null;
  const toggle = async (kind: Reaction["kind"]) => {
    if (!cardId) return;
    const takeBack = mine === kind;
    setReactions((list) => toggleReaction(list, viewer.id, cardId, kind));
    try {
      const res = takeBack
        ? await fetch("/api/reactions", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ cardId }) })
        : await fetch("/api/reactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cardId, memberId: viewer.id, kind }) });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      // Didn't land: show the truth again.
    }
    await load();
  };
  return { reactions, mine, toggle };
}

/** Small avatars with names and their reaction, on a dark ground. Nothing when nobody reacted. */
export function ReactorsLine({ reactions, className }: { reactions: Reaction[]; className?: string }) {
  const { viewer, members } = useViewer();
  const rows = [...reactions].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).flatMap((r) => {
    const m = members.find((mm) => mm.id === r.memberId);
    if (!m) return [];
    return [{ r, m, name: r.memberId === viewer.id ? "You" : m.displayName || m.firstName }];
  });
  if (!rows.length) return null;
  return (
    <ul className={cn("m-0 flex list-none flex-wrap items-center gap-x-1 gap-y-1.5 p-0", className)} aria-label="Reactions from the family">
      {rows.map(({ r, m, name }, i) => (
        <li key={r.memberId} className="flex items-center gap-1.5 text-body font-medium text-white">
          {i > 0 && (
            <span className="px-1 text-white/45" aria-hidden="true">
              ·
            </span>
          )}
          <Avatar src={memberPhoto(m)} name={name} size={24} />
          <span>{name}</span>
          <ReactionGlyph kind={r.kind} selected size={22} label />
        </li>
      ))}
    </ul>
  );
}

/** Three quiet emoji buttons; the one you chose is lit, tap it again to take it back. */
export function ReactButtons({ mine, onToggle, className }: { mine: Reaction["kind"] | null; onToggle: (kind: Reaction["kind"]) => void; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5", className)} role="group" aria-label="React">
      {REACTION_ORDER.map((kind) => {
        const on = mine === kind;
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={on}
            aria-label={on ? `Take back your ${REACTION_WORD[kind]}` : `Send ${REACTION_WORD[kind]}`}
            onClick={() => onToggle(kind)}
            className={cn("press grid h-12 w-12 shrink-0 place-items-center rounded-full text-title transition-colors", on ? "bg-white shadow-[0_0_0_2px_rgba(255,255,255,.9)]" : "bg-white/15 backdrop-blur")}
          >
            <ReactionGlyph kind={kind} selected={on} size={26} className={on ? "text-black" : "text-white"} />
          </button>
        );
      })}
    </div>
  );
}
