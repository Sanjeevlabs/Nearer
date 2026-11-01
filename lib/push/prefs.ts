// Per person: which kinds of push they want, and today's tally. One family_docs row
// (kind push_settings, id = member id). With no row, everything is on. Server only.
import { getDoc, putDoc } from "../family-docs";
import type { PushSettings } from "../kinds";
import { DEFAULT_PREFS, type PushPrefs } from "./policy";

export const PREF_KEYS = ["voice", "lamp", "asks", "digest", "safety"] as const satisfies readonly (keyof PushPrefs)[];

export function defaultSettings(memberId: string): PushSettings {
  return { id: memberId, ...DEFAULT_PREFS, day: "", sent: 0, overflow: 0 };
}

export async function getPushSettings(familyId: string, memberId: string): Promise<PushSettings> {
  return (await getDoc(familyId, "push_settings", memberId)) ?? defaultSettings(memberId);
}

/** Change the switches; the counters stay as they are. */
export async function savePushPrefs(familyId: string, memberId: string, prefs: PushPrefs): Promise<PushSettings> {
  const cur = await getPushSettings(familyId, memberId);
  return putDoc(familyId, "push_settings", { ...cur, ...prefs });
}

/** Write the tally back (after a push is counted or held). */
export async function saveTally(familyId: string, cur: PushSettings, tally: Pick<PushSettings, "day" | "sent" | "overflow">): Promise<PushSettings> {
  return putDoc(familyId, "push_settings", { ...cur, ...tally });
}
