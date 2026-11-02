"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar, Icon, RoomHeader, type IconName } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import type { Knock } from "@/lib/kinds";
import { callName, memberPhoto } from "@/lib/people";
import { postJson, useJson } from "@/lib/use-json";

// Play together: ready things to do on a call across homes. Each one opens
// your door now (the same "sit together" knock as the family page) with that
// reason, and takes you into the call. Nothing to plan.

interface Activity {
  id: string;
  title: string;
  line: string;
  /** The knock note others see: "Come sit with me" with a reason. */
  note: string;
  icon: IconName;
  minutes: number;
}

const ACTIVITIES: Activity[] = [
  { id: "chai", title: "Tea and catch-up", line: "A cup each, wherever you are. Just talk.", note: "Tea and catch-up, come sit", icon: "coffee", minutes: 45 },
  { id: "story", title: "Story night", line: "A grandparent tells one, the children listen.", note: "Story night, come listen", icon: "moon", minutes: 30 },
  { id: "song", title: "Song game", line: "Sing a line; the next song starts where it ended.", note: "Song game, come sing", icon: "music", minutes: 45 },
  { id: "quiz", title: "Family quiz", line: "Who said it, where was this photo, whose recipe.", note: "Family quiz, come play", icon: "sparkle", minutes: 30 },
];

export default function PlayPage() {
  const router = useRouter();
  const { viewer, members } = useViewer();
  const sit = useJson<{ knocks: Knock[] }>("/api/sit");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const open = (sit.data?.knocks ?? []).filter((k) => k.memberId !== viewer.id);

  const start = async (a: Activity) => {
    setBusy(a.id);
    setError(false);
    const out = await postJson<{ knock: Knock }>("/api/sit", { action: "knock", minutes: a.minutes, note: a.note });
    setBusy(null);
    if (out?.knock) router.push(`/call/${out.knock.id}`);
    else setError(true);
  };

  return (
    <div>
      <RoomHeader title="Play" subtitle="Something to do on a call, right now." />

      {open.map((k) => {
        const who = members.find((m) => m.id === k.memberId);
        return (
          <button key={k.id} type="button" onClick={() => router.push(`/call/${k.id}`)} className="press mb-3 flex min-h-[56px] w-full items-center gap-3 rounded-card bg-[#1c1b1a] p-3 pl-4 text-left text-white shadow-card">
            <Avatar src={memberPhoto(who)} name={callName(who)} size={44} />
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold">{callName(who)}&rsquo;s door is open</span>
              <span className="block truncate text-body text-white/75">{k.note || "Come sit with me"}</span>
            </span>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-[#1c1b1a]">
              <Icon name="video" size={20} />
            </span>
          </button>
        );
      })}

      <ul className="m-0 grid list-none gap-3 p-0" aria-label="Things to do together">
        {ACTIVITIES.map((a) => (
          <li key={a.id}>
            <button type="button" disabled={busy !== null} onClick={() => void start(a)} className="press flex min-h-[88px] w-full items-center gap-4 rounded-card bg-card p-4 text-left text-ink shadow-card disabled:opacity-60">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-well">
                <Icon name={a.icon} size={22} strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-headline font-semibold leading-tight">{a.title}</span>
                <span className="mt-1 block text-body leading-snug text-ink-soft">{a.line}</span>
              </span>
              <span className="flex h-11 shrink-0 items-center rounded-full bg-[#1c1b1a] px-4 text-body font-semibold text-white">{busy === a.id ? "…" : "Start"}</span>
            </button>
          </li>
        ))}
      </ul>

      {error && (
        <p className="m-0 mt-3 text-center text-body text-[#b42318]" role="alert">
          Couldn&rsquo;t open the call. Try again.
        </p>
      )}
      <div className="mt-6 flex items-center gap-3 rounded-card bg-well p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-card">
          <Icon name="door" size={19} strokeWidth={1.8} />
        </span>
        <p className="m-0 text-body leading-snug text-ink-soft">Starting one opens your door for the family to join.</p>
      </div>
    </div>
  );
}
