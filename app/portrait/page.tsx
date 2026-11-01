"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Avatar, Button, Icon, RoomHeader, SectionTitle } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { resolveMediaUrl } from "@/lib/media-session";
import { canvasBlob, keepRender, markResult, paintSamplePortrait } from "@/lib/muse-canvas";
import { canInclude, canStartPortrait, PORTRAIT_MARK, PORTRAIT_MAX_PEOPLE, PORTRAIT_STYLES, STYLE_LOOK, type PortraitStyle } from "@/lib/muse-portrait";
import { callName, memberPhoto } from "@/lib/people";
import type { Card, Member } from "@/lib/schemas";
import { useFamilyCards } from "@/lib/use-family";
import { useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { Boundary } from "@/components/ui/boundary";

// Family portrait: pick who's in it, pick a painted style, and Muse paints one
// portrait from the family's own photos. Nothing is shared until you tap Keep;
// the kept card says "Painted by Muse" in the image and in every viewer.

const SWATCH: Record<PortraitStyle, string> = {
  watercolour: "linear-gradient(135deg,#fbf4e6 0%,#f3d9b8 45%,#b7d3d8 100%)",
  oil: "linear-gradient(135deg,#7a4a2a 0%,#3b2414 60%,#c08a4a 100%)",
  pencil: "linear-gradient(135deg,#f7f1e3 0%,#cfc8bb 55%,#6b6a66 100%)",
  festive: "linear-gradient(135deg,#ffe2a8 0%,#f6b21a 50%,#e8641c 100%)",
};

type Phase = { at: "pick" } | { at: "painting" } | { at: "result"; runId: string; url: string; blob: Blob; sample: boolean } | { at: "kept" };

function photoOf(card: Card | undefined): string | null {
  if (!card) return null;
  return resolveMediaUrl(card.mediaRef) ?? resolveMediaUrl(card.coverRef);
}

function PortraitInner() {
  const { viewer, members, relationships } = useViewer();
  const params = useSearchParams();
  const { cards } = useFamilyCards();
  const quota = useJson<{ left: number; sample: boolean }>("/api/muse/portrait");
  const allowed = canStartPortrait(viewer);

  // Who may be in it, and who has a photo to paint from.
  const people = useMemo(() => {
    const me = members.filter((m) => m.id === viewer.id);
    const rest = members.filter((m) => m.id !== viewer.id && m.status !== "pending").sort((a, b) => rank(a) - rank(b));
    return [...me, ...rest].map((m) => ({ m, ok: canInclude(viewer, m, members, relationships), photo: memberPhoto(m) }));
  }, [members, viewer, relationships]);
  const photoCards = useMemo(() => (cards ?? []).filter((c) => c.type === "photo" && c.source !== "muse-portrait" && photoOf(c)).slice(0, 24), [cards]);

  // Until the person changes it: everyone with a photo you may include (or the people the link named).
  const [manual, setManual] = useState<string[] | null>(null);
  const [cardFor, setCardFor] = useState<Record<string, string>>({});
  const [choosingFor, setChoosingFor] = useState<string | null>(null);
  const [style, setStyle] = useState<PortraitStyle>("watercolour");
  const [phase, setPhase] = useState<Phase>({ at: "pick" });
  const [variant, setVariant] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const named = params.get("people") ?? "";
  const defaults = useMemo(() => {
    const want = named.split(",").filter(Boolean);
    const pool = people.filter((p) => p.ok && p.photo).map((p) => p.m.id);
    return (want.length ? pool.filter((id) => want.includes(id)) : pool).slice(0, PORTRAIT_MAX_PEOPLE);
  }, [people, named]);
  const picked = manual ?? defaults;
  const toggle = (id: string) => setManual(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(0, PORTRAIT_MAX_PEOPLE));
  const srcFor = (m: Member) => photoOf(photoCards.find((c) => c.id === cardFor[m.id])) ?? memberPhoto(m);

  const paint = async (nextVariant = variant) => {
    setError(null);
    setPhase({ at: "painting" });
    try {
      const res = await fetch("/api/muse/portrait", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ people: picked.map((id) => ({ memberId: id, ...(cardFor[id] ? { cardId: cardFor[id] } : {}) })), style, variant: nextVariant }),
      });
      const out = (await res.json().catch(() => ({}))) as { runId?: string; image?: string; sample?: boolean; error?: string };
      if (!res.ok || !out.runId) throw new Error(out.error ?? "failed");
      const canvas = out.image
        ? await markResult(out.image, PORTRAIT_MARK)
        : await paintSamplePortrait(
            picked.map((id) => srcFor(members.find((m) => m.id === id)!)).filter((s): s is string => Boolean(s)),
            style,
            PORTRAIT_MARK,
          );
      const blob = await canvasBlob(canvas);
      setPhase({ at: "result", runId: out.runId, url: URL.createObjectURL(blob), blob, sample: Boolean(out.sample) });
      void quota.reload();
    } catch (e) {
      const code = (e as Error).message;
      setError(
        code === "daily-limit"
          ? "That's today's portraits for your family. Try again tomorrow."
          : code === "spend-cap"
            ? "Muse is resting for now. Try again later."
            : code === "child-not-allowed"
              ? "A child can be in a portrait only when a parent or someone at home makes it."
              : "Muse couldn't paint this one. Try again in a moment.",
      );
      setPhase({ at: "pick" });
    }
  };

  const keep = async () => {
    if (phase.at !== "result") return;
    setError(null);
    const ok = await keepRender({ runId: phase.runId, blob: phase.blob, caption: phase.sample ? "A sample family portrait (Muse was off)" : "" });
    if (ok) setPhase({ at: "kept" });
    else setError("Couldn't keep it. Try again.");
  };

  if (!allowed) {
    return (
      <div>
        <RoomHeader title="Portrait" subtitle="Muse paints all of you, from your own photos" />
        <div className="rounded-card bg-surface p-4">
          <p className="m-0 text-headline font-semibold">Ask a grown-up to make one</p>
          <p className="m-0 mt-1 text-body text-ink-soft">A parent or someone at home can paint a family portrait with you in it.</p>
        </div>
      </div>
    );
  }

  if (phase.at === "kept") {
    return (
      <div>
        <RoomHeader title="Portrait" />
        <div className="rounded-hero bg-surface px-6 py-10 text-center">
          <Icon name="check" size={28} className="mx-auto" />
          <p className="m-0 mt-3 text-title font-semibold">Kept for the family</p>
          <p className="mx-auto mt-1 max-w-[300px] text-body text-ink-soft">It&rsquo;s in Memory Lane, marked &ldquo;Painted by Muse&rdquo;.</p>
          <div className="mt-5 flex justify-center gap-2">
            <Link href="/lane" className="press flex h-12 items-center rounded-full bg-black px-6 text-body font-semibold text-white no-underline">
              Open Memory Lane
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (phase.at === "painting" || phase.at === "result") {
    return (
      <div>
        <RoomHeader title="Portrait" subtitle={phase.at === "painting" ? "Muse is painting…" : "Look it over. Nothing is shared until you keep it."} />
        {phase.at === "painting" ? (
          <div className="skeleton aspect-[4/3] w-full rounded-[26px]" aria-busy="true" aria-label="Painting your portrait" />
        ) : (
          <figure className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={phase.url} alt={`A painted family portrait of ${picked.length} people, marked Painted by Muse`} className="block w-full rounded-[26px] shadow-frost" />
            <figcaption className="mt-2 flex items-center gap-1.5 text-footnote text-ink-soft">
              <Icon name="sparkle" size={14} />
              {phase.sample ? "Sample: Muse is off, so this was painted on your phone from your photos." : `Painted by Muse from ${picked.length} family photos. A painting, not a photo.`}
            </figcaption>
          </figure>
        )}
        {error && <p className="m-0 mt-3 text-callout text-[#b42318]" role="alert">{error}</p>}
        {phase.at === "result" && (
          <div className="mt-5 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => { const v = variant + 1; setVariant(v); void paint(v); }}>
              Try again
            </Button>
            <Button className="flex-[1.4]" onClick={() => void keep()}>
              <Icon name="check" size={18} />
              Keep
            </Button>
          </div>
        )}
        {phase.at === "result" && (
          <button type="button" onClick={() => setPhase({ at: "pick" })} className="press mx-auto mt-2 block h-11 text-callout font-medium text-ink-soft">
            Change people or style
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <RoomHeader title="Portrait" subtitle="Muse paints all of you, from your own photos" />

      <SectionTitle>Who&rsquo;s in it</SectionTitle>
      {people.length === 0 ? (
        <div className="skeleton h-[200px] rounded-card" aria-busy="true" aria-label="Loading your family" />
      ) : (
        <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0" aria-label="People in the portrait">
          {people.map(({ m, ok, photo }) => {
            const on = picked.includes(m.id);
            const usable = ok && Boolean(srcFor(m) ?? photo);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={!usable}
                  onClick={() => toggle(m.id)}
                  className={cn("press relative flex w-full flex-col items-center rounded-[20px] px-1 pb-2.5 pt-3", on ? "bg-black text-white" : "bg-surface text-ink", !usable && "opacity-45")}
                >
                  <span className="relative">
                    <Avatar src={srcFor(m)} name={callName(m)} size={48} />
                    {on && (
                      <span className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full bg-white text-black ring-2 ring-black" aria-hidden="true">
                        <Icon name="check" size={14} />
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 block max-w-full truncate text-callout font-semibold">{m.id === viewer.id ? "You" : callName(m)}</span>
                  <span className={cn("block text-caption", on ? "text-white/70" : "text-ink-soft")}>{!ok ? "Their parent can add" : !(srcFor(m) ?? photo) ? "No photo yet" : on ? "In" : "Tap to add"}</span>
                </button>
                {on && photoCards.length > 0 && (
                  <button type="button" onClick={() => setChoosingFor(choosingFor === m.id ? null : m.id)} className="press mt-0.5 block h-9 w-full text-caption font-medium text-ink-soft">
                    {cardFor[m.id] ? "Other photo ✓" : "Use another photo"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {choosingFor && (
        <div className="mt-3 rounded-card bg-surface p-3">
          <p className="m-0 mb-2 px-1 text-footnote font-medium text-ink-soft">A photo of {callName(members.find((m) => m.id === choosingFor))} from the family&rsquo;s photos</p>
          <div className="grid grid-cols-4 gap-1.5">
            <button type="button" onClick={() => { setCardFor(({ [choosingFor]: _drop, ...rest }) => (void _drop, rest)); setChoosingFor(null); }} className={cn("press grid aspect-square place-items-center rounded-[12px] bg-white text-caption font-medium", !cardFor[choosingFor] && "ring-2 ring-black")}>
              Profile
            </button>
            {photoCards.map((c) => (
              <button key={c.id} type="button" aria-label="Use this photo" onClick={() => { setCardFor((v) => ({ ...v, [choosingFor]: c.id })); setChoosingFor(null); }} className={cn("press aspect-square overflow-hidden rounded-[12px] bg-white", cardFor[choosingFor] === c.id && "ring-2 ring-black")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoOf(c) ?? ""} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      <SectionTitle>Style</SectionTitle>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Style">
        {PORTRAIT_STYLES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={style === s} onClick={() => setStyle(s)} className={cn("press flex items-center gap-3 rounded-[20px] p-2.5 text-left", style === s ? "bg-black text-white" : "bg-surface text-ink")}>
            <span className="h-11 w-11 shrink-0 rounded-[12px]" style={{ background: SWATCH[s] }} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-body font-semibold leading-tight">{STYLE_LOOK[s].label}</span>
              <span className={cn("block truncate text-caption", style === s ? "text-white/70" : "text-ink-soft")}>{STYLE_LOOK[s].note}</span>
            </span>
          </button>
        ))}
      </div>

      <p className="m-0 mt-5 text-footnote leading-snug text-ink-soft">
        Always a painting, never a photo, and only the people you chose. Nothing is shared until you keep it.
        {quota.data && ` ${quota.data.left} left today.`}
        {quota.data?.sample && " Muse is off here, so you'll see a sample painted on your phone."}
      </p>
      {error && <p className="m-0 mt-3 text-callout text-[#b42318]" role="alert">{error}</p>}
      <Button className="mt-4 w-full" disabled={picked.length < 1 || quota.data?.left === 0} onClick={() => void paint()}>
        <Icon name="sparkle" size={18} />
        {picked.length > 1 ? `Paint all ${picked.length} of you` : "Paint the portrait"}
      </Button>
    </div>
  );
}

function rank(m: Member): number {
  return m.role === "elder" ? 0 : m.role === "adult" ? 1 : 2;
}

export default function PortraitPage() {
  return (
    <Suspense fallback={<div className="skeleton mt-6 h-[320px] rounded-card" aria-busy="true" />}>
      <Boundary label="Portrait"><PortraitInner /></Boundary>
    </Suspense>
  );
}
