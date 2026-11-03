"use client";

import { useRef, useState } from "react";
import { Avatar, Icon, Photo } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { type SupportedLang } from "@/lib/i18n";
import { LANGUAGES, language } from "@/lib/languages";
import { processHomeImage } from "@/lib/media-client";
import { HOME_PHOTO_RULE, homePhotoWarning } from "@/lib/home-photo-shape";
import { resolveMediaUrl } from "@/lib/media-session";
import { liveFetch, saveLamp, saveLanguage, saveNudges, saveProfile, saveWhere, type LampDraft, type NudgeDraft, type ProfileDraft, type WhereDraft } from "@/lib/settings-save";
import { useJson } from "@/lib/use-json";
import { useLargeText } from "@/lib/use-large-text";
import { useDocumentLang, useT } from "@/lib/use-t";
import { ensureCatalogue, hasUiCatalogue, translate } from "@/lib/ui-strings/lazy";
import { ZONES, placeFromTz } from "@/lib/zones";
import { cn } from "@/lib/utils";
import { CityAssist } from "@/components/city-assist";
import { useCityAutofill } from "@/lib/use-city-autofill";
import { Group, SettingsSection } from "./section";
import { useDraft } from "./use-draft";
import { BirthYearField } from "@/components/birth-year";
import { parseBirthday } from "@/lib/birthday";

// The "You" and "Privacy" preferences. Every control here edits a draft; the
// section's Save is the only thing that writes (lib/settings-save.ts).

const MAX_PHOTO = 5 * 1024 * 1024;

/** Name and portrait. */
export function ProfileSection({ onMessage }: { onMessage: (m: string) => void }) {
  const { viewer, refreshMembers } = useViewer();
  const birth = parseBirthday(viewer.birthday);
  const form = useDraft<ProfileDraft>(
    { firstName: viewer.firstName, photoRef: viewer.photoRef ?? null, birthMonth: birth ? String(birth.month).padStart(2, "0") : "", birthDay: birth ? String(birth.day).padStart(2, "0") : "", birthYear: birth?.year ? String(birth.year) : "" },
    { id: "profile" },
  );
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File) => {
    setPickError(null);
    if (file.size > MAX_PHOTO) return setPickError("That photo is over 5 MB. Try a smaller one.");
    setBusy(true);
    try {
      const { mediaRef } = await processHomeImage(file);
      form.set({ photoRef: mediaRef });
    } catch {
      setPickError("That photo couldn't be read. Try another.");
    }
    setBusy(false);
  };
  const src = resolveMediaUrl(form.draft.photoRef) ?? resolveMediaUrl(viewer.homeImageRef);
  return (
    <SettingsSection
      id="profile"
      title="Your profile"
      tab="you"
      form={form}
      onSave={async (d, s) => {
        const r = await saveProfile(liveFetch, d, s);
        if (r.ok) {
          await refreshMembers();
          onMessage("Saved");
        }
        return r;
      }}
    >
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className="press relative h-16 w-16 shrink-0 rounded-full" aria-label="Change your photo">
          <Avatar src={src} name={form.draft.firstName || viewer.firstName} size={64} ring />
          <span className="absolute -bottom-0.5 -right-0.5 grid h-7 w-7 place-items-center rounded-full bg-accent text-accent-ink">
            <Icon name="camera" size={14} />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <label className="block">
            <span className="sr-only">Your first name</span>
            <input
              value={form.draft.firstName}
              onChange={(e) => form.set({ firstName: e.target.value })}
              maxLength={40}
              className="h-11 w-full rounded-full bg-surface px-4 text-title font-bold outline-none focus:ring-2 focus:ring-marigold"
            />
          </label>
          <p className="m-0 mt-1 text-callout text-ink-soft">The family calls you {viewer.displayName}</p>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Your photo"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void pick(f);
          }}
        />
      </div>
      <div className="mt-4" data-ui="settings-birthday">
        <p className="m-0 mb-1.5 text-footnote font-medium text-ink-soft">Your birthday (optional)</p>
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2">
          <select aria-label="Birthday month" value={form.draft.birthMonth} onChange={(e) => form.set({ birthMonth: e.target.value })} className="h-12 w-full appearance-none rounded-full bg-surface px-4 text-body outline-none focus:ring-2 focus:ring-marigold">
            <option value="">Month</option>
            {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => (
              <option key={m} value={String(i + 1).padStart(2, "0")}>
                {m}
              </option>
            ))}
          </select>
          <select aria-label="Birthday day" value={form.draft.birthDay} onChange={(e) => form.set({ birthDay: e.target.value })} className="h-12 w-full appearance-none rounded-full bg-surface px-4 text-body outline-none focus:ring-2 focus:ring-marigold">
            <option value="">Day</option>
            {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => (
              <option key={d} value={d}>
                {Number(d)}
              </option>
            ))}
          </select>
          <BirthYearField value={form.draft.birthYear} onChange={(v) => form.set({ birthYear: v })} className="!bg-surface !px-4" />
        </div>
        <p className="m-0 mt-1.5 text-footnote text-ink-soft">The year is optional. With it, Nearer can show your age.</p>
      </div>
      {busy && <p className="m-0 mt-2 text-footnote text-ink-soft">Adding your photo…</p>}
      {pickError && (
        <p role="alert" className="m-0 mt-2 text-footnote text-[#c2343a]">
          {pickError}
        </p>
      )}
    </SettingsSection>
  );
}

/** Searchable picker: dozens of languages would be a wall of radio buttons. */
function LanguagePicker({ value, onPick }: { value: SupportedLang; onPick: (code: SupportedLang) => void }) {
  const t = useT();
  useDocumentLang();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = language(value);
  const query = q.trim().toLowerCase();
  const list = LANGUAGES.filter((l) => !query || l.name.toLowerCase().includes(query) || l.native.toLowerCase().includes(query) || l.code.includes(query));
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="press flex min-h-[44px] w-full items-center justify-between rounded-[20px] bg-surface px-4 py-3.5 text-start">
        <span>
          <span className="block text-headline font-semibold">{current.native}</span>
          <span className="block text-callout text-ink-soft">{current.name}</span>
        </span>
        <span className="text-body font-medium text-ink-soft">{open ? t("settings.done") : t("settings.change")}</span>
      </button>
      {open && (
        <div className="mt-2 rounded-[20px] bg-surface p-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("settings.search")}
            aria-label={t("settings.search")}
            className="h-11 w-full rounded-full bg-white px-4 text-body outline-none focus:ring-2 focus:ring-marigold"
          />
          <ul role="radiogroup" aria-label={t("settings.language")} className="m-0 mt-2 max-h-[320px] list-none overflow-y-auto p-0">
            {list.map((l) => (
              <li key={l.code}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={l.code === value}
                  onClick={() => {
                    onPick(l.code);
                    setOpen(false);
                    setQ("");
                  }}
                  className={cn("press flex h-12 w-full items-center justify-between rounded-[14px] px-3 text-start", l.code === value && "bg-accent text-accent-ink")}
                >
                  <span className="text-body font-medium" dir={"rtl" in l && l.rtl ? "rtl" : undefined}>
                    {l.native}
                  </span>
                  <span className={cn("flex items-center gap-1.5 text-footnote", l.code === value ? "text-white/70" : "text-ink-soft")}>
                    {hasUiCatalogue(l.code) && <Icon name="check" size={13} />}
                    {l.name}
                  </span>
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="px-3 py-3 text-body text-ink-soft">{t("settings.noMatch")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Settings → Language. Choosing one previews nothing: the app keeps its words
 * until Save, then loads the catalogue and switches.
 */
export function LanguageSection({ onMessage }: { onMessage: (m: string) => void }) {
  const t = useT();
  const { viewer, displayLang, refreshMembers } = useViewer();
  const form = useDraft<{ lang: SupportedLang }>({ lang: displayLang }, { id: "language" });
  return (
    <SettingsSection
      id="language"
      title={t("settings.language")}
      tab="you"
      form={form}
      onSave={async (d) => {
        await ensureCatalogue(d.lang);
        const r = await saveLanguage(liveFetch, d, viewer.id);
        if (r.ok) {
          await refreshMembers();
          onMessage(translate(d.lang, "settings.languageUpdated"));
        }
        return r;
      }}
    >
      <LanguagePicker value={form.draft.lang} onPick={(lang) => form.set({ lang })} />
      <p className="m-0 mt-2 text-footnote text-ink-faint">{t("settings.languageNote")}</p>
      <p className="m-0 mt-1.5 flex items-center gap-1.5 text-footnote text-ink-faint">
        <Icon name="check" size={13} />
        {t("settings.appSpeaks")}
      </p>
    </SettingsSection>
  );
}

/** Larger text. Kept on this device only (no server), applied on Save. */
export function ReadingSection({ onMessage }: { onMessage: (m: string) => void }) {
  const { viewer } = useViewer();
  const [large, setLarge] = useLargeText(viewer.role === "elder");
  const form = useDraft<{ large: boolean }>({ large }, { id: "reading" });
  return (
    <SettingsSection
      id="reading"
      title="Reading"
      tab="you"
      form={form}
      onSave={async (d) => {
        setLarge(d.large);
        onMessage("Saved");
        return { ok: true };
      }}
    >
      <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-[20px] bg-surface px-4 py-3.5">
        <span>
          <span className="block text-headline font-semibold">Larger text</span>
          <span className="block text-callout text-ink-soft">Bigger words and buttons, easier on the eyes</span>
        </span>
        <input type="checkbox" className="h-6 w-6 shrink-0 accent-black" checked={form.draft.large} onChange={(e) => form.set({ large: e.target.checked })} />
      </label>
    </SettingsSection>
  );
}

const NUDGE_CHOICES: [string, number][] = [["None", 0], ["Some", 2], ["All", 3]];
const nudgeLevel = (n: number): number => (n === 0 ? 0 : n >= 3 ? 3 : 2);

function NudgeForm({ initial, hasEmail, reload, onMessage }: { initial: NudgeDraft; hasEmail: boolean; reload: () => Promise<void>; onMessage: (m: string) => void }) {
  const form = useDraft<NudgeDraft>(initial, { id: "nudges" });
  const d = form.draft;
  return (
    <SettingsSection
      id="nudges"
      title="Mail and nudges"
      tab="you"
      form={form}
      onSave={async (draft) => {
        const r = await saveNudges(liveFetch, draft);
        if (r.ok) {
          await reload();
          onMessage("Saved");
        }
        return r;
      }}
    >
      <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-[22px] bg-surface px-4 py-4">
        <span>
          <span className="block text-body font-medium">Mail me a weekly letter</span>
          <span className="block text-footnote text-ink-soft">{!hasEmail ? "Add an email to sign in first, then this can reach you." : "One morning email, at 8 where you are."}</span>
        </span>
        <input type="checkbox" className="h-6 w-6 shrink-0 accent-black" checked={d.email} onChange={(e) => form.set({ email: e.target.checked })} />
      </label>
      <div className="mt-3 rounded-[22px] bg-surface px-4 py-4">
        <span className="block text-body font-medium">Nudges</span>
        <span className="block text-footnote text-ink-soft">Small notes like &ldquo;Maa heard your voice memory&rdquo;. Never more than three a week.</span>
        <div role="group" aria-label="Nudges" className="mt-3 grid grid-cols-3 gap-1 rounded-full bg-tint p-1">
          {NUDGE_CHOICES.map(([label, n]) => (
            <button key={label} type="button" aria-pressed={d.maxPerWeek === n} onClick={() => form.set({ maxPerWeek: n })} className={cn("press h-11 rounded-full text-body font-semibold", d.maxPerWeek === n ? "bg-white text-ink shadow-sm" : "text-ink-soft")}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </SettingsSection>
  );
}

/** Mail and nudges: one letter a week, and as few small notes as you like. Only you can see or change these. */
export function NudgeSettingsSection({ onMessage }: { onMessage: (m: string) => void }) {
  const { data, failed, reload } = useJson<{ settings: { email: boolean; maxPerWeek: number }; hasEmail: boolean }>("/api/nudges/settings");
  if (failed || !data)
    return <Group title="Mail and nudges">{failed ? <LoadFailed title="Mail and nudges" retry={reload} /> : <Loading title="Mail and nudges" />}</Group>;
  return <NudgeForm initial={{ email: data.settings.email, maxPerWeek: nudgeLevel(data.settings.maxPerWeek) }} hasEmail={data.hasEmail} reload={reload} onMessage={onMessage} />;
}

/** Time zone, city and the home photo the other side sees. */
export function WhereSection({ onMessage }: { onMessage: (m: string) => void }) {
  const { viewer, refreshMembers } = useViewer();
  const form = useDraft<WhereDraft>({ tz: viewer.tz, city: viewer.city ?? "", home: null }, { id: "where" });
  const [shapeWarning, setShapeWarning] = useState<string | null>(null);
  const t = useT();
  const cityAuto = useCityAutofill(form.draft.city, (c) => form.set({ city: c }), t.lang);
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File) => {
    setPickError(null);
    if (file.size > MAX_PHOTO) return setPickError("That photo is over 5 MB. Try a smaller one.");
    setBusy(true);
    try {
      // The photo's own size, before it is shrunk: warn if it is tall or small (still allowed).
      const bmp = await createImageBitmap(file).catch(() => null);
      setShapeWarning(bmp ? homePhotoWarning(bmp.width, bmp.height) : null);
      bmp?.close();
      const { mediaRef, palette } = await processHomeImage(file);
      form.set({ home: { mediaRef, palette } });
    } catch {
      setPickError("That photo couldn't be read. Try another.");
    }
    setBusy(false);
  };
  const home = resolveMediaUrl(form.draft.home?.mediaRef) ?? resolveMediaUrl(viewer.homeImageRef);
  return (
    <SettingsSection
      id="where"
      title="Where you are"
      tab="you"
      form={form}
      onSave={async (d, s) => {
        const r = await saveWhere(liveFetch, d, s, viewer.id);
        await refreshMembers();
        if (r.ok) onMessage("Saved");
        return r;
      }}
    >
      <label className="block">
        <span className="mb-1.5 block text-footnote font-medium text-ink-soft">Time zone, so family sees your local time</span>
        <select
          value={form.draft.tz}
          onChange={(e) => form.set({ tz: e.target.value })}
          className="h-12 w-full appearance-none rounded-full bg-surface px-5 text-body outline-none focus:ring-2 focus:ring-marigold"
        >
          {Array.from(new Set([viewer.tz, form.draft.tz, ...ZONES.map((z) => z.tz)])).map((z) => (
            <option key={z} value={z}>
              {placeFromTz(z)}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-footnote font-medium text-ink-soft">Your city, so the other home sees your sky and weather</span>
        <input
          value={form.draft.city}
          onChange={(e) => {
            cityAuto.typed();
            form.set({ city: e.target.value });
          }}
          placeholder="Bengaluru"
          maxLength={60}
          className="h-12 w-full rounded-full bg-surface px-5 text-body outline-none focus:ring-2 focus:ring-marigold"
        />
      </label>
      <CityAssist source={cityAuto.source} locating={cityAuto.locating} failed={cityAuto.failed} onUseLocation={cityAuto.useMyLocation} />
      <div className="relative mt-4 h-[160px] overflow-hidden rounded-card bg-surface">
        {home ? (
          <Photo src={home} alt="Your home photo" sizes="440px" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/brand/mark.svg" alt="" width={48} height={48} className="absolute left-1/2 top-8 h-12 w-12 -translate-x-1/2 opacity-60" />
        )}
        <div className="glass absolute inset-x-2.5 bottom-2.5 flex items-center justify-between rounded-[18px] py-1.5 pl-4 pr-1.5">
          <span className="text-body font-semibold">{form.draft.home ? "A new photo, not saved yet" : "The home you miss"}</span>
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="press h-11 rounded-full bg-white px-4 text-callout font-semibold text-black">
            {busy ? "Adding…" : "Change"}
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Your home photo"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void pick(f);
          }}
        />
      </div>
      <p data-ui="home-photo-rule" className="m-0 mt-2 text-footnote text-ink-soft">
        {HOME_PHOTO_RULE}
      </p>
      {shapeWarning && (
        <p role="status" className="m-0 mt-1 text-footnote font-medium text-ink">
          {shapeWarning}
        </p>
      )}
      {pickError && (
        <p role="alert" className="m-0 mt-2 text-footnote text-[#c2343a]">
          {pickError}
        </p>
      )}
    </SettingsSection>
  );
}

function LampForm({ initial, reload, onMessage }: { initial: LampDraft; reload: () => Promise<void>; onMessage: (m: string) => void }) {
  const form = useDraft<LampDraft>(initial, { id: "lamp" });
  return (
    <SettingsSection
      id="lamp"
      title="Your lamp"
      tab="privacy"
      hideTitle
      form={form}
      onSave={async (d) => {
        const r = await saveLamp(liveFetch, d);
        if (r.ok) {
          await reload();
          onMessage(d.shareVisits ? "Your lamp shows to family again." : "Your lamp and activity are private now.");
        }
        return r;
      }}
    >
      <label className="mt-4 flex min-h-[44px] items-center justify-between gap-3 rounded-[22px] bg-surface px-4 py-4">
        <span>
          <span className="block text-body font-medium">Show my lamp and activity to family</span>
          <span className="block text-footnote text-ink-soft">When it&rsquo;s off, nobody sees when you were last in Nearer.</span>
        </span>
        <input type="checkbox" className="h-6 w-6 shrink-0 accent-black" checked={form.draft.shareVisits} onChange={(e) => form.set({ shareVisits: e.target.checked })} />
      </label>
    </SettingsSection>
  );
}

/**
 * Privacy (SPEC §30.2): the lamp-glow ring and "active 2 h ago" in Kutumb,
 * and the status on the window. Stored as care_settings.shareVisits; the
 * other care settings are kept as they are.
 */
export function LampSection({ onMessage }: { onMessage: (m: string) => void }) {
  const { viewer } = useViewer();
  const { data, failed, reload } = useJson<{ settings: ({ memberId: string } & LampDraft)[] }>("/api/presence");
  if (failed) return <LoadFailed title="Your lamp" retry={reload} />;
  if (!data) return <Loading title="Your lamp" />;
  const mine = data.settings.find((s) => s.memberId === viewer.id);
  const initial: LampDraft = { quietAlert: mine?.quietAlert ?? false, tellMemberId: mine?.tellMemberId ?? null, graceHours: mine?.graceHours ?? 3, shareVisits: mine?.shareVisits ?? true };
  return <LampForm initial={initial} reload={reload} onMessage={onMessage} />;
}

function Loading({ title }: { title: string }) {
  return <div className="skeleton h-[96px] rounded-card" aria-busy="true" aria-label={`Loading ${title}`} />;
}

function LoadFailed({ title, retry }: { title: string; retry: () => Promise<void> }) {
  return (
    <div role="alert" className="rounded-[22px] bg-surface px-4 py-4 text-callout text-ink-soft">
      Couldn&rsquo;t load {title}.
      <button type="button" onClick={() => void retry()} className="press ml-2 h-11 rounded-full bg-white px-4 text-callout font-semibold text-ink">
        Retry
      </button>
    </div>
  );
}
