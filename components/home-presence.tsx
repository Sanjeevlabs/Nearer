"use client";

import Link from "next/link";
import { useState } from "react";
import type { CareSettings, Knock, Need, Pet, Presence, PresenceMoment, Project, Question } from "@/lib/kinds";
import { callName, memberPhoto } from "@/lib/people";
import { MOMENT_LABEL, latestFor, quietDay, shareableFor, todayFor } from "@/lib/presence";
import type { Member } from "@/lib/schemas";
import { useDisplayText } from "@/lib/use-display-text";
import { ago, postJson, useJson } from "@/lib/use-json";
import { roomUrl } from "@/lib/overlap";
import { householdName, households, type Household } from "@/lib/households";
import { cn } from "@/lib/utils";
import { dayPartIn, placeFromTz, timeIn } from "@/lib/zones";
import { SafetyWatch } from "./safety";
import { useShell } from "./shell";
import { Translated } from "./translated";
import { Avatar, Icon, LiveDot, MuseMark } from "./ui/kit";
import { useViewer } from "./viewer";

interface PresenceData {
  presence: Presence[];
  settings: CareSettings[];
}

/**
 * The top of the courtyard. For children abroad: each parent's day, felt the
 * moment they open the app. For parents: share your day in one tap, answer
 * this week's question, ask for help.
 */
export function CourtyardNow() {
  const { viewer, members } = useViewer();
  const pres = useJson<PresenceData>("/api/presence", { every: 60_000 });
  const { relationships } = useViewer();
  const farHomes = households(members, relationships).filter((h) => h.elders && !h.members.some((m) => m.id === viewer.id));
  const pets = useJson<{ pets: Pet[] }>("/api/pets");
  const stories = useJson<{ stories: StoryLite[] }>(viewer.role === "child" ? "/api/stories" : null);
  const visit = useNextVisit();

  if (viewer.role === "elder")
    return (
      <div className="mt-5 space-y-3">
        <SafetyWatch />
        <MyQuestions />
        <MyNeeds />
      </div>
    );

  // One "now" card, never a stack: an open door beats a story, a story beats a
  // visit, a visit beats the far home's day. Safety alerts always show.
  const home = farHomes[0];
  const story = stories.data?.stories[0];
  // A live call shows on the Sit together card; the children's day and
  // one-tap moments live on the window.
  const now = story ? (
    <StoryDoor story={story} />
  ) : visit ? (
    <VisitCountdown visit={visit} />
  ) : home ? (
    <HomeNow home={home} presence={pres.data?.presence ?? null} settings={pres.data?.settings ?? []} viewerId={viewer.id} pets={(pets.data?.pets ?? []).filter((p) => home.members.some((m) => m.id === p.livesWith))} />
  ) : null;

  return (
    <div className="mt-5 space-y-3">
      <SafetyWatch />
      {now}
    </div>
  );
}

interface StoryLite {
  id: string;
  tellerId: string;
  title: string;
}

/** For children: tonight's story, one tap from the courtyard. */
export function StoryDoor({ story }: { story: StoryLite }) {
  const { members } = useViewer();
  const teller = members.find((m) => m.id === story.tellerId);
  return (
    <Link href="/stories" className="flex h-full min-h-[236px] flex-col justify-end gap-3 rounded-[26px] bg-[#1c1b1a] p-5 text-white no-underline">
      <Avatar src={memberPhoto(teller)} name={callName(teller)} size={44} ring />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-white/70">A story from {callName(teller)}</span>
        <span className="block truncate text-[16px] font-semibold">{story.title}</span>
      </span>
      <Icon name="moon" size={20} className="text-white/70" />
    </Link>
  );
}

export function useNextVisit(): Project | null {
  const { viewer } = useViewer();
  const { data } = useJson<{ projects: Project[] }>("/api/together");
  const now = Date.now();
  return (
    (data?.projects ?? [])
      .filter((p) => p.kind === "visit" && p.status === "active" && p.dueAt && Date.parse(p.dueAt) > now - 86_400_000)
      .filter((p) => p.visitorId === viewer.id || p.hostIds.includes(viewer.id))
      .sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""))[0] ?? null
  );
}

/** "12 days till Arjun is home": for the traveller and the home waiting. */
export function VisitCountdown({ visit }: { visit: Project }) {
  const { viewer, members } = useViewer();
  const now = Date.now();
  if (!visit.dueAt) return null;
  const days = Math.max(0, Math.ceil((Date.parse(visit.dueAt) - now) / 86_400_000));
  const who = members.find((m) => m.id === visit.visitorId);
  const coming = visit.visitorId === viewer.id;
  const hostPeople = visit.hostIds.map((id) => members.find((m) => m.id === id)).filter((m): m is Member => Boolean(m));
  const hosts = hostPeople.map((m) => callName(m)).join(" & ");
  const city = hostPeople.find((m) => m.city)?.city;
  const left = visit.tasks.filter((t) => !t.done && t.assignee === viewer.id).length;
  return (
    <Link href={`/together/${visit.id}`} className="frost flex h-full min-h-[236px] flex-col justify-between rounded-[26px] p-5 text-ink no-underline">
      <span className="tnum text-[56px] font-light leading-none tracking-[-0.03em]">{days || "Today"}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">
          {coming ? (days ? `day${days > 1 ? "s" : ""} to your visit${city ? ` to ${city}` : ""}` : `You travel${city ? ` to ${city}` : ""} today`) : days ? `day${days > 1 ? "s" : ""} until ${callName(who)} arrives` : `${callName(who)} arrives today`}
        </span>
        <span className="block truncate text-[13px] text-ink-soft">
          {visit.title}
          {coming && hosts ? ` · staying with ${hosts}` : ""}
          {left ? ` · ${left} thing${left > 1 ? "s" : ""} on your list` : ""}
        </span>
      </span>
      <Icon name="chevron" size={18} className="text-ink-faint" />
    </Link>
  );
}

export function KnockBanner({ knock, member }: { knock: Knock; member: Member | undefined }) {
  return (
    <div className="flex items-center gap-3 rounded-card bg-[#fff6e6] p-3.5">
      <Avatar src={memberPhoto(member)} name={callName(member)} size={44} ring />
      <div className="min-w-0 flex-1">
        <p className="m-0 flex items-center gap-1.5 text-[15px] font-semibold">
          <LiveDot />
          {callName(member)}&rsquo;s door is open
        </p>
        <p className="voice m-0 truncate text-[15px] text-[#8a4b00]">{knock.note || "Come sit with me?"}</p>
      </div>
      <a href={roomUrl(knock.id)} target="_blank" rel="noreferrer" className="press flex h-10 shrink-0 items-center rounded-full bg-black px-4 text-[14px] font-semibold text-white no-underline">
        Come sit
      </a>
    </div>
  );
}

/**
 * One far-away home, right now. Maa and Papa are one card: the home's local
 * time, then each parent's latest moment. A gentle flag only if a parent
 * asked for one, and only for the person they chose.
 */
function HomeNow({ home, presence, settings, viewerId, pets = [] }: { home: Household; presence: Presence[] | null; settings: CareSettings[]; viewerId: string; pets?: Pet[] }) {
  const { openAdd } = useShell();
  if (presence === null) return <div className="skeleton h-[96px] rounded-card" aria-busy="true" />;
  const elders = home.members.filter((m) => m.role === "elder");
  const name = householdName(home, (m) => callName(m));
  const rows = elders.map((parent) => {
    const shared = latestFor(parent.id, presence.filter((p) => p.moment !== "here"));
    const visit = latestFor(parent.id, presence.filter((p) => p.moment === "here"));
    const quiet = quietDay(settings.find((x) => x.memberId === parent.id), viewerId, presence, parent.tz);
    const fresh = Boolean(shared && Date.now() - Date.parse(shared.at) < 8 * 3_600_000);
    return { parent, shared, visit, quiet: quiet.quiet, fresh };
  });
  const quiet = rows.filter((r) => r.quiet);

  return (
    <div className={cn("rounded-card p-3.5", quiet.length ? "bg-[#fff6e6]" : "bg-surface")}>
      <Link href="/care" className="flex items-center gap-3 text-ink no-underline">
        <span className="flex shrink-0 -space-x-3">
          {elders.slice(0, 2).map((m) => (
            <Avatar key={m.id} src={memberPhoto(m)} name={callName(m)} size={44} ring />
          ))}
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[16px] font-semibold">{quiet.length ? `A quiet day for ${quiet.map((r) => callName(r.parent)).join(" & ")} so far` : `${name}'s ${dayPartIn(home.tz)}`}</p>
          <p className="m-0 truncate text-[13px] text-ink-soft">
            {timeIn(home.tz)} in {placeFromTz(home.tz)}
          </p>
        </div>
        <Icon name="chevron" size={18} className="text-ink-faint" />
      </Link>
      <ul className="m-0 mt-2.5 list-none space-y-1.5 p-0 pl-1">
        {rows.map(({ parent, shared, visit, fresh }) => (
          <li key={parent.id} className="flex items-baseline gap-2 text-[14px]">
            <span className="h-1.5 w-1.5 shrink-0 translate-y-[-2px] rounded-full bg-marigold" aria-hidden="true" />
            <span className="min-w-0 truncate">
              <span className="font-semibold">{callName(parent)}</span>{" "}
              {fresh && shared ? (
                <>
                  {MOMENT_LABEL[shared.moment].line}
                  {shared.note ? <span className="voice text-[15px] text-ink-soft"> · {shared.note}</span> : null}
                  <span className="text-ink-faint"> · {ago(shared.at)}</span>
                </>
              ) : visit && Date.now() - Date.parse(visit.at) < 24 * 3_600_000 ? (
                <span className="text-ink-soft">stopped by today</span>
              ) : shared ? (
                <span className="text-ink-soft">
                  {MOMENT_LABEL[shared.moment].line} · {ago(shared.at)}
                </span>
              ) : (
                <span className="text-ink-soft">nothing shared yet</span>
              )}
            </span>
          </li>
        ))}
        {pets.length > 0 && (
          <li className="flex items-baseline gap-2 text-[14px] text-ink-soft">
            <span className="h-1.5 w-1.5 shrink-0 translate-y-[-2px] rounded-full bg-black/20" aria-hidden="true" />
            {pets.map((p) => p.name).join(" & ")} {pets.length > 1 ? "are" : "is"} with them
          </li>
        )}
      </ul>
      {quiet.length > 0 && (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => openAdd("voice", null, home.members.map((m) => m.id))} className="press h-9 rounded-full bg-black px-3.5 text-[13px] font-semibold text-white">
            Send {name} a voice note
          </button>
        </div>
      )}
    </div>
  );
}

/** For children and grandchildren: let the parents feel *your* day, one tap. */
export function ShareYourDay() {
  const { viewer, members } = useViewer();
  const pres = useJson<{ presence: Presence[] }>("/api/presence");
  const [sent, setSent] = useState<PresenceMoment | null>(null);
  const elders = members.filter((m) => m.role === "elder");
  if (viewer.role === "elder" || elders.length === 0) return null;
  const names = elders.slice(0, 2).map((m) => callName(m)).join(" & ");
  const today = todayFor(viewer.id, pres.data?.presence ?? [], viewer.tz).filter((p) => p.moment !== "here");
  const share = async (moment: PresenceMoment) => {
    setSent(moment);
    await postJson("/api/presence", { moment });
    await pres.reload();
  };
  return (
    <section aria-label="Share your day" className="mt-5">
      <p className="m-0 text-[15px] font-semibold">{sent ? `${names} will see: ${MOMENT_LABEL[sent].label}` : `Let ${names} feel your day`}</p>
      <p className="m-0 text-[13px] text-ink-soft">{today.length ? `Shared today: ${today.map((p) => MOMENT_LABEL[p.moment].label).join(", ")}` : "The ordinary day is what they miss most."}</p>
      <div className="no-scrollbar -mx-5 mt-2.5 flex gap-2 overflow-x-auto px-5">
        {shareableFor(viewer.role).map((mo) => (
          <button key={mo} type="button" onClick={() => void share(mo)} className={cn("press h-10 shrink-0 rounded-full px-4 text-[14px] font-semibold", sent === mo ? "bg-ink text-white" : "bg-surface")}>
            {MOMENT_LABEL[mo].label}
          </button>
        ))}
      </div>
    </section>
  );
}

function QuestionLine({ q }: { q: Question }) {
  const { displayLang } = useViewer();
  const { text } = useDisplayText(q.text, q.lang, displayLang);
  return <>{text ?? q.text}</>;
}

/** For elders: this week's question and anything the family asked. */
export function MyQuestions() {
  const { viewer, members } = useViewer();
  const { openAdd } = useShell();
  const { data } = useJson<{ questions: Question[] }>("/api/keeper");
  // Only what someone in the family asked (the weekly question now lives in Today).
  const open = (data?.questions ?? [])
    .filter((q) => q.toMemberId === viewer.id && !q.answeredCardId && Boolean(q.askedBy))
    .sort((a, b) => Number(Boolean(b.askedBy)) - Number(Boolean(a.askedBy)) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 2);
  if (open.length === 0) return null;
  return (
    <>
      {open.map((q) => {
        const by = q.askedBy ? members.find((m) => m.id === q.askedBy) : undefined;
        return (
          <section key={q.id} aria-label="A question for you" className="rounded-card bg-[#fff6e6] p-4">
            <p className="m-0 text-[13px] font-medium text-[#8a4b00]">{by ? `${callName(by)} asked you` : "This week's question"}</p>
            <p className="voice m-0 mt-1 text-[20px] leading-snug">
              “<QuestionLine q={q} />”
            </p>
            <div className="mt-3 flex items-center justify-between gap-3">
              {!by ? <MuseMark>asked by Muse for your family</MuseMark> : <span />}
              <button
                type="button"
                onClick={() =>
                  q.topic === "recipe" && q.askedBy
                    ? openAdd("voice", { kind: "recipe", questionId: q.id, title: q.text.replace(/^How do you make your /i, "").replace(/\?$/, "") })
                    : q.topic === "story" && q.askedBy
                      ? openAdd("voice", { kind: "story", questionId: q.id, prompt: q.text })
                      : openAdd("voice", { kind: "answer", questionId: q.id, prompt: q.text })
                }
                className="press flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-black px-4 text-[14px] font-semibold text-white"
              >
                <Icon name="mic" size={16} />
                {q.topic === "story" && q.askedBy ? "Tell it" : q.topic === "recipe" && q.askedBy ? "Teach it" : q.topic === "blessing" ? "Bless" : "Answer"}
              </button>
            </div>
          </section>
        );
      })}
    </>
  );
}

/** For elders: what they asked for, and the reassurance in their language. */
export function MyNeeds() {
  const { viewer } = useViewer();
  const { openAdd } = useShell();
  const { data } = useJson<{ needs: Need[] }>("/api/care");
  const mine = (data?.needs ?? []).filter((n) => n.forMemberId === viewer.id && n.status !== "done").slice(0, 2);
  return (
    <section aria-label="Help" className="rounded-card bg-surface p-4">
      {mine.map((n) => (
        <Link key={n.id} href="/care" className="mb-3 block text-ink no-underline">
          <p className="m-0 text-[15px] font-semibold">
            <Translated text={n.title} />
          </p>
          <p className={cn("m-0 text-[14px]", n.noteForParent ? "voice text-[16px]" : "text-ink-soft")}>{n.noteForParent || "Waiting for someone to pick it up."}</p>
        </Link>
      ))}
      <button type="button" onClick={() => openAdd("voice", { kind: "need", forMemberId: viewer.id })} className="press flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black text-[15px] font-semibold text-white">
        <Icon name="mic" size={18} />
        Ask the family for help
      </button>
    </section>
  );
}
