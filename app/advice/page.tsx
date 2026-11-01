"use client";

import { useEffect, useMemo, useState } from "react";
import { VoiceRow } from "@/components/memory-card";
import { useShell } from "@/components/shell";
import { Avatar, Button, Icon, RoomHeader } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { ShareQuote } from "@/components/share-quote";
import { ADVICE_CATEGORIES, ADVICE_FALLBACK, adviceCategory, categoryLabel } from "@/lib/advice";
import type { Card } from "@/lib/schemas";
import type { Question } from "@/lib/kinds";
import { callName, memberPhoto } from "@/lib/people";
import { useFamilyCards } from "@/lib/use-family";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { Boundary } from "@/components/ui/boundary";

// Advice & blessings: what the elders said when the family asked, kept on
// shelves (data/advice-categories.json): life, marriage, raising children,
// studies, their own health and money habits (never medical or financial
// advice), home tricks, traditions, blessings. Recipes and stories have their
// own rooms. Asking works from here too, straight into a shelf.

type Q = Question & { category?: string };
interface Item {
  q: Q;
  card: Card;
  cat: string;
}

export default function AdvicePage() {
  const { viewer } = useViewer();
  const { refreshKey } = useShell();
  const { cards } = useFamilyCards(refreshKey);
  const { data, failed, reload } = useJson<{ questions: Q[] }>("/api/keeper");
  const parent = viewer.role === "elder";
  const [shelf, setShelf] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const items: Item[] = useMemo(
    () =>
      (data?.questions ?? [])
        .filter((q) => q.answeredCardId && (q.topic === "wisdom" || q.topic === "blessing"))
        .map((q) => ({ q, card: (cards ?? []).find((c) => c.id === q.answeredCardId), cat: adviceCategory(q) }))
        .filter((x): x is Item => Boolean(x.card))
        .sort((a, b) => (b.card.takenAt ?? "").localeCompare(a.card.takenAt ?? "")),
    [data, cards],
  );
  const waiting = (data?.questions ?? []).filter((q) => !q.answeredCardId && q.askedBy === viewer.id && (q.topic === "wisdom" || q.topic === "blessing")).length;
  const shelves = ADVICE_CATEGORIES.map((c) => ({ ...c, items: items.filter((x) => x.cat === c.id) })).filter((c) => c.items.length > 0);
  const current = shelves.find((s) => s.id === shelf);

  return (
    <div>
      <RoomHeader title="Advice" subtitle={parent ? "What you told the family when they asked" : "What they told you when you asked, kept for good"} />
      {failed && !data ? (
        <div className="rounded-card bg-surface px-4 py-8 text-center">
          <p className="m-0 text-body text-ink-soft">Couldn&rsquo;t load advice right now.</p>
          <Button variant="secondary" className="mx-auto mt-3 !h-11 !bg-white" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      ) : data === null || cards === null ? (
        <div className="skeleton h-[240px] rounded-card" aria-busy="true" aria-label="Loading" />
      ) : (
        <>
          <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="radiogroup" aria-label="Shelves">
            {!parent && (
              <button type="button" onClick={() => setAsking((v) => !v)} aria-expanded={asking} className={cn("press flex h-9 shrink-0 items-center gap-1 rounded-full px-3.5 text-callout font-semibold", asking ? "bg-black text-white" : "frost")}>
                <Icon name="plus" size={15} /> Ask
              </button>
            )}
            {shelves.length > 1 && (
              <button type="button" role="radio" aria-checked={!shelf} onClick={() => setShelf(null)} className={cn("press h-9 shrink-0 rounded-full px-3.5 text-callout font-medium", !shelf ? "bg-black text-white" : "bg-surface")}>
                All <span className={cn("tnum ml-1", !shelf ? "text-white/70" : "text-ink-faint")}>{items.length}</span>
              </button>
            )}
            {shelves.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={shelf === s.id} onClick={() => setShelf(shelf === s.id ? null : s.id)} className={cn("press h-9 shrink-0 rounded-full px-3.5 text-callout font-medium", shelf === s.id ? "bg-black text-white" : "bg-surface")}>
                {s.label} <span className={cn("tnum ml-1", shelf === s.id ? "text-white/70" : "text-ink-faint")}>{s.items.length}</span>
              </button>
            ))}
          </div>
          {waiting > 0 && !parent && <p className="m-0 mt-1 text-footnote text-ink-faint">{waiting} waiting for an answer</p>}

          {asking && !parent && <AskForm initial={shelf ?? ADVICE_FALLBACK} onDone={async () => { setAsking(false); await reload(); }} />}

          {items.length === 0 ? (
            <div className="mt-4 rounded-card bg-surface px-4 py-8 text-center">
              <p className="m-0 mx-auto max-w-[280px] text-body text-ink-soft">{parent ? "When the family asks for your advice or a blessing, your answers live here." : "Ask for their advice or a blessing. Their answer will live here."}</p>
              {!parent && !asking && (
                <Button className="mx-auto mt-4 !h-11" onClick={() => setAsking(true)}>
                  Ask now
                </Button>
              )}
            </div>
          ) : current ? (
            <section aria-label={current.label} className="mt-4">
              {current.note && <p className="m-0 mb-2 text-footnote text-ink-faint">{current.note}</p>}
              <div className="divide-y divide-[var(--line)] rounded-card bg-surface px-3.5">
                {current.items.map((x) => (
                  <Boundary key={x.q.id} label="This answer"><AdviceItem item={x} /></Boundary>
                ))}
              </div>
            </section>
          ) : (
            shelves.map((s) => (
              <section key={s.id} aria-label={s.label} className="mt-5">
                <button type="button" onClick={() => setShelf(s.id)} className="press mb-2 flex w-full items-baseline justify-between text-left">
                  <h2 className="m-0 text-headline">{s.label}</h2>
                  <span className="text-footnote text-ink-faint">{s.note ?? `${s.items.length}`}</span>
                </button>
                <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4">
                  {s.items.map((x) => (
                    <div key={x.q.id} className="w-[84%] max-w-[340px] shrink-0 snap-start rounded-card bg-surface px-3.5">
                      <Boundary label="This answer"><AdviceItem item={x} /></Boundary>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}

function AdviceItem({ item }: { item: Item }) {
  const { viewer, members } = useViewer();
  const giver = members.find((m) => m.id === item.q.toMemberId);
  const by = members.find((m) => m.id === item.q.askedBy);
  return (
    <div className="pt-3" data-card={item.card.id}>
      <div className="flex items-center gap-2">
        <Avatar src={memberPhoto(giver)} name={callName(giver)} size={24} />
        <p className="m-0 min-w-0 flex-1 truncate text-caption text-ink-soft">
          {giver?.id === viewer.id ? "You" : callName(giver)}
          {by ? ` · asked by ${by.id === viewer.id ? "you" : callName(by)}` : " · this week's question"}
        </p>
        <ShareQuote words={item.card.transcript || item.card.caption} speaker={giver} at={item.card.takenAt} context={item.q.topic === "blessing" ? "A blessing" : categoryLabel(item.cat)} className="-my-1 h-10 w-10" />
      </div>
      <p className="m-0 mt-1.5 line-clamp-2 text-callout font-semibold">&ldquo;{item.q.text}&rdquo;</p>
      <VoiceRow card={item.card} showAuthor={false} />
    </div>
  );
}

/** Ask an elder for advice or a blessing, on a chosen shelf. */
function AskForm({ initial, onDone }: { initial: string; onDone: () => Promise<void> }) {
  const { viewer, members } = useViewer();
  const elders = members.filter((m) => m.role === "elder" && m.id !== viewer.id);
  const [to, setTo] = useState<string>(elders[0]?.id ?? "");
  const [cat, setCat] = useState(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!to && elders[0]) setTo(elders[0].id);
  }, [elders, to]);
  const spec = ADVICE_CATEGORIES.find((c) => c.id === cat);
  const blessing = cat === "blessings";
  const send = async () => {
    const t = text.trim();
    if (!to || t.length < 5) return;
    setBusy(true);
    const out = await postJson("/api/keeper", { action: "ask", toMemberId: to, topic: blessing ? "blessing" : "wisdom", category: cat, text: blessing ? `Will you bless me for ${t}?` : t.endsWith("?") ? t : `${t}?` });
    setBusy(false);
    if (!out) return setMsg("Couldn't send it. Try again in a moment.");
    setText("");
    await onDone();
  };
  if (elders.length === 0) return <p className="m-0 mt-3 rounded-card bg-surface px-4 py-4 text-body text-ink-soft">Add a parent or grandparent first, then ask them here.</p>;
  return (
    <div className="frost mt-3 space-y-2.5 rounded-[22px] p-3">
      <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3" role="radiogroup" aria-label="Ask whom">
        {elders.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={to === m.id} onClick={() => setTo(m.id)} className={cn("press flex h-10 shrink-0 items-center gap-2 rounded-full pl-1 pr-3.5 text-callout font-semibold", to === m.id ? "bg-black text-white" : "bg-surface")}>
            <Avatar src={memberPhoto(m)} name={callName(m)} size={30} />
            {callName(m)}
          </button>
        ))}
      </div>
      <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Shelf" className="h-11 w-full rounded-full bg-surface px-4 text-callout font-semibold">
        {ADVICE_CATEGORIES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      {spec?.note && <p className="m-0 px-1 text-caption text-ink-faint">{spec.note}</p>}
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value.slice(0, 180))} onKeyDown={(e) => e.key === "Enter" && void send()} placeholder={spec?.placeholder || "What would you like to ask?"} aria-label={blessing ? "A blessing for what?" : "Your question"} className="h-12 min-w-0 flex-1 rounded-[14px] bg-white px-4 text-body outline-none ring-1 ring-black/5 focus:ring-2 focus:ring-black/30" />
        <button type="button" disabled={busy || text.trim().length < 5} onClick={() => void send()} aria-label="Send" className="press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-black text-white disabled:opacity-40">
          <Icon name="send" size={18} />
        </button>
      </div>
      {msg && <p className="m-0 px-1 text-footnote text-[#a3271b]" role="alert">{msg}</p>}
    </div>
  );
}
