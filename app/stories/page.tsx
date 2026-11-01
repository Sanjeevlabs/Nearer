"use client";

import { AnimatePresence, m } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePlayer } from "@/components/player";
import { useShell } from "@/components/shell";
import { StoryCover, THEME_LOOK } from "@/components/story-art";
import { ActionMenu, Avatar, Button, EmptyLine, Icon, MuseMark, RoomHeader, SectionTitle } from "@/components/ui/kit";
import { ShareQuote } from "@/components/share-quote";
import { useViewer } from "@/components/viewer";
import { STORY_AGES, STORY_THEMES } from "@/lib/kind-values";
import type { Question, Story } from "@/lib/kinds";
import { canChange } from "@/lib/permissions";
import { callName, memberPhoto } from "@/lib/people";
import type { Card, Member } from "@/lib/schemas";
import { useFamilyCards } from "@/lib/use-family";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { familyStoriesFor, resolveIdea, type StoryIdea } from "@/lib/story-ideas";
import { Boundary } from "@/components/ui/boundary";

// Stories: the kids' corner. Grandparents tell, children listen (at bedtime
// too), and ask for the next one. Muse only labels a story; it never writes one.

interface StoriesData {
  stories: Story[];
  requests: Question[];
  idea?: StoryIdea;
}

const STARTERS = ["The day you got lost at the mela", "What Papa was like at my age", "An animal that lived near your home", "A story your grandmother told you", "The naughtiest thing you ever did", "A lullaby you sang to your children"];
const ASK_ABOUT = ["a tiger", "an elephant", "when Papa was small", "your village", "a clever monkey", "the moon"];
const AGE_LABEL: Record<Story["ages"], string> = { all: "All ages", "under-5": "Under 5", "5-8": "5–8", "9-12": "9–12" };

function minutesOf(card: Card | undefined): string {
  if (!card) return "";
  const s = card.segments.reduce((mx, x) => Math.max(mx, x.end), 0);
  return s ? `${Math.max(1, Math.round(s / 60))} min` : "";
}

export default function StoriesPage() {
  return (
    <Suspense fallback={<div className="skeleton mt-16 h-[420px] rounded-card" aria-busy="true" />}>
      <Boundary label="Stories"><Stories /></Boundary>
    </Suspense>
  );
}

function Stories() {
  const { viewer, members } = useViewer();
  const { openAdd, refreshKey } = useShell();
  const { cards } = useFamilyCards(refreshKey);
  const { data, reload } = useJson<StoriesData>(`/api/stories?k=${refreshKey}`);
  const { play, current, isPlaying, toggle } = usePlayer();
  const [bedtime, setBedtime] = useState(false);
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState<Story | null>(null);
  const fresh = useSearchParams().get("new");

  const cardOf = (s: Story) => (cards ?? []).find((c) => c.id === s.cardId);
  const stories = (data?.stories ?? []).filter((s) => cardOf(s));
  const byId = (id: string) => members.find((x) => x.id === id);
  const rank = (id: string) => (byId(id)?.role === "elder" ? 0 : id === viewer.id ? 1 : 2);
  const tellers = Array.from(new Set(stories.map((s) => s.tellerId))).sort((a, b) => rank(a) - rank(b));
  const toMe = (data?.requests ?? []).filter((q) => q.toMemberId === viewer.id);
  const mine = (data?.requests ?? []).filter((q) => q.askedBy === viewer.id);
  const canTell = viewer.access !== "child";

  return (
    <div>
      <RoomHeader title="Stories" subtitle="Told in the voices of the family, kept for the children" />

      <button type="button" onClick={() => setBedtime(true)} disabled={!stories.length} className="press relative block h-[148px] w-full overflow-hidden rounded-hero text-left text-white disabled:opacity-50" style={{ background: "linear-gradient(160deg,#141c3a,#2d3a6b 70%,#4a3f7a)" }}>
        <svg viewBox="0 0 360 148" className="absolute inset-0 h-full w-full" aria-hidden="true">
          {Array.from({ length: 26 }, (_, i) => (
            <circle key={i} cx={(i * 97) % 360} cy={(i * 53) % 120 + 6} r={i % 4 === 0 ? 1.8 : 1} fill="#fff" opacity={0.7} />
          ))}
          <path d="M300 30a26 26 0 1 0 14 46 21 21 0 1 1-14-46z" fill="#e8ecff" />
        </svg>
        <span className="absolute bottom-4 left-5">
          <span className="block text-title font-bold">Bedtime</span>
          <span className="block text-callout text-white/80">Stories in a row, then lights out</span>
        </span>
      </button>

      {toMe.length > 0 && (
        <section aria-label="Asked of you" className="mt-5 space-y-2">
          {toMe.map((q) => {
            const by = q.askedBy ? byId(q.askedBy) : undefined;
            return (
              <div key={q.id} className="rounded-card bg-[#fff6e6] p-4">
                <p className="m-0 text-footnote font-medium text-[#8a4b00]">{callName(by)} asked you</p>
                <p className="voice m-0 mt-1 text-title leading-snug">&ldquo;{q.text}&rdquo;</p>
                <div className="mt-3 flex gap-2">
                  <Button className="flex-1" onClick={() => openAdd("voice", { kind: "story", questionId: q.id, prompt: q.text })}>
                    <Icon name="mic" size={18} />
                    Tell it
                  </Button>
                  <Button variant="quiet" onClick={async () => { await postJson("/api/stories", { action: "withdraw", questionId: q.id }); await reload(); }}>
                    Not now
                  </Button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        {canTell && (
          <button type="button" onClick={() => openAdd("voice", { kind: "story" })} className="press flex h-12 flex-col items-center justify-center gap-0.5 rounded-[20px] bg-black text-callout font-semibold text-white">
            <Icon name="mic" size={18} />
            Tell a story
          </button>
        )}
        <button type="button" onClick={() => setAsking((v) => !v)} aria-expanded={asking} className={cn("press flex h-12 flex-col items-center justify-center gap-0.5 rounded-[20px] text-callout font-semibold", asking ? "bg-black/80 text-white" : "bg-surface", !canTell && "col-span-2")}>
          <Icon name="reply" size={18} />
          Ask for a story
        </button>
      </div>
      {asking && <AskStory onDone={() => { setAsking(false); void reload(); }} />}
      {canTell && data?.idea && (
        <section aria-label="A story to tell tonight" className="mt-4 rounded-card p-4 text-white" style={{ background: "linear-gradient(160deg,#2d2a5a,#4a3f7a)" }}>
          <p className="m-0 text-caption font-semibold uppercase tracking-[0.1em] text-white/65">Tell this one, in your own words</p>
          <p className="m-0 mt-1 text-title font-semibold leading-tight">{data.idea.title}</p>
          <ol className="m-0 mt-2.5 space-y-1 pl-5 text-callout text-white/85">
            {data.idea.beats.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ol>
          <p className="voice m-0 mt-2 text-body text-white/75">{data.idea.lesson}</p>
          <button type="button" onClick={() => openAdd("voice", { kind: "story", prompt: data.idea!.title })} className="press mt-3 flex h-11 items-center gap-2 rounded-full bg-white px-4 text-callout font-semibold text-black">
            <Icon name="mic" size={17} /> Record it for the children
          </button>
        </section>
      )}
      {canTell && viewer.role === "elder" && (
        <div className="mt-3">
          <p className="m-0 mb-2 text-footnote text-ink-soft">Not sure what to tell? Try one of these:</p>
          <div className="flex flex-wrap gap-1.5">
            {STARTERS.map((s) => (
              <button key={s} type="button" onClick={() => openAdd("voice", { kind: "story", prompt: s })} className="press rounded-full bg-surface px-3 py-2 text-footnote">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {viewer.role === "elder" && <OnlyYouCanTell onTell={(prompt) => openAdd("voice", { kind: "story", prompt })} />}
      {viewer.role === "child" && data && <AskElder asked={mine.map((q) => q.text)} onAsked={() => void reload()} />}

      {data === null && <div className="skeleton mt-6 h-[220px] rounded-card" aria-busy="true" aria-label="Loading stories" />}

      {tellers.map((id) => {
        const teller = byId(id);
        const list = stories.filter((s) => s.tellerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return (
          <section key={id} aria-label={`${callName(teller)}'s stories`}>
            <div className="mb-3 mt-7 flex items-center gap-2.5">
              <Avatar src={memberPhoto(teller)} name={callName(teller)} size={38} />
              <h2 className="m-0 min-w-0 flex-1 truncate text-title">
                {id === viewer.id ? "Your stories" : `${callName(teller)}'s stories`}
              </h2>
            </div>
            <ul className="no-scrollbar -mx-4 my-0 flex list-none snap-x scroll-px-4 gap-3 overflow-x-auto py-0 pb-1 pl-4 pr-4">
              {list.map((s) => {
                const card = cardOf(s) as Card;
                const on = current?.id === card.id;
                return (
                  <li key={s.id} className={cn("relative w-[164px] shrink-0 snap-start", fresh === s.id && "rounded-[24px] ring-4 ring-marigold")}>
                    <button type="button" data-card={card.id} onClick={() => (on ? toggle() : play(card))} className="press block w-full text-left" aria-label={`${on && isPlaying ? "Pause" : "Play"} ${s.title}, told by ${callName(teller)}`}>
                      <span className="relative block">
                        <StoryCover theme={s.theme} className="h-[136px] rounded-[22px]" />
                        <span className="absolute bottom-2 right-2 grid h-10 w-10 place-items-center rounded-full bg-white text-ink shadow-frost">
                          <Icon name={on && isPlaying ? "pause" : "play"} size={18} />
                        </span>
                      </span>
                      <span className="mt-2 line-clamp-2 block text-body font-semibold leading-tight">{s.title}</span>
                      <span className="mt-0.5 block text-caption text-ink-soft">
                        {THEME_LOOK[s.theme].label}
                        {minutesOf(card) ? ` · ${minutesOf(card)}` : ""}
                        {s.ages !== "all" ? ` · ${AGE_LABEL[s.ages]}` : ""}
                      </span>
                    </button>
                    <div className="absolute left-1.5 top-1.5">
                      <ShareQuote words={card.transcript || s.summary} speaker={teller} at={card.takenAt} context={`A story \u00b7 ${s.title}`} className="h-10 w-10 bg-white/90 text-ink shadow-frost" />
                    </div>
                    {canChange(viewer, s.tellerId) && (
                      <div className="absolute right-1.5 top-1.5">
                        <ActionMenu
                          label={`${s.title} options`}
                          actions={[
                            ...(canChange(viewer, s.tellerId, "edit") ? [{ label: "Edit", onSelect: () => setEditing(s) }] : []),
                            { label: "Remove from Stories", danger: true, confirm: "Remove it? The voice note stays in Memory Lane.", onSelect: async () => { await postJson("/api/stories", { action: "delete", storyId: s.id }); await reload(); } },
                          ]}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {list[0]?.summary && <p className="m-0 mt-2 line-clamp-2 text-footnote text-ink-soft">{list[0].summary}</p>}
          </section>
        );
      })}

      {data && stories.length === 0 && (
        <div className="mt-6 rounded-hero bg-surface px-6 py-10 text-center">
          <p className="m-0 text-title font-semibold">No stories yet</p>
          <p className="mx-auto mt-2 max-w-[300px] text-body text-ink-soft">Ask Dadi or Nana for one. Their voice, at bedtime, wherever the children are.</p>
        </div>
      )}

      {mine.length > 0 && (
        <section aria-label="You asked for">
          <SectionTitle>You asked for</SectionTitle>
          <ul className="m-0 list-none space-y-2 p-0">
            {mine.map((q) => (
              <li key={q.id} className="flex items-center gap-3 rounded-[18px] bg-surface px-3 py-2.5">
                <Avatar src={memberPhoto(byId(q.toMemberId))} name={callName(byId(q.toMemberId))} size={36} />
                <span className="voice min-w-0 flex-1 text-body">&ldquo;{q.text}&rdquo;</span>
                <button type="button" onClick={async () => { await postJson("/api/stories", { action: "withdraw", questionId: q.id }); await reload(); }} className="h-9 shrink-0 text-footnote font-medium text-ink-soft">
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stories.some((s) => s.madeBy === "muse") && <MuseMark className="mt-6">Muse gave the stories their titles; the stories are the family&rsquo;s own</MuseMark>}

      <AnimatePresence>{bedtime && <Bedtime stories={stories} cardOf={cardOf} tellers={tellers.map((id) => byId(id)).filter((x): x is Member => Boolean(x))} onClose={() => setBedtime(false)} />}</AnimatePresence>
      <AnimatePresence>{editing && <EditStory story={editing} onDone={async () => { setEditing(null); await reload(); }} />}</AnimatePresence>
    </div>
  );
}

/** Names for {child} and {grandchild}: the family's grown-ups and children, in the viewer's words. */
function familyNames(members: Member[], viewerId: string) {
  const call = (list: Member[]) => list.filter((x) => x.id !== viewerId).map(callName);
  return { children: call(members.filter((x) => x.role === "adult")), grandchildren: call(members.filter((x) => x.role === "child")) };
}

/** For an elder: the stories only they can tell, as family questions a grandchild would love answered. */
function OnlyYouCanTell({ onTell }: { onTell: (prompt: string) => void }) {
  const { viewer, members } = useViewer();
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(new Date().toISOString().slice(0, 10)), []);
  if (!today) return null;
  const names = familyNames(members, viewer.id);
  const ideas = familyStoriesFor(today, 5).map((i, n) => resolveIdea(i, names, n));
  return (
    <section aria-label="Stories only you can tell" className="mt-6">
      <h2 className="m-0 text-title">Stories only you can tell</h2>
      <p className="m-0 mt-1 text-callout text-ink-soft">Children who know their family&rsquo;s stories feel steadier. Pick one and just talk.</p>
      <ul className="m-0 mt-3 list-none space-y-2 p-0">
        {ideas.map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => onTell(i.title)} className="press flex min-h-[56px] w-full items-center gap-3 rounded-[18px] bg-surface px-4 py-2.5 text-left">
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold leading-snug">{i.title}</span>
                <span className="mt-0.5 block text-footnote text-ink-soft">{i.beats[0]}</span>
              </span>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black text-white" aria-hidden="true">
                <Icon name="mic" size={18} />
              </span>
              <span className="sr-only">Record this story</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** For a child: five questions, one tap each, to the eldest elder, through the same ask flow. */
function AskElder({ asked, onAsked }: { asked: string[]; onAsked: () => void }) {
  const { viewer, members } = useViewer();
  const [today, setToday] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => setToday(new Date().toISOString().slice(0, 10)), []);
  // No ages are kept, so "eldest" is the first elder the family listed.
  const elder = members.find((x) => x.role === "elder" && x.id !== viewer.id);
  if (!today || !elder) return null;
  const ideas = familyStoriesFor(today, 5, (i) => asked.includes(`Tell me a story about ${i.ask}`));
  if (!ideas.length && !sent) return null;
  const name = callName(elder);
  return (
    <section aria-label={`Ask ${name}`} className="mt-6">
      <h2 className="m-0 text-title">Ask {name}</h2>
      <p className="m-0 mt-1 text-callout text-ink-soft">One tap sends the question. {name} answers in their own voice.</p>
      {sent && (
        <p className="m-0 mt-3 rounded-card bg-[#e8f3e1] p-4 text-body text-[#3d6b2a]" role="status">
          Asked! {name} will see it on their courtyard.
        </p>
      )}
      <ul className="m-0 mt-3 list-none space-y-2 p-0">
        {ideas.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              onClick={async () => {
                const out = await postJson("/api/stories", { action: "request", toMemberId: elder.id, about: i.ask });
                if (out) {
                  setSent(i.ask ?? "");
                  onAsked();
                }
              }}
              className="press flex min-h-[48px] w-full items-center gap-3 rounded-[18px] bg-surface px-4 py-2.5 text-left text-body font-medium"
            >
              <span className="min-w-0 flex-1 leading-snug">Tell me about {i.ask}</span>
              <Icon name="send" size={17} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AskStory({ onDone }: { onDone: () => void }) {
  const { viewer, members } = useViewer();
  const tellers = members.filter((x) => x.id !== viewer.id && x.access !== "child").sort((a, b) => Number(b.role === "elder") - Number(a.role === "elder"));
  const [to, setTo] = useState(tellers[0]?.id ?? "");
  const [about, setAbout] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const person = members.find((x) => x.id === to);
  if (sent) return <p className="m-0 mt-3 rounded-card bg-[#e8f3e1] p-4 text-body text-[#3d6b2a]">Asked! {sent} will see it on their courtyard.</p>;
  return (
    <div className="mt-3 rounded-card bg-surface p-4">
      <p className="m-0 mb-2 text-footnote font-medium text-ink-soft">Who should tell it?</p>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {tellers.map((x) => (
          <button key={x.id} type="button" aria-pressed={to === x.id} onClick={() => setTo(x.id)} className={cn("press flex h-11 shrink-0 items-center gap-2 rounded-full pl-1 pr-4 text-body font-medium", to === x.id ? "bg-black text-white" : "bg-white")}>
            <Avatar src={memberPhoto(x)} name={callName(x)} size={34} />
            {callName(x)}
          </button>
        ))}
      </div>
      <p className="m-0 mb-2 mt-4 text-footnote font-medium text-ink-soft">A story about…</p>
      <div className="flex flex-wrap gap-1.5">
        {ASK_ABOUT.map((a) => (
          <button key={a} type="button" aria-pressed={about === a} onClick={() => setAbout(a)} className={cn("press rounded-full px-3 py-2 text-callout", about === a ? "bg-black text-white" : "bg-white")}>
            {a}
          </button>
        ))}
      </div>
      <input value={about} onChange={(e) => setAbout(e.target.value.slice(0, 80))} placeholder="or type anything" className="mt-3 h-12 w-full rounded-full bg-white px-5 text-body outline-none focus:ring-2 focus:ring-marigold" aria-label="What the story should be about" />
      <Button
        className="mt-3 w-full"
        disabled={!to || about.trim().length < 2}
        onClick={async () => {
          const out = await postJson("/api/stories", { action: "request", toMemberId: to, about: about.trim() });
          if (out) {
            setSent(callName(person));
            setTimeout(onDone, 1600);
          }
        }}
      >
        Ask {callName(person)}
      </Button>
    </div>
  );
}

/** Dark, warm, one big button. Plays one teller's stories in a row, then stops. */
function Bedtime({ stories, cardOf, tellers, onClose }: { stories: Story[]; cardOf: (s: Story) => Card | undefined; tellers: Member[]; onClose: () => void }) {
  const { play, current, isPlaying, toggle, collapse, currentTime, duration } = usePlayer();
  const [teller, setTeller] = useState<string>(tellers[0]?.id ?? "");
  const [sleep, setSleep] = useState<number | null>(20);
  const [ending, setEnding] = useState<number | null>(null);
  const queue = useMemo(() => stories.filter((s) => s.tellerId === teller).map(cardOf).filter((c): c is Card => Boolean(c)), [stories, teller, cardOf]);
  const idx = queue.findIndex((c) => c.id === current?.id);
  const playingHere = idx >= 0;
  const wasPlaying = useRef(false);

  // Next story when one finishes; stop at the end of the list.
  useEffect(() => {
    if (wasPlaying.current && !isPlaying && playingHere && currentTime >= duration - 0.5) {
      const next = queue[idx + 1];
      if (next) {
        play(next);
        collapse();
      }
    }
    wasPlaying.current = isPlaying;
  }, [isPlaying, playingHere, currentTime, duration, queue, idx, play, collapse]);

  // Sleep timer: lights out after N minutes, whatever is playing.
  useEffect(() => {
    if (!isPlaying || !playingHere || sleep === null) return;
    const at = ending ?? Date.now() + sleep * 60_000;
    if (ending === null) setEnding(at);
    const t = window.setTimeout(() => {
      if (isPlaying) toggle();
      setEnding(null);
    }, Math.max(0, at - Date.now()));
    return () => window.clearTimeout(t);
  }, [isPlaying, playingHere, sleep, ending, toggle]);

  const start = () => {
    if (playingHere) return toggle();
    if (queue[0]) {
      play(queue[0]);
      collapse();
      setEnding(null);
    }
  };
  const now = playingHere ? stories.find((s) => s.cardId === current?.id) : undefined;

  return (
    <m.div className="fixed inset-0 z-50 flex flex-col text-white" style={{ background: "linear-gradient(180deg,#0b1026 0%,#1b2350 60%,#2d2a5a 100%)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label="Bedtime stories">
      <svg viewBox="0 0 390 300" className="pointer-events-none absolute inset-x-0 top-0 h-[300px] w-full" aria-hidden="true">
        {Array.from({ length: 40 }, (_, i) => (
          <circle key={i} cx={(i * 89) % 390} cy={(i * 47) % 280 + 8} r={i % 5 === 0 ? 1.8 : 1} fill="#fff" opacity={0.6} />
        ))}
        <path d="M320 50a34 34 0 1 0 18 60 27 27 0 1 1-18-60z" fill="#e8ecff" />
      </svg>
      <div className="relative flex items-center justify-between px-4" style={{ paddingTop: "calc(16px + env(safe-area-inset-top))" }}>
        <p className="m-0 text-body font-semibold text-white/80">Bedtime</p>
        <button type="button" onClick={() => { if (isPlaying && playingHere) toggle(); onClose(); }} aria-label="Close bedtime" className="press grid h-11 w-11 place-items-center rounded-full bg-white/10">
          <Icon name="close" />
        </button>
      </div>
      <div className="relative mt-auto px-4" style={{ paddingBottom: "calc(28px + env(safe-area-inset-bottom))" }}>
        <p className="m-0 text-callout text-white/70">Stories told by</p>
        <div className="no-scrollbar -mx-4 mt-2 flex gap-2 overflow-x-auto px-4">
          {tellers.map((t) => (
            <button key={t.id} type="button" aria-pressed={teller === t.id} onClick={() => setTeller(t.id)} className={cn("press flex h-12 shrink-0 items-center gap-2 rounded-full pl-1 pr-4 text-body font-semibold", teller === t.id ? "bg-white text-[#141c3a]" : "bg-white/10 text-white")}>
              <Avatar src={memberPhoto(t)} name={callName(t)} size={40} />
              {callName(t)}
            </button>
          ))}
        </div>
        <p data-display className="m-0 mt-6 min-h-[56px] text-display font-bold leading-tight">{now ? now.title : `${queue.length} ${queue.length === 1 ? "story" : "stories"} waiting`}</p>
        {now && <p className="m-0 mt-1 text-callout text-white/70">Story {idx + 1} of {queue.length}</p>}
        <button type="button" onClick={start} disabled={!queue.length} className="press mt-5 flex h-[72px] w-full items-center justify-center gap-3 rounded-full bg-[#f2c46d] text-title font-bold text-[#141c3a] disabled:opacity-40">
          <Icon name={playingHere && isPlaying ? "pause" : "play"} size={24} />
          {playingHere && isPlaying ? "Pause" : playingHere ? "Keep listening" : "Start"}
        </button>
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-callout text-white/70">Lights out after</span>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Sleep timer">
            {[10, 20, 30, null].map((n) => (
              <button key={String(n)} type="button" role="radio" aria-checked={sleep === n} onClick={() => { setSleep(n); setEnding(null); }} className={cn("press h-10 rounded-full px-3.5 text-callout font-semibold", sleep === n ? "bg-white text-[#141c3a]" : "bg-white/10")}>
                {n === null ? "Off" : `${n} min`}
              </button>
            ))}
          </div>
        </div>
      </div>
    </m.div>
  );
}

function EditStory({ story, onDone }: { story: Story; onDone: () => void }) {
  const [title, setTitle] = useState(story.title);
  const [theme, setTheme] = useState(story.theme);
  const [ages, setAges] = useState(story.ages);
  const [summary, setSummary] = useState(story.summary);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Edit story">
      <m.button type="button" aria-label="Close" className="absolute inset-0 bg-black/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onDone} />
      <m.div className="relative w-full max-w-[480px] rounded-t-[32px] bg-white px-4 pt-4 shadow-frost" style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom))" }} initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 340, damping: 36 }}>
        <p className="m-0 text-title font-semibold">Edit story</p>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className="mt-3 h-12 w-full rounded-[16px] bg-surface px-4 text-headline font-semibold outline-none" aria-label="Title" />
        <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Theme">
          {STORY_THEMES.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} onClick={() => setTheme(t)} className={cn("press h-9 rounded-full px-3 text-footnote", theme === t ? "bg-black text-white" : "bg-surface")}>
              {THEME_LOOK[t].label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Ages">
          {STORY_AGES.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={ages === a} onClick={() => setAges(a)} className={cn("press h-9 rounded-full px-3 text-footnote", ages === a ? "bg-black text-white" : "bg-surface")}>
              {AGE_LABEL[a]}
            </button>
          ))}
        </div>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={200} rows={2} placeholder="One line for parents (optional)" className="mt-3 w-full resize-none rounded-[16px] bg-surface p-4 text-body outline-none" aria-label="Summary" />
        <div className="mt-4 flex gap-2">
          <Button
            className="flex-[1.4]"
            disabled={!title.trim()}
            onClick={async () => {
              await postJson("/api/stories", { action: "edit", storyId: story.id, title: title.trim(), theme, ages, summary: summary.trim() });
              onDone();
            }}
          >
            Save
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </m.div>
    </div>
  );
}
