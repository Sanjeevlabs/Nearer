// What each Settings section writes when the person taps Save. One function
// per section, taking the draft (and what was saved), the `fetch` to use, and
// returning a SaveResult. Nothing here runs until Save: choosing an option
// only changes the draft (lib/settings-draft.ts). The existing API routes are
// kept; a section's fields go in one request where the route accepts that,
// otherwise in a short sequence with one combined result.

import { birthdayProblem, buildBirthday } from "./birthday";
import type { SaveResult } from "./settings-draft";
import type { Member } from "./schemas";
import type { SupportedLang } from "./i18n";

type F = typeof fetch;

/** The page's fetch, looked up at call time. */
export const liveFetch: F = (input, init) => fetch(input, init);

const JSON_HEADERS = { "content-type": "application/json" };

export const SAVE_FAILED = "Couldn't save that. Try again.";

async function send(f: F, url: string, method: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await f(url, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
    if (res.ok) return { ok: true };
    const b = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: b?.error };
  } catch {
    return { ok: false };
  }
}

// ---- You: profile (name, portrait) -> PATCH /api/members/profile, one request.

export interface ProfileDraft {
  firstName: string;
  photoRef: string | null;
  /** Birthday parts as typed: month "01".."12", day "01".."31", year "" or four digits. */
  birthMonth: string;
  birthDay: string;
  birthYear: string;
}

export async function saveProfile(f: F, d: ProfileDraft, saved: ProfileDraft): Promise<SaveResult<ProfileDraft>> {
  const patch: { firstName?: string; photoRef?: string | null; birthday?: string } = {};
  if (d.birthMonth !== saved.birthMonth || d.birthDay !== saved.birthDay || d.birthYear !== saved.birthYear) {
    if (birthdayProblem(d.birthMonth, d.birthDay, d.birthYear)) return { ok: false, error: birthdayProblem(d.birthMonth, d.birthDay, d.birthYear) ?? SAVE_FAILED };
    patch.birthday = buildBirthday(d.birthMonth, d.birthDay, d.birthYear);
  }
  if (d.firstName.trim() !== saved.firstName) patch.firstName = d.firstName.trim();
  if (d.photoRef !== saved.photoRef) patch.photoRef = d.photoRef;
  if (Object.keys(patch).length === 0) return { ok: true };
  const r = await send(f, "/api/members/profile", "PATCH", patch);
  return r.ok ? { ok: true, saved: { ...d, firstName: d.firstName.trim() }, draft: { ...d, firstName: d.firstName.trim() } } : { ok: false, error: SAVE_FAILED };
}

// ---- You: language -> POST /api/members/display-lang.

export async function saveLanguage(f: F, d: { lang: SupportedLang }, memberId: string): Promise<SaveResult<{ lang: SupportedLang }>> {
  const r = await send(f, "/api/members/display-lang", "POST", { memberId, displayLang: d.lang });
  return r.ok ? { ok: true } : { ok: false, error: SAVE_FAILED };
}

// ---- You: mail and nudges -> PUT /api/nudges/settings, one request.

export interface NudgeDraft {
  email: boolean;
  maxPerWeek: number;
}

export async function saveNudges(f: F, d: NudgeDraft): Promise<SaveResult<NudgeDraft>> {
  const r = await send(f, "/api/nudges/settings", "PUT", { email: d.email, maxPerWeek: d.maxPerWeek });
  return r.ok ? { ok: true } : { ok: false, error: SAVE_FAILED };
}

// ---- You: where you are -> PATCH /api/members/profile (zone, city), then
// POST /api/members/home-image when a new home photo was picked.

export interface WhereDraft {
  tz: string;
  city: string;
  home: { mediaRef: string; palette: string[] } | null;
}

export async function saveWhere(f: F, d: WhereDraft, saved: WhereDraft, memberId: string): Promise<SaveResult<WhereDraft>> {
  const city = d.city.trim();
  const patch: { tz?: string; city?: string } = {};
  if (d.tz !== saved.tz) patch.tz = d.tz;
  if (city !== saved.city) patch.city = city;
  let now: WhereDraft = saved;
  if (Object.keys(patch).length > 0) {
    const r = await send(f, "/api/members/profile", "PATCH", patch);
    if (!r.ok) return { ok: false, error: SAVE_FAILED };
    now = { ...now, tz: d.tz, city };
  }
  if (d.home) {
    const r = await send(f, "/api/members/home-image", "POST", { memberId, mediaRef: d.home.mediaRef, palette: d.home.palette });
    if (!r.ok) return { ok: false, error: SAVE_FAILED, saved: now, draft: { ...d, tz: now.tz, city: now.city } };
  }
  // The new photo is the member's own now; the draft holds no pending photo.
  const next: WhereDraft = { tz: d.tz, city, home: null };
  return { ok: true, saved: next, draft: next };
}

// ---- Window: your first screen -> POST /api/window per changed field.

export interface WindowDraft {
  photo: string | null;
  people: string[];
  quietAfterHours: number;
  /** The drawn scene's open space (absent: unchanged, the window). */
  scene?: "window" | "balcony" | "courtyard";
}

export const sameWindow = (a: WindowDraft, b: WindowDraft): boolean =>
  (a.scene ?? "window") === (b.scene ?? "window") &&
  a.photo === b.photo && a.quietAfterHours === b.quietAfterHours && [...a.people].sort().join() === [...b.people].sort().join();

export async function saveWindow(f: F, d: WindowDraft, saved: WindowDraft): Promise<SaveResult<WindowDraft>> {
  let now = saved;
  const step = async (changed: boolean, body: unknown, apply: (w: WindowDraft) => WindowDraft): Promise<boolean> => {
    if (!changed) return true;
    const r = await send(f, "/api/window", "POST", body);
    if (r.ok) now = apply(now);
    return r.ok;
  };
  const ok =
    (await step((d.scene ?? "window") !== (saved.scene ?? "window"), { action: "scene", scene: d.scene ?? "window" }, (w) => ({ ...w, scene: d.scene }))) &&
    (await step(d.photo !== saved.photo, { action: "homePhoto", ref: d.photo }, (w) => ({ ...w, photo: d.photo }))) &&
    (await step([...d.people].sort().join() !== [...saved.people].sort().join(), { action: "people", people: d.people }, (w) => ({ ...w, people: d.people }))) &&
    (await step(d.quietAfterHours !== saved.quietAfterHours, { action: "quiet", hours: d.quietAfterHours }, (w) => ({ ...w, quietAfterHours: d.quietAfterHours })));
  return ok ? { ok: true } : { ok: false, error: SAVE_FAILED, saved: now };
}

// ---- People: roles -> PATCH /api/members/:id per changed person. The draft is
// only the changes: person id -> the role chosen. Becoming the owner is a
// handover (an action with its own confirm), never part of this.

export type RoleDraft = Record<string, Member["access"]>;

export const ROLE_ERROR: Record<string, string> = {
  "admins-full": "A family can have up to 3 admins, the owner included.",
  "needs-parent": "Only their parent can make this a teen account.",
  "has-account": "They have their own account, so they can't be a child profile.",
  "owner-use-transfer": "Hand the family over to change the owner's role.",
  "needs-account": "They need their own account before they can own the family.",
  "family-full": "A family can have up to 50 people.",
  "grown-ups-only": "Only a grown-up can own the family.",
};

export async function saveRoles(f: F, d: RoleDraft): Promise<SaveResult<RoleDraft>> {
  const left: RoleDraft = { ...d };
  let error: string | null = null;
  for (const [id, access] of Object.entries(d)) {
    const r = await send(f, `/api/members/${encodeURIComponent(id)}`, "PATCH", { access });
    if (r.ok) delete left[id];
    else error = ROLE_ERROR[r.error ?? ""] ?? "Couldn't change that. Try again.";
  }
  return error ? { ok: false, error, saved: {}, draft: left } : { ok: true, saved: {}, draft: {} };
}

// ---- Privacy: lamp and activity -> PUT /api/presence with the whole care
// settings row (the other fields are kept as they are), one request.

export interface LampDraft {
  quietAlert: boolean;
  tellMemberId: string | null;
  graceHours: number;
  shareVisits: boolean;
}

export async function saveLamp(f: F, d: LampDraft): Promise<SaveResult<LampDraft>> {
  const r = await send(f, "/api/presence", "PUT", { quietAlert: d.quietAlert, tellMemberId: d.tellMemberId, graceHours: d.graceHours, shareVisits: d.shareVisits });
  return r.ok ? { ok: true } : { ok: false, error: SAVE_FAILED };
}
