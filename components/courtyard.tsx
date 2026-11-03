"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { CareSettings, Knock, Presence, Sitting } from "@/lib/kinds";
import { callName, cardCover, memberPhoto, peopleByRecency, relativeDay } from "@/lib/people";
import type { Card, Member } from "@/lib/schemas";
import { useDisplayText } from "@/lib/use-display-text";
import { useCourtyard } from "@/lib/courtyard-data";
import { COURTYARD_PATIENCE_MS, courtyardFailed, courtyardReady, everyoneView } from "@/lib/first-screen";
import { can } from "@/lib/permissions";
import { useFamilyCards } from "@/lib/use-family";
import { ago, postJson, useJson } from "@/lib/use-json";
import { placeFromTz, timeIn } from "@/lib/zones";
import { localTimeLine } from "@/lib/window-words";
import dynamic from "next/dynamic";
import { DEFAULT_VENUE, venueOf, type VenueId } from "@/lib/venues";
import { Carousel } from "./carousel";
import { MyNeeds, MyQuestions, StoryDoor, VisitCountdown, useNextVisit } from "./home-presence";
import { MuseSlide, useMuseSlot } from "./muse-slot";
import { useShell } from "./shell";
import { SafetyWatch } from "./safety";
import { PersonDay, lampFor } from "./person-day";
import { PersonSheet, type WindowPersonData } from "./person-sheet";
import { ProfileMenu } from "./profile-menu";
import { SideSwitch, doneOpening, useOpeningSide, useSides } from "./sides";
import { VenuePicker } from "./venue-scene";
import { GiftsShelf } from "./gifts-shelf";
import { EventPrompts } from "./event-prompts";
import { TodayCard } from "./today";
import { TogetherHabit } from "./together-habit";
import { CourtyardLetter } from "./courtyard-letter";
import { KidsCourtyard } from "./kids-courtyard";
import { FestivalHeader } from "./festival-header";
import { Avatar, Button, Icon, Monogram, Photo } from "./ui/kit";
import { Mark } from "./brand";
import { familyHomePhoto } from "@/lib/family";
import { resolveMediaUrl } from "@/lib/media-session";
import { useViewer } from "./viewer";

// The courtyard (SPEC §30.2): behind the door. A real courtyard as the header, then
// everyone with their lamp-glow ring (tap for their day), today's question,
// and one swipeable row of what's alive now (a voice from home, sitting
// together, a visit, a birthday, a memory).
// The five rooms open from the house in the dock, beside the mic and the camera.

const InviteSheet = dynamic(() => import("./invite-sheet").then((m) => m.InviteSheet), { ssr: false });
const OpenDoorSheet = dynamic(() => import("./open-door-sheet").then((m) => m.OpenDoorSheet), { ssr: false });

const SLIDE_H = "h-[236px]";

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
  // A far home's clock, as a fact ("It's 11:40 PM in Amritsar"): never "awake" or "asleep".
  const far = adults.find((mm) => mm.id !== viewer.id && mm.tz !== viewer.tz) ?? adults.find((mm) => mm.id !== viewer.id);
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
    <article className={`flex ${SLIDE_H} flex-col justify-between rounded-[26px] bg-deep p-4 text-white`}>
      <div className="flex items-center justify-between">
        <p className="m-0 flex items-center gap-2 text-caption uppercase tracking-[0.14em] text-white/60">
          <span className={`h-2 w-2 rounded-full ${knock ? "animate-pulse bg-[#3ccf7a]" : "bg-white/50"}`} />
          {knock ? "Door open" : "Sit together"}
        </p>
      </div>
      {picking && !knock ? (
        <div>
          <p className="m-0 mb-2 text-body text-white/80">Where shall we sit?</p>
          <VenuePicker value={venue} onChange={setVenue} />
        </div>
      ) : (
      <div>
        <p className="m-0 text-title font-light leading-tight">{knock ? (host?.id === viewer.id ? "Your door is open" : `${callName(host)}'s door is open`) : far && now ? localTimeLine(far.tz, far.city || placeFromTz(far.tz), now) : "Sit together"}</p>
        <p className="m-0 mt-1 text-footnote text-white/60">{knock ? `Until ${now ? timeIn(viewer.tz, new Date(knock.until)) : ""}` : next ? `Next: ${next.title} · ${relativeDay(next.startsAt)} · ${venueOf(next.venue).name}` : "Leave the camera on, like sitting in one room"}</p>
      </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <ul className="m-0 flex list-none -space-x-2.5 p-0" aria-label="Family">
          {adults.slice(0, 6).map((mm) => (
            <li key={mm.id} className="relative rounded-full ring-2 ring-[var(--deep)]" title={`${callName(mm)} · ${placeFromTz(mm.tz)}`}>
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
// Each person's photo and one calm line under it. The lamp lives on the window only (no glow ring here);
// a tap opens their day.
function PersonChip({ member, lamp, onOpen }: { member: Member; lamp: { glow: boolean; line: string }; onOpen: () => void }) {
  const photo = memberPhoto(member);
  return (
    <li className="w-[92px] shrink-0 text-center" style={{ scrollSnapAlign: "start" }}>
      <button type="button" onClick={onOpen} aria-label={`${callName(member)}'s day`} className="press block w-full text-ink">
        <span className="relative mx-auto block h-[68px] w-[68px] rounded-full ring-1 ring-black/15">
          <span className="absolute inset-[3px] overflow-hidden rounded-full bg-surface">{photo ? <Photo src={photo} alt="" sizes="140px" position="center 30%" /> : <Monogram name={callName(member)} size={62} />}</span>
        </span>
        <span className="mt-2 block truncate text-footnote font-semibold">{callName(member)}</span>
        <span className="block truncate text-caption text-ink-soft">{lamp.line}</span>
      </button>
    </li>
  );
}

/** You, first in the row: open your own day to add a voice note, a photo or a line about today. */
function MyDayChip({ member, onOpen }: { member: Member; onOpen: () => void }) {
  const photo = memberPhoto(member);
  return (
    <li className="w-[92px] shrink-0 text-center" style={{ scrollSnapAlign: "start" }}>
      <button type="button" onClick={onOpen} aria-label="Your day: add a voice memory, a photo or a line about today" className="press block w-full text-ink">
        <span className="relative mx-auto block h-[68px] w-[68px] rounded-full ring-1 ring-black/15">
          <span className="absolute inset-[3px] overflow-hidden rounded-full bg-surface">{photo ? <Photo src={photo} alt="" sizes="140px" position="center 30%" /> : <Monogram name={callName(member)} size={62} />}</span>
          <span className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full bg-deep text-white ring-2 ring-white" aria-hidden="true">
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

/* ------------------------------------------------------------ nobody here yet */
/** The "Everyone" row for someone whose family has not joined (or been added) yet: one clear way to add them. */
function AddFamilyCard({ canInvite }: { canInvite: boolean }) {
  const [inviting, setInviting] = useState(false);
  const [everInvited, setEverInvited] = useState(false);
  return (
    <section data-ui="courtyard-add-family" aria-label="Everyone" className="mt-5">
      <h2 className="m-0 mb-2 text-headline font-semibold">Everyone</h2>
      <div className="rounded-[22px] bg-card p-4 shadow-card">
        <p className="m-0 text-body font-semibold">It&rsquo;s just you here so far</p>
        <p className="m-0 mt-1 text-callout text-ink-soft">{canInvite ? "Add your family and each person\u2019s day shows up here." : "Ask a grown-up in the family to add people."}</p>
        {canInvite && (
          <Button
            className="mt-3"
            onClick={() => {
              setEverInvited(true);
              setInviting(true);
            }}
          >
            Add your family
          </Button>
        )}
      </div>
      {everInvited && <InviteSheet open={inviting} onClose={() => setInviting(false)} />}
    </section>
  );
}

/** The family could not be reached: say so, with a way to try again (never a skeleton that does not end). */
function CourtyardRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-ui="courtyard-retry" role="alert" className="mt-5 rounded-[22px] bg-card p-4 text-center shadow-card">
      <p className="m-0 text-body font-semibold">Couldn&rsquo;t reach your family just now</p>
      <p className="m-0 mt-1 text-callout text-ink-soft">Check your connection and try again.</p>
      <Button variant="secondary" className="mx-auto mt-3 !bg-well" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/* ----------------------------------------------------------------- page */
export function Courtyard({ onBack }: { onBack: () => void }) {
  const { viewer, members } = useViewer();
  const { refreshKey, openAdd } = useShell();
  const { cards, failed: cardsFailed, retry: retryCards } = useFamilyCards(refreshKey);
  const { sides, current } = useSides();
  const pres = useJson<{ presence: Presence[]; settings: CareSettings[] }>("/api/presence", { every: 60_000 });
  const elder = viewer.role === "elder";
  const visit = useNextVisit();
  const stories = useJson<{ stories: { id: string; tellerId: string; title: string }[] }>(viewer.role === "child" ? "/api/stories" : null);
  const router = useRouter();
  // One pattern for a person: tap them and the person sheet opens (the window's); "See their day" opens the full day.
  // Your own chip goes straight to your day, where you add to it.
  const [dayOfId, setDayOfId] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const win = useJson<{ people: WindowPersonData[] }>("/api/window", { every: 60_000 });

  const people = useMemo(() => peopleByRecency(viewer.id, members, cards ?? []), [viewer.id, members, cards]);
  const thisYear = new Date().getFullYear();
  const yearsAgo = (cards ?? []).find((c) => c.type === "photo" && new Date(c.takenAt).getFullYear() < thisYear);
  const story = stories.data?.stories[0];
  // A side being opened shows its name and home at once; its own answer takes over when it lands.
  const opening = useOpeningSide();
  const settled = opening && current === opening.familyId && viewer.familyId === opening.familyId;
  useEffect(() => {
    if (opening && settled) doneOpening(opening.familyId);
  }, [opening, settled]);
  const familyName = opening && !settled ? opening.name : sides.find((s) => s.familyId === current)?.name;
  const homePhoto = resolveMediaUrl(opening && !settled ? familyHomePhoto(opening.familyId, null) : familyHomePhoto(viewer.familyId, resolveMediaUrl(viewer.homeImageRef))) ?? "/demo/home-courtyard.jpg";
  const lampData = { presence: pres.data?.presence ?? [], settings: pres.data?.settings ?? [], cards: cards ?? [] };
  const dayPerson = members.find((mm) => mm.id === dayOfId);
  const sheetPerson = members.find((mm) => mm.id === sheetId) ?? null;
  // "Can I sit with you?": a door for that one person (it never drops anyone into a live room).
  const [doorFor, setDoorFor] = useState<string | null | undefined>(undefined);
  const callThem = () => {
    setDoorFor(sheetId);
    setSheetId(null);
  };
  const muse = useMuseSlot(cards ?? []);
  // Everything under the header appears in one step, once the cards and the one
  // courtyard payload are in, so nothing slides down as the pieces arrive.
  const shared = useCourtyard();
  // After a short wait it shows what it has and the rest fills in; it never holds a skeleton for a piece that is late.
  const [patient, setPatient] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPatient(true), COURTYARD_PATIENCE_MS);
    return () => clearTimeout(t);
  }, []);
  const ready = courtyardReady({ cardsLoaded: cards !== null, status: shared?.status ?? null, waitedMs: patient ? COURTYARD_PATIENCE_MS : 0 });
  const unreachable = ready && courtyardFailed(shared?.status ?? null, cardsFailed);
  const retry = () => {
    retryCards();
    void shared?.reload();
  };

  return (
    <div>
      <header data-ui="courtyard-header" className="pt-4">
        <div className="relative h-[150px] overflow-hidden rounded-[26px] bg-deep">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/window/courtyard-band.svg" alt="" className="absolute inset-0 h-full w-full object-cover" />
          {/* The family's home: your own home photo, else a Muse-made one. The drawn band stays under it while it loads. */}
          <Photo src={homePhoto} alt="" sizes="(max-width: 480px) 100vw, 448px" priority position="center 55%" />
          <span className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/5 to-black/60" aria-hidden="true" />
          <span className="absolute left-4 top-4 opacity-90" aria-hidden="true">
            <Mark size={36} />
          </span>
          <div className="absolute right-3 top-3 flex items-center gap-2">
            <button type="button" onClick={onBack} aria-label="Back to the window" className="press glass grid h-11 w-11 place-items-center rounded-full text-white">
              <Icon name="chevron" size={20} strokeWidth={1.8} className="rotate-180" />
            </button>
            <ProfileMenu ring />
          </div>
          <div className="absolute inset-x-4 bottom-3.5 text-white">
            <h1 data-display className="m-0 mt-0.5 truncate [text-shadow:0_1px_12px_rgba(0,0,0,.45)] text-display font-light leading-[1.1] tracking-[-0.01em]">{familyName ? `The ${familyName} family` : "Your family"}</h1>
          </div>
        </div>
        {ready && <SideSwitch />}
      </header>

      {!ready && <CourtyardSkeleton />}
      {ready && <SafetyWatch />}
      {ready && <FestivalHeader />}

      {unreachable && <CourtyardRetry onRetry={retry} />}
      {ready && people.length > 0 && (
        <section data-ui="courtyard-everyone" aria-label="Everyone" className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="m-0 text-headline font-semibold">Everyone</h2>
            <Link href="/bond" aria-label="Family tree" className="grid h-9 w-9 place-items-center rounded-full text-ink-soft no-underline">
              <Icon name="tree" size={18} />
            </Link>
          </div>
          {everyoneView(people.length, pres.data !== null, pres.failed) === "chips-loading" ? (
            <ChipsSkeleton />
          ) : (
            <ul className="no-scrollbar -mx-4 m-0 flex list-none gap-2 overflow-x-auto px-4 pb-1 pt-2" style={{ scrollSnapType: "x mandatory", scrollPaddingInline: 16 }}>
              <MyDayChip member={viewer} onOpen={() => setDayOfId(viewer.id)} />
              {people.map((mm) => (
                <PersonChip key={mm.id} member={mm} lamp={lampFor(mm, lampData)} onOpen={() => setSheetId(mm.id)} />
              ))}
            </ul>
          )}
        </section>
      )}

      {ready && people.length === 0 && <AddFamilyCard canInvite={can(viewer, "invite.create")} />}

      {ready && (
        <>
          {/* What is coming up lives on Celebrations (one line on the window): only what is happening now or soon shows here. */}
          <EventPrompts className="mt-4" kinds={["soon", "live"]} />
          <TodayCard />
          <TogetherHabit />
          <CourtyardLetter />
          <KidsCourtyard />

          <Carousel label="Now in the family" className="mt-5">
            {story && <StoryDoor story={story} />}
            <SitSlide />
            {visit && <VisitCountdown visit={visit} />}
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

      <PersonSheet
        person={sheetPerson}
        st={win.data?.people.find((x) => x.id === sheetId)}
        fallback={sheetPerson ? lampFor(sheetPerson, lampData).line : undefined}
        onTalk={() => {
          if (!sheetPerson) return;
          setSheetId(null);
          openAdd("voice", null, [sheetPerson.id]);
        }}
        onCall={callThem}
        onSeeDay={() => {
          setDayOfId(sheetId);
          setSheetId(null);
        }}
        onClose={() => setSheetId(null)}
      />
      {doorFor !== undefined && <OpenDoorSheet open={doorFor !== null} preset={doorFor ? { only: doorFor } : undefined} onClose={() => setDoorFor(null)} />}
      {dayPerson && <PersonDay member={dayPerson} cards={cards ?? []} onClose={() => setDayOfId(null)} />}
    </div>
  );
}
