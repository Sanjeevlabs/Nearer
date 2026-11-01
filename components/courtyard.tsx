"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { CareSettings, Knock, Presence, Sitting } from "@/lib/kinds";
import { callName, cardCover, memberPhoto, peopleByRecency, relativeDay } from "@/lib/people";
import type { Card, Member } from "@/lib/schemas";
import { useDisplayText } from "@/lib/use-display-text";
import { useEvents } from "@/lib/gather-client";
import { useCourtyard } from "@/lib/courtyard-data";
import { HERO_SIZES } from "@/lib/hero";
import { useFamilyCards } from "@/lib/use-family";
import { ago, postJson, useJson } from "@/lib/use-json";
import { isAwake, placeFromTz, timeIn } from "@/lib/zones";
import { DEFAULT_VENUE, venueOf, type VenueId } from "@/lib/venues";
import { Carousel } from "./carousel";
import { MyNeeds, MyQuestions, StoryDoor, VisitCountdown, useNextVisit } from "./home-presence";
import { MuseSlide, useMuseSlot } from "./muse-slot";
import { usePlayer } from "./player";
import { VoiceCode } from "./plaque";
import { useShell } from "./shell";
import { SafetyWatch } from "./safety";
import { PersonDay, lampFor } from "./person-day";
import { SideSwitch, useSides } from "./sides";
import { VenuePicker } from "./venue-scene";
import { GiftsShelf } from "./gifts-shelf";
import { EventPrompts } from "./event-prompts";
import { TodayCard, useToday } from "./today";
import { TogetherHabit } from "./together-habit";
import { CourtyardLetter } from "./courtyard-letter";
import { KidsCourtyard } from "./kids-courtyard";
import { FestivalHeader } from "./festival-header";
import { Avatar, Icon, Monogram, Photo } from "./ui/kit";
import { useViewer } from "./viewer";

// The courtyard (SPEC §30.2): behind the door. A real courtyard as the header, then
// everyone with their lamp-glow ring (tap for their day), today's question,
// and one swipeable row of what's alive now (a voice from home, sitting
// together, a visit, a birthday, a memory).
// The five rooms open from the house in the dock, beside the mic and the camera.

const SLIDE_H = "h-[236px]";

/* ------------------------------------------------------ a voice from home */
function VoiceSlide({ card }: { card: Card }) {
  const { members, displayLang } = useViewer();
  const { play, current, isPlaying, toggle } = usePlayer();
  const author = members.find((mm) => mm.id === card.authorId);
  const { text } = useDisplayText(card.transcript || card.caption, card.transcript ? card.transcriptLang : card.lang, displayLang);
  const playing = current?.id === card.id && isPlaying;
  return (
    <article className={`relative ${SLIDE_H} overflow-hidden rounded-[26px] bg-surface`}>
      <Photo src={cardCover(card, members)} alt="" sizes="440px" position="center 30%" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/75" aria-hidden="true" />
      <div className="absolute inset-x-4 bottom-4 text-white">
        <p className="voice m-0 line-clamp-2 text-headline leading-snug">“{text ?? card.caption}”</p>
        <div className="mt-3 flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-footnote font-semibold">{callName(author)}</span>
            <span className="block text-caption text-white/70">{relativeDay(card.takenAt)}</span>
          </span>
          <span className="hidden min-[400px]:block [&_span>span]:!bg-white/60">
            <VoiceCode peaks={card.peaks} bars={16} className="h-5" />
          </span>
          <button type="button" onClick={() => (current?.id === card.id ? toggle() : play(card))} aria-label={playing ? "Pause" : `Play ${callName(author)}'s voice note`} className="press grid h-12 w-12 place-items-center rounded-full bg-white text-black">
            <Icon name={playing ? "pause" : "play"} size={18} />
          </button>
        </div>
      </div>
    </article>
  );
}

/* --------------------------------------------------------- sit together */
function SitSlide() {
  const router = useRouter();
  const { viewer, members } = useViewer();
  const sit = useJson<{ sittings: Sitting[]; knocks: Knock[] }>("/api/sit");
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [venue, setVenue] = useState<VenueId>(DEFAULT_VENUE);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const adults = members.filter((mm) => mm.role !== "child");
  const awake = now ? adults.filter((mm) => isAwake(mm.tz, now)) : [];
  const knock = (sit.data?.knocks ?? [])[0];
  const host = members.find((mm) => mm.id === knock?.memberId);
  const next = (sit.data?.sittings ?? []).filter((s) => Date.parse(s.startsAt) > Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const start = async () => {
    if (knock) return router.push(`/call/${knock.id}`);
    if (!picking) return setPicking(true);
    setBusy(true);
    const out = await postJson<{ knock: Knock }>("/api/sit", { action: "knock", minutes: 45, note: "Come sit with me", venue });
    setBusy(false);
    if (out?.knock) router.push(`/call/${out.knock.id}`);
  };
  return (
    <article className={`flex ${SLIDE_H} flex-col justify-between rounded-[26px] bg-[#1c1b1a] p-4 text-white`}>
      <div className="flex items-center justify-between">
        <p className="m-0 flex items-center gap-2 text-caption uppercase tracking-[0.14em] text-white/60">
          <span className={`h-2 w-2 rounded-full ${knock ? "animate-pulse bg-[#3ccf7a]" : "bg-white/50"}`} />
          {knock ? "Live now" : "Sit together"}
        </p>
      </div>
      {picking && !knock ? (
        <div>
          <p className="m-0 mb-2 text-body text-white/80">Where shall we sit?</p>
          <VenuePicker value={venue} onChange={setVenue} />
        </div>
      ) : (
      <div>
        <p className="m-0 text-title font-light leading-tight">{knock ? `${host?.id === viewer.id ? "You're" : `${callName(host)} is`} on a video call` : awake.length > 1 ? `${awake.length} of you are awake now` : "Everyone's asleep somewhere"}</p>
        <p className="m-0 mt-1 text-footnote text-white/60">{knock ? `Until ${now ? timeIn(viewer.tz, new Date(knock.until)) : ""}` : next ? `Next: ${next.title} · ${relativeDay(next.startsAt)} · ${venueOf(next.venue).name}` : "Leave the camera on, like sitting in one room"}</p>
      </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <ul className="m-0 flex list-none -space-x-2.5 p-0" aria-label="Awake now">
          {(awake.length ? awake : adults).slice(0, 6).map((mm) => (
            <li key={mm.id} className="relative rounded-full ring-2 ring-[#1c1b1a]" title={`${callName(mm)} · ${placeFromTz(mm.tz)}`}>
              <Avatar src={memberPhoto(mm)} name={callName(mm)} size={36} />
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => void start()} disabled={busy} aria-label={knock ? "Join the call" : picking ? "Start sitting here" : "Start a video call"} className="press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-black">
          <Icon name="video" size={20} />
        </button>
      </div>
    </article>
  );
}

/* --------------------------------------------------------------- coming up */
function ComingUpSlide() {
  const { members } = useViewer();
  const { data } = useToday();
  const occ = data?.occasion;
  if (!occ) return null;
  const who = members.find((mm) => mm.id === occ.memberId);
  const when = occ.days === 0 ? "Today" : occ.days === 1 ? "Tomorrow" : `In ${occ.days} days`;
  return (
    <article className={`relative ${SLIDE_H} overflow-hidden rounded-[26px] bg-surface`}>
      <Photo src={memberPhoto(who) ?? "/demo/family-group.webp"} alt="" sizes="440px" position="center 35%" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/75" aria-hidden="true" />
      <Link href="/gather" className="absolute inset-0" aria-label="Coming up" />
      <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-end gap-3 text-white">
        <span className="min-w-0 flex-1">
          <span className="block text-caption uppercase tracking-[0.14em] text-white/70">{when}</span>
          <span className="block truncate text-title font-semibold">{occ.title}</span>
        </span>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------ from the years */
function YearsSlide({ card }: { card: Card }) {
  const { members, displayLang } = useViewer();
  const { text } = useDisplayText(card.caption, card.lang, displayLang);
  const years = new Date().getFullYear() - new Date(card.takenAt).getFullYear();
  return (
    <Link href="/lane" className="block text-white no-underline">
      <article className={`relative ${SLIDE_H} overflow-hidden rounded-[26px] bg-surface`}>
        <Photo src={cardCover(card, members)} alt={text ?? ""} sizes="440px" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/70" aria-hidden="true" />
        <div className="absolute inset-x-4 bottom-4">
          <p className="m-0 text-caption uppercase tracking-[0.14em] text-white/70">{years} year{years > 1 ? "s" : ""} ago</p>
          <p className="m-0 truncate text-headline font-semibold">{text ?? "…"}</p>
        </div>
      </article>
    </Link>
  );
}

/* ------------------------------------------------------------ everyone */
// Each person's photo inside a lamp-glow ring: warm gold when they were
// active or shared something today (their local day), a thin dim ring
// otherwise. No ticks, no "seen".
const LAMP_CSS = `
@keyframes kutumb-lamp { 0%,100% { box-shadow: 0 0 0 2.5px #e9b44c, 0 0 14px 3px rgba(240,170,60,.55); } 50% { box-shadow: 0 0 0 2.5px #f3c76b, 0 0 22px 7px rgba(240,170,60,.75); } }
.kutumb-lamp { box-shadow: 0 0 0 2.5px #e9b44c, 0 0 18px 5px rgba(240,170,60,.65); animation: kutumb-lamp 4.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .kutumb-lamp { animation: none; } }
`;

function PersonChip({ member, lamp, onOpen }: { member: Member; lamp: { glow: boolean; line: string }; onOpen: () => void }) {
  const photo = memberPhoto(member);
  return (
    <li className="w-[92px] shrink-0 text-center" style={{ scrollSnapAlign: "start" }}>
      <button type="button" onClick={onOpen} aria-label={`${callName(member)}'s day${lamp.glow ? ", lamp lit today" : ""}`} className="press block w-full text-ink">
        <span className={`relative mx-auto block h-[68px] w-[68px] rounded-full ${lamp.glow ? "kutumb-lamp" : "ring-1 ring-black/15"}`}>
          <span className="absolute inset-[3px] overflow-hidden rounded-full bg-surface">{photo ? <Photo src={photo} alt="" sizes="140px" position="center 30%" /> : <Monogram name={callName(member)} size={62} />}</span>
        </span>
        <span className="mt-2 block truncate text-footnote font-semibold">{callName(member)}</span>
        <span className="block truncate text-caption text-ink-soft">{lamp.line}</span>
      </button>
    </li>
  );
}

/** You, first in the row: open your own day to add a photo, a voice note or a line about today. */
function MyDayChip({ member, onOpen }: { member: Member; onOpen: () => void }) {
  const photo = memberPhoto(member);
  return (
    <li className="w-[92px] shrink-0 text-center" style={{ scrollSnapAlign: "start" }}>
      <button type="button" onClick={onOpen} aria-label="Your day: add a photo, a voice note or a line about today" className="press block w-full text-ink">
        <span className="relative mx-auto block h-[68px] w-[68px] rounded-full ring-1 ring-black/15">
          <span className="absolute inset-[3px] overflow-hidden rounded-full bg-surface">{photo ? <Photo src={photo} alt="" sizes="140px" position="center 30%" /> : <Monogram name={callName(member)} size={62} />}</span>
          <span className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full bg-[#1c1b1a] text-white ring-2 ring-white" aria-hidden="true">
            <Icon name="plus" size={14} />
          </span>
        </span>
        <span className="mt-2 block truncate text-footnote font-semibold">You</span>
        <span className="block truncate text-caption text-ink-soft">Add to your day</span>
      </button>
    </li>
  );
}

/* ------------------------------------------------------------ loading shape */
// The "Everyone" row's loading shape: the same box as the chips that replace it.
function ChipsSkeleton() {
  return (
    <div className="-mx-4 flex gap-0 overflow-hidden px-4 pb-1 pt-2" aria-busy="true" aria-label="Loading">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="w-[92px] shrink-0">
          <div className="skeleton mx-auto h-[68px] w-[68px] rounded-full" />
          <div className="skeleton mx-auto mt-2 h-[14px] w-14 rounded" />
          <div className="skeleton mx-auto mt-1.5 h-[11px] w-16 rounded" />
        </div>
      ))}
    </div>
  );
}

/** Stands in for everything under the header until it all arrives together. */
function CourtyardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <section className="mt-5">
        <div className="mb-2 h-9" />
        <ChipsSkeleton />
      </section>
      <div className={`skeleton mt-5 ${SLIDE_H} rounded-[26px]`} />
    </div>
  );
}

/* ----------------------------------------------------------------- page */
export function Courtyard({ onCloseDoor }: { onCloseDoor: () => void }) {
  const { viewer, members } = useViewer();
  const { refreshKey } = useShell();
  const { cards } = useFamilyCards(refreshKey);
  const { sides, current } = useSides();
  const pres = useJson<{ presence: Presence[]; settings: CareSettings[] }>("/api/presence", { every: 60_000 });
  const elder = viewer.role === "elder";
  const visit = useNextVisit();
  const stories = useJson<{ stories: { id: string; tellerId: string; title: string }[] }>(viewer.role === "child" ? "/api/stories" : null);
  const [dayOfId, setDayOfId] = useState<string | null>(null);

  const voice = useMemo(() => {
    const others = (cards ?? []).filter((c) => c.type === "audio" && c.authorId && c.authorId !== viewer.id);
    // A voice from the other generation first: that's the one you came for.
    return others.find((c) => members.find((mm) => mm.id === c.authorId)?.role === (elder ? "adult" : "elder")) ?? others[0];
  }, [cards, viewer.id, members, elder]);
  const people = useMemo(() => peopleByRecency(viewer.id, members, cards ?? []), [viewer.id, members, cards]);
  const thisYear = new Date().getFullYear();
  const yearsAgo = (cards ?? []).find((c) => c.type === "photo" && new Date(c.takenAt).getFullYear() < thisYear);
  const story = stories.data?.stories[0];
  const familyName = sides.find((s) => s.familyId === current)?.name;
  const lampData = { presence: pres.data?.presence ?? [], settings: pres.data?.settings ?? [], cards: cards ?? [] };
  const dayPerson = members.find((mm) => mm.id === dayOfId);
  const muse = useMuseSlot(cards ?? []);
  const planPrompt = (useEvents().data?.prompts ?? []).some((p) => p.kind === "suggest");
  // Everything under the header appears in one step, once the cards and the one
  // courtyard payload are in, so nothing slides down as the pieces arrive.
  const shared = useCourtyard();
  const ready = cards !== null && (!shared || shared.status !== "loading");

  return (
    <div>
      <style>{LAMP_CSS}</style>
      <header data-ui="courtyard-header" className="pt-4">
        <div className="relative h-[150px] overflow-hidden rounded-[26px] bg-[#2a211b]">
          <Photo src="/demo/courtyard.jpg" alt="" sizes={HERO_SIZES} priority position="center 55%" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/5 to-black/65" aria-hidden="true" />
          <div className="absolute right-3 top-3 flex items-center gap-2">
            <button type="button" onClick={onCloseDoor} aria-label="Close the door, back to the window" className="press glass grid h-11 w-11 place-items-center rounded-full text-white">
              <Icon name="doorClosed" size={20} strokeWidth={1.8} />
            </button>
            <Link href="/settings" aria-label="You: settings and account" className="press rounded-full no-underline">
              <Avatar src={memberPhoto(viewer)} name={viewer.firstName} size={44} ring />
            </Link>
          </div>
          <div className="absolute inset-x-4 bottom-3.5 text-white">
            <h1 data-display className="m-0 mt-0.5 truncate text-display font-light leading-[1.1] tracking-[-0.01em]">{familyName ? `The ${familyName} family` : "Your family"}</h1>
          </div>
        </div>
        {ready && <SideSwitch />}
      </header>

      {!ready && <CourtyardSkeleton />}
      {ready && <SafetyWatch />}
      {ready && <FestivalHeader />}

      {ready && people.length > 0 && (
        <section data-ui="courtyard-everyone" aria-label="Everyone" className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="m-0 text-headline font-semibold">Everyone</h2>
            <Link href="/bond" aria-label="Family tree" className="grid h-9 w-9 place-items-center rounded-full text-ink-soft no-underline">
              <Icon name="tree" size={18} />
            </Link>
          </div>
          {pres.data === null ? (
            <ChipsSkeleton />
          ) : (
            <ul className="no-scrollbar -mx-4 m-0 flex list-none gap-2 overflow-x-auto px-4 pb-1 pt-2" style={{ scrollSnapType: "x mandatory", scrollPaddingInline: 16 }}>
              <MyDayChip member={viewer} onOpen={() => setDayOfId(viewer.id)} />
              {people.map((mm) => (
                <PersonChip key={mm.id} member={mm} lamp={lampFor(mm, lampData)} onOpen={() => setDayOfId(mm.id)} />
              ))}
            </ul>
          )}
        </section>
      )}

      {ready && (
        <>
          {/* One way to plan: Muse's "Plan" card when it has a prompt, otherwise the quiet Coming up slide below. */}
          <EventPrompts className="mt-4" kinds={["suggest", "soon", "live"]} />
          <TodayCard />
          <TogetherHabit />
          <CourtyardLetter />
          <KidsCourtyard />

          <Carousel label="Now in the family" className="mt-5">
            {voice && <VoiceSlide card={voice} />}
            {story && <StoryDoor story={story} />}
            <SitSlide />
            {visit && <VisitCountdown visit={visit} />}
            {!planPrompt && <ComingUpSlide />}
            {yearsAgo && <YearsSlide card={yearsAgo} />}
            {muse.slot && <MuseSlide slot={muse.slot} />}
          </Carousel>

          {elder && (
            <div className="mt-5 space-y-3">
              <GiftsShelf />
              <MyQuestions />
              <MyNeeds />
            </div>
          )}
        </>
      )}

      {dayPerson && <PersonDay member={dayPerson} cards={cards ?? []} onClose={() => setDayOfId(null)} />}
    </div>
  );
}
