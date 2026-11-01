import { resolveMediaUrl } from "./media-session";
import { ageOnDay, todayIn } from "./birthday";
import type { Card, Member } from "./schemas";

/** What the viewer calls this person. displayName is the family's own word (Dadi, Dad, Maa). */
export function callName(member: Member | undefined | null): string {
  if (!member) return "Family";
  return member.displayName || member.firstName || "Family";
}

/** Whole years old, or null when the birth year is unknown. The day is the member's own (their zone). */
export function ageOf(member: { birthday?: string; tz?: string } | undefined | null, now: Date = new Date()): number | null {
  if (!member?.birthday) return null;
  return ageOnDay(member.birthday, todayIn(member.tz, now));
}

export function memberPhoto(member: Member | undefined | null): string | null {
  if (!member) return null;
  return resolveMediaUrl(member.photoRef) ?? resolveMediaUrl(member.homeImageRef);
}

const FALLBACK_COVER = "/demo/family-group.webp";

/** Album art for any card: its own photo, its chosen cover, then the author's portrait. */
export function cardCover(card: Card, members: Member[]): string {
  if (card.type === "photo") {
    const own = resolveMediaUrl(card.mediaRef);
    if (own) return own;
  }
  const cover = resolveMediaUrl(card.coverRef);
  if (cover) return cover;
  const author = members.find((m) => m.id === card.authorId);
  return memberPhoto(author) ?? FALLBACK_COVER;
}

/** A soft, photo-tinted shadow so cards sit on white with depth from their own colour. */
export function tintShadow(card: Pick<Card, "palette"> | null, strength = 0.5): string {
  const base = card?.palette?.[0] ?? "#6b4a3a";
  const hex = base.replace("#", "");
  const n = parseInt(hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `0 24px 48px -20px rgba(${r},${g},${b},${strength})`;
}

/** Everyone except the viewer, ordered by who spoke most recently. */
export function peopleByRecency(viewerId: string, members: Member[], cards: Card[]): Member[] {
  const last = new Map<string, number>();
  for (const c of cards) {
    if (!c.authorId) continue;
    const t = new Date(c.takenAt).getTime();
    if (t > (last.get(c.authorId) ?? 0)) last.set(c.authorId, t);
  }
  return members
    .filter((m) => m.id !== viewerId)
    .sort((a, b) => (last.get(b.id) ?? 0) - (last.get(a.id) ?? 0));
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function cardDuration(card: Card): number {
  return Math.max(4, card.segments.reduce((m, s) => Math.max(m, s.end), 0));
}

export function relativeDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.floor((now.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  const part = d.getHours() < 12 ? "morning" : d.getHours() < 17 ? "afternoon" : "evening";
  if (days <= 0) return `this ${part}`;
  if (days === 1) return part === "evening" ? "last night" : `yesterday ${part}`;
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: days > 300 ? "numeric" : undefined });
}
