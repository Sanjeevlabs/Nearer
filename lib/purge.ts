// The daily purge: ephemeral rows that have outlived their purpose go. Run by
// the ritual scan for each family (idempotent: a second run finds nothing).
// Every list the app shows already hides an expired row at read time; this
// keeps the table from growing and the 500-row list window from filling up
// with dead rows. Server only.
import { dbListSuggestions, dbSetSuggestionStatus } from "./db";
import { purgeDismissals } from "./gather-store";
import { deleteDoc, listAllDocs, putDoc } from "./family-docs";
import { BEAT_TTL_MS } from "./lamp";
import { OPEN_TTL_MS, expireCheckin } from "./safety";

const DAY = 86_400_000;

/** How long each kind of row lives. One place, so the docs and the tests read the same numbers. */
export const TTL = {
  /** A delivered (or never delivered) nudge is kept this long. */
  nudgeMs: 30 * DAY,
  /** A planned sitting is kept this long after it started (the app hides it after 3 h). */
  sittingMs: 7 * DAY,
  /** A closed check-in is kept this long. */
  checkinMs: 30 * DAY,
  /** Muse call log. */
  museCallMs: 90 * DAY,
  /** Shared moments and app-open heartbeats: the rhythm looks back 15 days. */
  presenceMs: 15 * DAY,
  /** A suggestion nobody answered is withdrawn after this long. */
  suggestionMs: 21 * DAY,
  /** A used one-time order preview id is remembered this long (a preview lives 10 minutes). */
  previewMs: DAY,
} as const;

export interface PurgeCounts {
  knocks: number;
  nudges: number;
  eventDismissals: number;
  dayLines: number;
  sittings: number;
  checkinsClosed: number;
  checkinsDeleted: number;
  museCalls: number;
  presence: number;
  lampBeats: number;
  suggestionsWithdrawn: number;
  previews: number;
}

export async function purgeExpired(familyId: string, now: Date = new Date()): Promise<PurgeCounts> {
  const t = now.getTime();
  const out: PurgeCounts = { knocks: 0, nudges: 0, eventDismissals: 0, dayLines: 0, sittings: 0, checkinsClosed: 0, checkinsDeleted: 0, museCalls: 0, presence: 0, lampBeats: 0, suggestionsWithdrawn: 0, previews: 0 };
  // One kind failing never stops the rest.
  const step = async (name: string, f: () => Promise<void>) => {
    try {
      await f();
    } catch (e) {
      console.error("[purge]", name, familyId, String(e));
    }
  };

  await step("knocks", async () => {
    for (const k of await listAllDocs(familyId, "knock")) if (Date.parse(k.until) <= t) (await deleteDoc(familyId, "knock", k.id), out.knocks++);
  });
  await step("nudges", async () => {
    for (const n of await listAllDocs(familyId, "nudge")) {
      const since = Date.parse(n.deliveredAt ?? n.at);
      if (t - since > TTL.nudgeMs) (await deleteDoc(familyId, "nudge", n.id), out.nudges++);
    }
  });
  await step("event_dismiss", async () => {
    out.eventDismissals = await purgeDismissals(familyId, now.toISOString().slice(0, 10), now);
  });
  await step("day_line", async () => {
    for (const l of await listAllDocs(familyId, "day_line")) if (Date.parse(l.until) <= t) (await deleteDoc(familyId, "day_line", l.id), out.dayLines++);
  });
  await step("sitting", async () => {
    for (const s of await listAllDocs(familyId, "sitting")) if (t - Date.parse(s.startsAt) > TTL.sittingMs) (await deleteDoc(familyId, "sitting", s.id), out.sittings++);
  });
  await step("safety_checkin", async () => {
    for (const c of await listAllDocs(familyId, "safety_checkin")) {
      if (!c.closedAt && t - Date.parse(c.at) >= OPEN_TTL_MS) {
        await putDoc(familyId, "safety_checkin", expireCheckin(c, t));
        out.checkinsClosed++;
      } else if (c.closedAt && t - Date.parse(c.closedAt) > TTL.checkinMs) {
        await deleteDoc(familyId, "safety_checkin", c.id);
        out.checkinsDeleted++;
      }
    }
  });
  await step("muse_call", async () => {
    for (const m of await listAllDocs(familyId, "muse_call")) if (t - Date.parse(m.at) > TTL.museCallMs) (await deleteDoc(familyId, "muse_call", m.id), out.museCalls++);
  });
  await step("presence", async () => {
    for (const p of await listAllDocs(familyId, "presence")) if (t - Date.parse(p.at) > TTL.presenceMs) (await deleteDoc(familyId, "presence", p.id), out.presence++);
  });
  await step("lamp", async () => {
    for (const l of await listAllDocs(familyId, "lamp")) {
      const beats = l.beats.filter((b) => t - Date.parse(b.at) < BEAT_TTL_MS);
      if (beats.length !== l.beats.length) {
        await putDoc(familyId, "lamp", { ...l, beats });
        out.lampBeats += l.beats.length - beats.length;
      }
    }
  });
  await step("preview_used", async () => {
    for (const u of await listAllDocs(familyId, "preview_used")) if (t - Date.parse(u.at) > TTL.previewMs) (await deleteDoc(familyId, "preview_used", u.id), out.previews++);
  });
  await step("suggestions", async () => {
    for (const s of await dbListSuggestions("pending", familyId)) {
      if (t - Date.parse(s.createdAt) > TTL.suggestionMs) {
        await dbSetSuggestionStatus(s.id, "rejected", familyId);
        out.suggestionsWithdrawn++;
      }
    }
  });
  return out;
}
