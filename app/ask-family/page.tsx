"use client";

import { Search } from "lucide-react";
import { useRef, useState } from "react";
import { usePlayer } from "@/components/player";
import { Avatar, Icon, RoomHeader } from "@/components/ui/kit";
import { Boundary } from "@/components/ui/boundary";
import { useViewer } from "@/components/viewer";
import type { Citation } from "@/lib/archive";
import { callName, memberPhoto } from "@/lib/people";
import type { Card } from "@/lib/schemas";
import { useDisplayText } from "@/lib/use-display-text";
import { useFamilyCards } from "@/lib/use-family";

// Ask the family: a question answered only from what the family has said in
// their own voices. Every line of the answer points at the clip it came from,
// and the clip plays from that moment. If no one has said it, it offers to
// ask them, by voice.

type Result =
  | { status: "answer"; answer: string; citations: Citation[]; source: "muse" | "fallback" }
  | { status: "empty"; message: string; askTo: { id: string; name: string } | null };

const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function Cite({ cite, card }: { cite: Citation; card: Card | undefined }) {
  const { members, displayLang } = useViewer();
  const { play, seek, current, isPlaying, toggle } = usePlayer();
  const who = members.find((m) => m.id === cite.speakerId);
  const name = callName(who);
  const { text, translated } = useDisplayText(cite.quote, card?.transcriptLang ?? "en", displayLang);
  const playing = current?.id === cite.cardId && isPlaying;
  const onPlay = () => {
    if (!card) return;
    if (current?.id === card.id) {
      if (!isPlaying) toggle();
      seek(cite.at);
      return;
    }
    play(card);
    if (cite.at > 0) window.setTimeout(() => seek(cite.at), 120);
  };
  return (
    <li className="flex items-start gap-3 rounded-[20px] bg-surface p-3" data-card={cite.cardId}>
      <Avatar src={memberPhoto(who)} name={name} size={40} />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-footnote text-ink-soft">
          {name} · {dateOf(cite.takenAt)}
          {cite.at > 0 ? ` · at ${clock(cite.at)}` : ""}
        </p>
        <p className="voice m-0 mt-1 break-words text-callout leading-snug text-ink">&ldquo;{cite.quote}&rdquo;</p>
        {translated && text && text !== cite.quote && <p className="m-0 mt-1 break-words text-footnote text-ink-soft">{text}</p>}
      </div>
      {cite.playable && card ? (
        <button type="button" onClick={onPlay} aria-label={playing ? `Pause ${name}` : `Hear ${name} say it`} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-white">
          <Icon name={playing ? "pause" : "play"} size={16} />
        </button>
      ) : (
        <span className="grid h-11 w-11 shrink-0 place-items-center text-ink-faint" title="Written down, not recorded">
          <Icon name="pot" size={18} />
        </span>
      )}
    </li>
  );
}

function AskPage() {
  const { members, viewer } = useViewer();
  const { cards } = useFamilyCards();
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<"sending" | "sent" | "failed" | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const elder = members.find((m) => m.role === "elder" && m.id !== viewer.id);
  const ideas = elder ? [`How did ${callName(elder)} learn to swim?`, `What advice did ${callName(elder)} give?`, `How does ${callName(elder)} make their favourite dish?`] : [];

  async function ask(text: string) {
    const question = text.trim();
    if (question.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setSent(null);
    setResult(null);
    setAsked(question);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) });
      if (res.status === 429) setError("That's a lot of questions at once. Give it a minute.");
      else if (!res.ok) setError("Couldn't look through the family's voices just now.");
      else setResult((await res.json()) as Result);
    } catch {
      setError("Couldn't look through the family's voices just now.");
    }
    setBusy(false);
  }

  async function askByVoice(toMemberId: string) {
    setSent("sending");
    try {
      const res = await fetch("/api/keeper", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ask", toMemberId, text: asked.slice(0, 200), topic: "story" }) });
      setSent(res.ok ? "sent" : "failed");
    } catch {
      setSent("failed");
    }
  }

  return (
    <div>
      <RoomHeader title="Ask the family" subtitle="Answers come only from their own voices" />
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
        className="flex gap-2"
      >
        <label className="sr-only" htmlFor="ask-q">
          Ask the family
        </label>
        <input
          id="ask-q"
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={200}
          enterKeyHint="search"
          autoComplete="off"
          placeholder="What would you like to know?"
          className="h-12 min-w-0 flex-1 rounded-full bg-surface px-4 text-body text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ink"
        />
        <button type="submit" disabled={busy || q.trim().length < 3} aria-label="Ask" className="press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-ink text-white disabled:opacity-40">
          <Search size={18} aria-hidden="true" />
        </button>
      </form>

      {!result && !busy && !error && ideas.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Ideas">
          {ideas.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setQ(t);
                void ask(t);
              }}
              className="press min-h-11 rounded-full bg-surface px-4 py-2 text-left text-callout text-ink"
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div aria-live="polite" className="mt-5">
        {busy && (
          <div aria-busy="true" aria-label="Listening to the family" className="space-y-3">
            <div className="skeleton h-[96px] rounded-[22px]" />
            <div className="skeleton h-[72px] rounded-[20px]" />
          </div>
        )}
        {error && (
          <div className="rounded-[22px] bg-surface p-4">
            <p className="m-0 text-body">{error}</p>
            <button type="button" onClick={() => void ask(asked)} className="press mt-3 h-11 rounded-full bg-ink px-5 text-callout font-semibold text-white">
              Try again
            </button>
          </div>
        )}
        {result?.status === "answer" && (
          <Boundary label="This answer">
            <section aria-label="Answer">
              <p className="voice m-0 break-words text-title leading-snug text-ink">{result.answer}</p>
              {result.source === "fallback" && <p className="m-0 mt-2 text-footnote text-ink-soft">Muse couldn&rsquo;t write this up just now, so here are their own words.</p>}
              <h2 className="m-0 mb-2 mt-5 text-footnote font-semibold uppercase tracking-[0.18em] text-ink-soft">In their words</h2>
              <ul className="m-0 list-none space-y-2 p-0">
                {result.citations.map((c) => (
                  <Cite key={`${c.cardId}-${c.quote}`} cite={c} card={cards?.find((x) => x.id === c.cardId)} />
                ))}
              </ul>
            </section>
          </Boundary>
        )}
        {result?.status === "empty" && (
          <section aria-label="Nobody has said that yet" className="rounded-[22px] bg-surface p-4">
            <p className="voice m-0 text-title leading-snug text-ink">{result.message}</p>
            {result.askTo && sent !== "sent" && (
              <button
                type="button"
                onClick={() => void askByVoice(result.askTo!.id)}
                disabled={sent === "sending"}
                className="press mt-4 flex h-12 items-center gap-2 rounded-full bg-ink px-5 text-callout font-semibold text-white disabled:opacity-60"
              >
                <Icon name="mic" size={16} />
                Ask {result.askTo.name} by voice
              </button>
            )}
            {sent === "sent" && result.askTo && <p className="m-0 mt-3 text-body text-ink-soft">Asked. {result.askTo.name} will see your question and can answer in their own voice.</p>}
            {sent === "failed" && <p className="m-0 mt-3 text-body text-ink-soft">That didn&rsquo;t send. Try again in a moment.</p>}
          </section>
        )}
      </div>
    </div>
  );
}

export default function AskFamilyPage() {
  return <AskPage />;
}
