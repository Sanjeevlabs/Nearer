"use client";

import { AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { albumDates } from "@/components/albums";
import { LaneViewer } from "@/components/lane-viewer";
import { FestivalLeadEntry } from "@/components/festival-header";
import { OccasionCelebration } from "@/components/occasion-celebration";
import { TraditionsSheet, type TraditionChoice } from "@/components/occasion-festivals";
import { usePlayer } from "@/components/player";
import { useShell } from "@/components/shell";
import { Avatar, Button, EmptyState, Icon, Photo, RoomHeader } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import type { Album } from "@/lib/kinds";
import { addDays, localTodayIso, occasionsInRange, visibleHolidays, type CalHoliday, type CalOccasion, type OccasionChoices } from "@/lib/occasion-calendar";
import { occasionGroups, type OccasionGroup } from "@/lib/occasion-album";
import { callName, cardCover, cardDuration, formatDuration, memberPhoto } from "@/lib/people";
import type { Member, RitualRun, Wish } from "@/lib/schemas";
import { useFamilyCards } from "@/lib/use-family";
import { useJson } from "@/lib/use-json";
import { Boundary } from "@/components/ui/boundary";

// Occasions (Celebrations → Occasions): every photo and voice from the
// family's birthdays, weddings, anniversaries and festivals, one group per
// occasion, newest first (lib/occasion-album.ts). On the day itself, the
// celebration with everyone's wishes and the Chorus sits on top. What's
// coming up lives on the Coming up tab; the family's traditions are one row
// at the bottom.

interface Data {
  configs: { slug: string; title: string }[];
  holidays: CalHoliday[];
  holidaySource: "google" | "fallback";
  countryName: string;
  traditionChoices: TraditionChoice[];
  traditions: string[];
  kept: string[];
  skipped: string[];
  members: Member[];
  runs: RitualRun[];
  wishes: Wish[];
  wishCards: Pick<Wish, "ritualRunId" | "cardId">[];
  canEditKept: boolean;
}

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "20 Oct": an unnamed birthday's day. */
function shortDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function Group({ g, members, albums, onOpen }: { g: OccasionGroup; members: Member[]; albums: Album[]; onOpen: (g: OccasionGroup, index: number) => void }) {
  const { current, isPlaying, play, toggle } = usePlayer();
  const album = g.albumId ? albums.find((a) => a.id === g.albumId) : undefined;
  const count = [g.prints.length ? `${g.prints.length} ${g.prints.length === 1 ? "photo" : "photos"}` : "", g.voices.length ? `${g.voices.length} ${g.voices.length === 1 ? "voice" : "voices"}` : ""].filter(Boolean).join(" · ");
  return (
    <section aria-label={g.title} data-occasion={g.key}>
      <div className="mb-2.5 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[18px] leading-tight">{g.title}</h2>
          <p className="tnum m-0 mt-0.5 text-[13px] text-ink-soft">
            {album ? albumDates(album) : dayLabel(g.date)}
            {count && ` · ${count}`}
          </p>
        </div>
        {album && (
          <Link href={`/lane/album/${album.id}?from=rituals`} className="-my-2 flex min-h-[44px] shrink-0 items-center gap-0.5 text-[13.5px] font-medium text-ink-soft no-underline">
            Album <Icon name="chevron" size={14} />
          </Link>
        )}
        {g.runId && g.voices.length > 0 && (
          <Link href={`/reel/${encodeURIComponent(g.runId)}`} className="-my-2 flex min-h-[44px] shrink-0 items-center gap-1 text-[13.5px] font-medium text-ink-soft no-underline">
            <Icon name="play" size={12} /> Play the reel
          </Link>
        )}
      </div>
      {g.prints.length > 0 && (
        <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-2 pt-1" aria-label={`Photos from ${g.title}`}>
          {g.prints.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpen(g, i)}
              data-card={c.id}
              aria-label={c.caption || `${c.type === "video" ? "Video" : "Photo"} from ${g.title}`}
              className="press shrink-0 snap-start rounded-[6px] bg-white p-1.5 pb-5 text-left shadow-[0_1px_2px_rgba(0,0,0,.12),0_10px_22px_-12px_rgba(0,0,0,.35)]"
              style={{ transform: `rotate(${i % 2 ? 1.2 : -1.2}deg)` }}
            >
              <span className="relative block h-[132px] w-[112px] overflow-hidden rounded-[3px] bg-surface">
                <Photo src={cardCover(c, members)} alt="" sizes="224px" position="center 30%" />
                {c.type === "video" && (
                  <span className="glass absolute bottom-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-full">
                    <Icon name="play" size={11} />
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      {g.voices.length > 0 && (
        <ul className="m-0 mt-1.5 list-none space-y-1.5 p-0" aria-label={`Voices from ${g.title}`}>
          {g.voices.map((c) => {
            const by = members.find((m) => m.id === c.authorId);
            const on = current?.id === c.id && isPlaying;
            return (
              <li key={c.id}>
                <button type="button" data-card={c.id} onClick={() => (current?.id === c.id ? toggle() : play(c, g.voices))} aria-label={`${on ? "Pause" : "Play"} ${by ? `${callName(by)}'s` : "the"} voice from ${g.title}`} className="press flex w-full items-center gap-3 rounded-[18px] bg-card p-2 pr-3 text-left shadow-card">
                  {by ? <Avatar src={memberPhoto(by)} name={callName(by)} size={40} /> : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-well"><Icon name="music" size={17} /></span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-semibold leading-tight">{by ? callName(by) : "The family"}</span>
                    <span className="voice block truncate text-[14px] text-ink-soft">{c.caption || "A voice note"}</span>
                  </span>
                  <span className="tnum text-[12.5px] text-ink-faint">{formatDuration(cardDuration(c))}</span>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${on ? "bg-marigold text-black" : "bg-ink text-white"}`}>
                    <Icon name={on ? "pause" : "play"} size={13} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function OccasionsPage() {
  const { viewer } = useViewer();
  const { openAdd, refreshKey } = useShell();
  const { cards } = useFamilyCards(refreshKey);
  const { data, failed, reload } = useJson<Data>(`/api/rituals?k=${refreshKey}`);
  const albumsQ = useJson<{ albums: Album[] }>(`/api/albums?k=${refreshKey}`);
  const [saved, setSaved] = useState<OccasionChoices | null>(null);
  const [festivalsOpen, setFestivalsOpen] = useState(false);
  const [open, setOpen] = useState<{ g: OccasionGroup; index: number } | null>(null);
  const today = localTodayIso();
  const choices = useMemo<OccasionChoices>(() => saved ?? { traditions: data?.traditions ?? [], kept: data?.kept ?? [], skipped: data?.skipped ?? [] }, [saved, data]);
  const shownHolidays = useMemo(() => (data ? visibleHolidays(data.holidays, choices) : []), [data, choices]);
  const todays = useMemo(() => (data ? occasionsInRange(data.members, shownHolidays, today, today) : []), [data, shownHolidays, today]);

  const memberOf = useCallback((o: CalOccasion) => (o.memberId ? (data?.members.find((m) => m.id === o.memberId) ?? null) : null), [data]);
  const titleOf = useCallback(
    (o: CalOccasion) => {
      const m = memberOf(o);
      if (!m) return o.title;
      return m.id === viewer.id ? "Your birthday" : `${callName(m)}'s birthday`;
    },
    [memberOf, viewer.id],
  );
  const runOf = (o: CalOccasion) => data?.runs.find((r) => r.ritualSlug === o.slug && r.occasionDate === o.date) ?? null;
  const wishedBy = (o: CalOccasion) => {
    const run = runOf(o);
    return run ? (data?.wishes ?? []).filter((w) => w.ritualRunId === run.id) : [];
  };
  const wish = (o: CalOccasion) => {
    const run = runOf(o);
    openAdd("voice", run ? { runId: run.id, kind: viewer.role === "elder" ? "blessing" : "wish" } : null, o.memberId);
  };

  // The occasion's name for a slug on a day: the person's birthday, the festival, or the guide's own title.
  const titleFor = useCallback(
    (slug: string, date: string) => {
      if (!data) return slug;
      const near = occasionsInRange(data.members, data.holidays, addDays(date, -2), addDays(date, 2)).filter((o) => o.slug === slug);
      if (near.length === 1 || (near.length && slug !== "birthday")) return titleOf(near[0]);
      if (slug === "birthday") return `Birthday · ${shortDay(date)}`;
      const h = data.holidays.find((x) => x.key === slug || x.ritual === slug);
      if (h) return h.title;
      const cfg = data.configs.find((c) => c.slug === slug);
      return cfg ? cfg.title.split(" — ")[0] : slug.replace(/-/g, " ").replace(/^./, (ch) => ch.toUpperCase());
    },
    [data, titleOf],
  );
  // Today's occasion is shown as the celebration, so its group isn't repeated below it.
  const groups = useMemo(() => {
    if (!data || !cards) return null;
    const all = occasionGroups({ cards, albums: albumsQ.data?.albums ?? [], runs: data.runs, wishes: data.wishCards ?? [], titleFor });
    const todayRuns = new Set(todays.map((o) => data.runs.find((r) => r.ritualSlug === o.slug && r.occasionDate === o.date)?.id).filter(Boolean));
    return all.filter((g) => !(g.runId && todayRuns.has(g.runId)));
  }, [data, cards, albumsQ.data, titleFor, todays]);
  const sourceLine = data ? (data.holidaySource === "google" ? `Festival dates from Google’s public holiday calendar for ${data.countryName}.` : `Festival dates from Nearer’s own list for ${data.countryName}.`) : "";

  return (
    <div>
      <RoomHeader title="Occasions" subtitle="Photos and voices from birthdays, weddings and festivals" />

      {failed ? (
        <div className="py-6 text-center">
          <p className="m-0 text-[15px] text-ink-soft">Couldn&rsquo;t load occasions.</p>
          <Button variant="secondary" className="mx-auto mt-3 !bg-well" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      ) : !data || groups === null ? (
        <div aria-busy="true" aria-label="Loading occasions" className="space-y-6">
          {[0, 1].map((i) => (
            <div key={i}>
              <div className="skeleton mb-2 h-5 w-40" />
              <div className="flex gap-3 overflow-hidden">
                {[0, 1, 2].map((j) => (
                  <div key={j} className="skeleton h-[158px] w-[124px] shrink-0 rounded-[6px]" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-7">
          <FestivalLeadEntry />
          {todays.map((o) => (
            <OccasionCelebration key={o.id} title={titleOf(o)} person={memberOf(o)} members={data.members} viewer={viewer} run={runOf(o)} wishes={wishedBy(o)} cards={cards ?? []} lampHour={o.kind === "festival" ? o.lampHour : null} onWish={() => wish(o)} onWished={() => void reload()} />
          ))}

          {groups.length === 0 && todays.length === 0 && (
            <EmptyState
              position="center 45%"
              title="No occasion photos yet."
              line="Wishes, cake photos and festival voices from every home gather here, one occasion at a time."
              action={
                <Link href="/gather" className="press flex h-12 w-full items-center justify-center rounded-full bg-ink text-[16px] font-semibold text-white no-underline">
                  See what&rsquo;s coming up
                </Link>
              }
            />
          )}

          {groups.map((g) => (
            <Boundary key={g.key} label={g.title}><Group g={g} members={data.members} albums={albumsQ.data?.albums ?? []} onOpen={(grp, index) => setOpen({ g: grp, index })} /></Boundary>
          ))}

          <button type="button" onClick={() => setFestivalsOpen(true)} className="press flex w-full items-center gap-3 rounded-card bg-card px-4 py-3 text-left shadow-card">
            <Icon name="flower" size={20} className="text-ink-soft" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">Our traditions</span>
              <span className="block text-[13px] text-ink-soft">{choices.traditions.length === 0 && choices.kept.length === 0 ? "Which festivals does your family keep?" : "The festivals your family keeps"}</span>
            </span>
            <span className="text-[14px] font-semibold text-ink-soft">{data.canEditKept ? "Change" : "See"}</span>
          </button>
        </div>
      )}

      {data && (
        <TraditionsSheet
          open={festivalsOpen}
          choices={data.traditionChoices}
          holidays={data.holidays}
          value={choices}
          today={today}
          sourceLine={sourceLine}
          canEdit={data.canEditKept}
          onClose={() => setFestivalsOpen(false)}
          onSaved={(v) => {
            setSaved(v);
            void reload();
          }}
        />
      )}

      <AnimatePresence>{open && <LaneViewer key={open.g.key} cards={open.g.prints} start={open.index} title={open.g.title} onClose={() => setOpen(null)} />}</AnimatePresence>
    </div>
  );
}
