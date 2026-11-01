"use client";

import { useEffect, useState } from "react";
import { usePlayer } from "@/components/player";
import { useShell } from "@/components/shell";
import { useViewer } from "@/components/viewer";
import { mmdd as mmddOf } from "@/lib/birthday";
import { strings } from "@/lib/i18n";
import type { Card, Member, RitualRun, Wish } from "@/lib/schemas";
import { buildReelSegments, reelTitle, type ReelSegment } from "@/lib/reel";
import { memberPhoto } from "@/lib/people";
import { Icon, Photo, PlayButton } from "@/components/ui/kit";

// Petals: small falling dots over the reel. Pure CSS, still under
// prefers-reduced-motion (global rule kills the animation).
function Petals() {
  const petals = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {petals.map((i) => (
        <span
          key={i}
          className="reel-petal absolute top-0 inline-block h-2 w-2 rounded-full"
          style={{
            left: `${(i * 83) % 100}%`,
            background: i % 2 === 0 ? "#F5A524" : "#ffffff",
            animationDelay: `${(i * 0.7) % 4}s`,
            animationDuration: `${4 + ((i * 37) % 30) / 10}s`,
          }}
        />
      ))}
      <style>{`.reel-petal{animation:reel-fall 5s linear 2 both}@keyframes reel-fall{from{transform:translateY(-12px) rotate(0)}to{transform:translateY(640px) rotate(220deg)}}`}</style>
    </div>
  );
}

export function ReelPlayer({ runId }: { runId: string }) {
  const { lang, viewer, displayLang } = useViewer();
  const { play } = usePlayer();
  const { openAdd } = useShell();
  const t = strings(lang);
  const [run, setRun] = useState<RitualRun | null>(null);
  const [segments, setSegments] = useState<ReelSegment[] | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [kinship, setKinship] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch("/api/ritual-runs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/wishes?runId=${encodeURIComponent(runId)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/cards", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/members", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([runsData, wishesData, cardsData, membersData]: [
        { runs?: RitualRun[] } | null,
        { wishes?: Wish[] } | null,
        { cards?: Card[] } | null,
        { members?: Member[] } | null,
      ]) => {
        if (!live) return;
        const found = runsData?.runs?.find((r) => r.id === runId) ?? null;
        setRun(found);
        const ws: Wish[] = wishesData?.wishes ?? [];
        const cs: Card[] = cardsData?.cards ?? [];
        const ms: Member[] = membersData?.members ?? [];
        setCards(cs);
        setMembers(ms);
        if (found) {
          setSegments(buildReelSegments(found, ws, cs, ms));
          const celebrant = celebrantOf(found, ms);
          if (celebrant && celebrant.id !== viewer.id) {
            fetch(`/api/kinship?from=${viewer.id}&to=${celebrant.id}&lang=${displayLang}`, { cache: "no-store" })
              .then((r) => (r.ok ? r.json() : null))
              .then((data: { terms?: string } | null) => {
                if (live) setKinship(data?.terms ?? null);
              })
              .catch(() => undefined);
          }
        } else {
          setSegments([]);
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [runId, viewer.id, displayLang]);

  if (failed) return <p className="m-0 py-10 text-center text-[15px] text-ink-soft">Couldn&rsquo;t load the reel. Try again in a moment.</p>;
  if (segments === null || !run) return <div className="skeleton h-[560px] rounded-hero" aria-busy="true" aria-label="Loading reel" />;

  const celebrant = celebrantOf(run, members);
  const celebrantName = celebrant?.displayName ?? "the birthday star";
  const art = memberPhoto(celebrant) ?? "/demo/family-group.webp";

  if (segments.length === 0) {
    return (
      <div className="rounded-hero bg-surface px-6 py-14 text-center">
        <p className="m-0 text-[20px] font-semibold">Wishes are still arriving</p>
        <p className="m-0 mt-2 text-[15px] text-ink-soft">Record yours and it joins the reel.</p>
      </div>
    );
  }
  const current = segments[Math.min(index, segments.length - 1)];
  const quote = current.card ? current.card.transcript || current.card.caption : "";

  return (
    <div className="relative h-[620px] overflow-hidden rounded-hero bg-[#1d1714] text-white" style={{ boxShadow: "0 30px 60px -24px rgba(60,30,10,.7)" }}>
      <div className="absolute inset-[-40px]" aria-hidden="true" style={{ filter: "blur(40px) brightness(.55) saturate(1.3)" }}>
        <Photo src={art} alt="" sizes="200px" />
      </div>
      <Petals />
      <div className="relative flex h-full flex-col p-5">
        <div className="flex gap-1" aria-label={`Wish ${index + 1} of ${segments.length}`}>
          {segments.map((sg, i) => (
            <span key={sg.wish.id} className="h-[3px] flex-1 rounded-full" style={{ background: i <= index ? "#fff" : "rgba(255,255,255,.3)" }} />
          ))}
        </div>
        <p className="m-0 mt-5 text-[13px] text-white/70">{reelTitle(celebrantName, kinship)}</p>
        <div className="relative mx-auto mt-4 h-[220px] w-[220px] overflow-hidden rounded-full" style={{ boxShadow: "0 0 0 6px rgba(255,255,255,.12)" }}>
          <Photo src={memberPhoto(current.member) ?? art} alt={current.member?.displayName ?? "Family"} sizes="440px" priority position="center 30%" />
        </div>
        <p className="m-0 mt-4 text-center text-[17px] font-semibold">
          {current.member?.displayName ?? "Family"} · {current.wish.kind === "blessing" ? "a blessing" : "a wish"}
        </p>
        <p className="voice m-0 mt-3 line-clamp-4 flex-1 text-center text-[22px] leading-snug">
          {quote ? `“${quote}”` : `A ${current.wish.kind} from ${current.member?.displayName ?? "family"} is on its way.`}
        </p>
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} aria-label="Previous wish" className="press glass grid h-12 w-12 place-items-center rounded-full disabled:opacity-30">
            <Icon name="back" />
          </button>
          {current.card ? (
            <PlayButton size={64} playing={false} label="Play this wish" onClick={() => play(current.card as Card)} />
          ) : (
            <span className="h-16 w-16" />
          )}
          <button type="button" onClick={() => setIndex((i) => Math.min(segments.length - 1, i + 1))} disabled={index >= segments.length - 1} aria-label="Next wish" className="press glass grid h-12 w-12 place-items-center rounded-full disabled:opacity-30">
            <Icon name="chevron" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => openAdd("voice", { runId, kind: viewer.role === "elder" ? "blessing" : "wish" }, celebrant?.id ?? null)}
          className="press glass mt-4 flex h-12 items-center justify-center gap-2 rounded-full text-[15px] font-semibold"
        >
          <Icon name="mic" size={18} />
          {viewer.role === "elder" ? "Add your blessing" : "Add your wish"}
        </button>
        <span className="sr-only">{cards.length} memories available</span>
      </div>
    </div>
  );
}

// runId is "<slug>:<YYYY-MM-DD>". Birthday runs resolve the celebrant by
// matching the occasion month-day against member birthdays.
function celebrantOf(run: RitualRun, members: Member[]): Member | undefined {
  if (run.ritualSlug !== "birthday") return undefined;
  const mmdd = run.occasionDate.slice(5);
  return members.find((mem) => mmddOf(mem.birthday) === mmdd);
}
