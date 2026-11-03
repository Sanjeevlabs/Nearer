"use client";

import { LoadFailed } from "@/components/load-failed";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { usePlayer } from "@/components/player";
import { RecipeCover, COURSE_LOOK, minutes, totalTime } from "@/components/recipe-art";
import { RecipeEditor } from "@/components/recipe-editor";
import { ShareRecipe } from "@/components/share-recipe";
import { useShell } from "@/components/shell";
import { ActionMenu, Avatar, Button, EmptyLine, Icon, MuseMark, Photo, PlayButton, RoomHeader, SectionTitle } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { canChange } from "@/lib/permissions";
import { useViewer } from "@/components/viewer";
import type { Attempt, Recipe } from "@/lib/kinds";
import { language } from "@/lib/languages";
import { resolveMediaUrl } from "@/lib/media-session";
import { callName, memberPhoto } from "@/lib/people";
import { useFamilyCards } from "@/lib/use-family";
import { ago, postJson, useJson } from "@/lib/use-json";

interface Payload {
  recipe: Recipe;
  original: Recipe;
  translated: boolean;
  attempts: Attempt[];
}

export default function RecipePage() {
  const { id } = useParams<{ id: string }>();
  const { viewer, members, displayLang } = useViewer();
  const { refreshKey } = useShell();
  const { cards } = useFamilyCards(refreshKey);
  const { play, current, isPlaying, toggle } = usePlayer();
  const { data, failed, notFound, reload } = useJson<Payload>(`/api/kitchen/${encodeURIComponent(id)}?lang=${encodeURIComponent(displayLang)}`);
  const [showOriginal, setShowOriginal] = useState(false);
  const search = useSearchParams();
  const [editing, setEditing] = useState(search.get("edit") === "1");
  const [have, setHave] = useState<Set<number>>(new Set());
  const router = useRouter();

  if (notFound) {
    return (
      <div>
        <RoomHeader title="Recipe" />
        <EmptyLine>This recipe isn&rsquo;t in your family&rsquo;s Kitchen.</EmptyLine>
      </div>
    );
  }
  if (failed && !data) {
    return (
      <div>
        <RoomHeader title="Recipe" />
        <LoadFailed what="This recipe" ui="recipe-retry" onRetry={() => void reload()} />
      </div>
    );
  }
  if (!data) {
    return (
      <div>
        <RoomHeader title="Recipe" />
        <div className="skeleton h-[300px] rounded-hero" aria-busy="true" aria-label="Loading recipe" />
      </div>
    );
  }

  const r = showOriginal ? data.original : data.recipe;
  const cook = members.find((m) => m.id === r.cookId);
  const writer = members.find((m) => m.id === data.original.addedBy);
  const voice = (cards ?? []).find((c) => c.id === r.voiceCardId);
  const video = (cards ?? []).find((c) => c.id === r.videoCardId);
  const videoUrl = video?.mediaRef ? (resolveMediaUrl(video.mediaRef) ?? video.mediaRef) : null;
  const active = voice && current?.id === voice.id;
  const lastPhoto = data.attempts.find((a) => a.photoRef)?.photoRef;
  const cover = data.original.coverRef ?? lastPhoto ?? null;
  const owner = (mode: "edit" | "delete") => canChange(viewer, data.original.cookId, mode) || Boolean(data.original.addedBy && canChange(viewer, data.original.addedBy, mode));
  const look = COURSE_LOOK[r.course] ?? COURSE_LOOK.other;

  const menu = [
    ...(owner("edit") ? [{ label: "Edit recipe", onSelect: () => setEditing(true) }] : []),
    ...(owner("delete")
      ? [
          {
            label: "Delete recipe",
            danger: true,
            confirm: "Delete this recipe and everyone's attempts? The voice memory stays in Memory Lane.",
            onSelect: async () => {
              await postJson("/api/kitchen", { action: "delete-recipe", recipeId: data.original.id });
              router.replace("/kitchen");
            },
          },
        ]
      : []),
  ];

  if (editing) return <RecipeEditor recipe={data.original} onDone={async () => { setEditing(false); await reload(); }} />;

  const stats = [
    ["Prep", minutes(r.prepMins)],
    ["Cook", minutes(r.cookMins)],
    ["Serves", r.serves],
  ].filter(([, v]) => v);

  return (
    <div>
      <RoomHeader
        title={r.title}
        action={
          <div className="flex items-center gap-1">
            <ShareRecipe recipe={data.original} cookName={callName(cook)} photo={cover ? (resolveMediaUrl(cover) ?? cover) : null} />
            {menu.length ? <ActionMenu actions={menu} label="Recipe options" /> : null}
          </div>
        }
      />

      <RecipeCover recipe={r} photo={cover ? (resolveMediaUrl(cover) ?? cover) : null} className="h-[230px] rounded-hero" />

      <p className="m-0 mt-5 text-footnote font-semibold uppercase tracking-[0.08em]" style={{ color: look.ink }}>
        {look.label}
        {totalTime(r) ? ` · ${totalTime(r)}` : ""}
      </p>
      <h1 data-display className="m-0 mt-1 text-display leading-[1.08]">{r.title}</h1>
      <Link href={cook ? `/people/${cook.id}` : "#"} className="mt-3 flex items-center gap-2.5 text-ink no-underline">
        <Avatar src={memberPhoto(cook)} name={callName(cook)} size={36} />
        <span className="text-body">
          <span className="font-semibold">{cook?.id === viewer.id ? "Your" : `${callName(cook)}'s`}</span> recipe
          {writer && writer.id !== cook?.id ? <span className="text-ink-soft"> · written down by {writer.id === viewer.id ? "you" : callName(writer)}</span> : null}
        </span>
      </Link>
      {r.memory && <p className="voice m-0 mt-4 text-title leading-snug">&ldquo;{r.memory}&rdquo;</p>}

      {stats.length > 0 && (
        <dl className="m-0 mt-5 grid divide-x divide-[var(--line)] rounded-card bg-surface py-3" style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}>
          {stats.map(([k, v]) => (
            <div key={k} className="px-2 text-center">
              <dt className="text-caption font-medium text-ink-soft">{k}</dt>
              <dd className="m-0 mt-0.5 text-body font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {(voice || videoUrl) && (
        <section aria-label="Taught by" className="mt-4 space-y-2">
          {voice && (
            <div className="flex items-center gap-3 rounded-card bg-well p-3.5">
              <PlayButton playing={Boolean(active && isPlaying)} onClick={() => (active ? toggle() : play(voice))} label={`Hear ${callName(cook)} teach it`} />
              <span className="min-w-0">
                <span className="block text-body font-semibold">Hear {callName(cook)} teach it</span>
                <span className="block text-footnote text-ink-soft">In their own words, step by step</span>
              </span>
            </div>
          )}
          {videoUrl && (
            <video src={videoUrl} controls playsInline preload="metadata" className="aspect-video w-full rounded-card bg-black" aria-label={`Video of ${r.title}`} />
          )}
        </section>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        {data.original.madeBy === "muse" && <MuseMark>written from {callName(cook)}&rsquo;s voice memory</MuseMark>}
        {data.translated && (
          <button type="button" onClick={() => setShowOriginal((v) => !v)} className="text-caption font-medium text-ink-soft underline underline-offset-2">
            {showOriginal ? `Show in ${language(displayLang).native}` : `Translated · show ${language(data.original.lang).native}`}
          </button>
        )}
      </div>

      {r.prepWork.length > 0 && (
        <section aria-label="Before you start">
          <SectionTitle>Before you start</SectionTitle>
          <ul className="m-0 list-none space-y-2 p-0">
            {r.prepWork.map((p, n) => (
              <li key={n} className="flex items-start gap-3 rounded-[16px] bg-surface px-4 py-3 text-body">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: look.accent }} aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Ingredients">
        <SectionTitle>
          Ingredients <span className="text-body font-medium text-ink-faint">· {r.ingredients.length}</span>
        </SectionTitle>
        <ul className="m-0 list-none divide-y divide-[var(--line)] rounded-card bg-surface p-0 px-2">
          {r.ingredients.map((i, n) => {
            const got = have.has(n);
            return (
              <li key={n}>
                <button type="button" aria-pressed={got} onClick={() => setHave((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; })} className="flex w-full items-center gap-3 px-2 py-3 text-left">
                  <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border-2", got ? "border-black bg-accent text-accent-ink" : "border-black/20")} aria-hidden="true">
                    {got && <Icon name="check" size={14} strokeWidth={3} />}
                  </span>
                  <span className={cn("min-w-0 flex-1 text-body font-semibold", got && "text-ink-faint line-through decoration-black/20")}>{i.item}</span>
                  <span className="shrink-0 text-right">
                    {i.said && <span className="voice block text-body">{i.said}</span>}
                    {i.approx && <span className="tnum block text-footnote text-ink-faint">{i.said ? "≈ " : ""}{i.approx.replace(/^(about|≈)\s*/i, "")}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="m-0 mt-2 px-1 text-caption text-ink-faint">Tap to tick what you have. Amounts are as {callName(cook)} says them; ≈ is a rough guide.</p>
      </section>

      <section aria-label="Method">
        <SectionTitle>Method</SectionTitle>
        <ol className="m-0 list-none space-y-5 p-0">
          {r.steps.map((st, n) => (
            <li key={n} className="flex gap-3.5">
              <span className="tnum grid h-8 w-8 shrink-0 place-items-center rounded-full text-callout font-bold text-white" style={{ background: look.ink }}>{n + 1}</span>
              <div className="pt-1">
                <p className="m-0 text-headline leading-snug">{st.text}</p>
                {st.tip && (
                  <p className="voice m-0 mt-1.5 text-headline text-ink-soft">
                    &ldquo;{st.tip}&rdquo; <span className="not-italic text-footnote text-ink-faint">— {callName(cook)}</span>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {r.outcome && (
        <section aria-label="How you know it's right" className="mt-8 rounded-card p-4" style={{ background: look.bg }}>
          <p className="m-0 text-footnote font-semibold uppercase tracking-[0.06em]" style={{ color: look.ink }}>
            How you know it&rsquo;s right
          </p>
          <p className="m-0 mt-1 text-headline leading-snug">{r.outcome}</p>
        </section>
      )}

      <Link href={`/gather?reason=cook&recipe=${encodeURIComponent(data.original.id)}`} className="press mt-8 flex h-12 items-center justify-center gap-2 rounded-full bg-surface text-body font-semibold text-ink no-underline">
        <Icon name="door" size={18} />
        Cook this together, live
      </Link>

      <Cooked recipe={data.original} attempts={data.attempts} cookName={callName(cook)} onChange={() => void reload()} viewerId={viewer.id} />
    </div>
  );
}

function Cooked({ recipe, attempts, cookName, onChange, viewerId }: { recipe: Recipe; attempts: Attempt[]; cookName: string; onChange: () => void; viewerId: string }) {
  const { members } = useViewer();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<{ ref: string; url: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isCook = recipe.cookId === viewerId;

  const pick = async (file: File) => {
    setBusy(true);
    try {
      const { processHomeImage } = await import("@/lib/media-client");
      const out = await processHomeImage(file);
      setPhoto({ ref: out.mediaRef, url: out.url });
    } catch {
      /* unreadable: keep going without a photo */
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Cooked by the family">
      <SectionTitle>Cooked by the family</SectionTitle>
      {attempts.length === 0 && <p className="m-0 mb-3 text-body text-ink-soft">Nobody has cooked it yet. {isCook ? "When they do, you can bless it." : `${cookName} would love to see yours.`}</p>}
      <ul className="m-0 list-none space-y-3 p-0">
        {attempts.map((a) => {
          const who = members.find((m) => m.id === a.memberId);
          const src = a.photoRef ? (resolveMediaUrl(a.photoRef) ?? a.photoRef) : null;
          const blessed = a.blessedBy.map((id) => members.find((m) => m.id === id)).filter(Boolean);
          const canBless = a.memberId !== viewerId && !a.blessedBy.includes(viewerId);
          const blessedByMe = a.blessedBy.includes(viewerId);
          const me = members.find((m) => m.id === viewerId);
          return (
            <li key={a.id} className="overflow-hidden rounded-card bg-surface">
              {src && (
                <div className="relative h-[200px]">
                  <Photo src={src} alt={`${callName(who)}'s ${recipe.title}`} sizes="440px" />
                </div>
              )}
              <div className="p-4">
                <div className="flex items-center gap-2.5">
                  <Avatar src={memberPhoto(who)} name={callName(who)} size={32} />
                  <span className="text-body font-semibold">{a.memberId === viewerId ? "You" : callName(who)}</span>
                  <span className="text-footnote text-ink-faint">{ago(a.createdAt)}</span>
                  <span className="flex-1" />
                  {canChange(me, a.memberId) && (
                    <ActionMenu
                      label="Attempt options"
                      actions={[{ label: "Delete", danger: true, confirm: "Delete this attempt?", onSelect: async () => { await postJson("/api/kitchen", { action: "delete-attempt", attemptId: a.id }); onChange(); } }]}
                    />
                  )}
                </div>
                {a.note && <p className="voice m-0 mt-2 text-headline leading-snug">“{a.note}”</p>}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-footnote text-ink-soft">{blessed.length ? `${blessed.map((m) => callName(m)).join(", ")} blessed this` : ""}</span>
                  {blessedByMe && (
                    <button type="button" onClick={async () => { await postJson("/api/kitchen", { action: "unbless", attemptId: a.id }); onChange(); }} className="press flex h-10 items-center gap-1.5 rounded-full bg-well px-4 text-callout font-semibold text-ink-soft">
                      <Icon name="bless" size={16} />
                      Blessed
                    </button>
                  )}
                  {canBless && (
                    <button
                      type="button"
                      onClick={async () => {
                        await postJson("/api/kitchen", { action: "bless", attemptId: a.id });
                        onChange();
                      }}
                      className="press flex h-10 items-center gap-1.5 rounded-full bg-surface px-4 text-callout font-semibold"
                    >
                      <Icon name="bless" size={16} />
                      Bless
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {!isCook && (
        <div className="mt-4">
          {!open ? (
            <Button className="w-full" onClick={() => setOpen(true)}>
              <Icon name="pot" size={18} />I made this
            </Button>
          ) : (
            <div className="rounded-card bg-surface p-4">
              <p className="m-0 text-headline font-semibold">How did it turn out?</p>
              <button type="button" onClick={() => fileRef.current?.click()} className="press mt-3 flex h-[120px] w-full items-center justify-center overflow-hidden rounded-[18px] bg-surface text-body font-medium text-ink-soft">
                {photo?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.url} alt="Your dish" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex items-center gap-2">
                    <Icon name="camera" size={20} />
                    {busy ? "Preparing photo…" : "Add a photo of your plate"}
                  </span>
                )}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} placeholder={`A line for ${cookName}`} className="mt-3 h-12 w-full rounded-full bg-surface px-5 text-body outline-none focus:ring-2 focus:ring-marigold" />
              <div className="mt-3 flex gap-2">
                <Button
                  className="flex-[1.4]"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await postJson("/api/kitchen", { action: "attempt", recipeId: recipe.id, photoRef: photo?.ref ?? null, note: note.trim() });
                    setBusy(false);
                    setOpen(false);
                    setNote("");
                    setPhoto(null);
                    onChange();
                  }}
                >
                  Show {cookName}
                </Button>
                <Button variant="secondary" className="flex-1 !bg-surface" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

