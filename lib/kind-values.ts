// Plain value lists for the living rooms. No zod here, so client screens
// can import them without pulling the validator into the browser bundle.

export const PRESENCE_MOMENTS = ["awake", "chai", "walk", "cooking", "prayer", "garden", "market", "resting", "visitors", "thinking", "here", "work", "school", "commute", "home", "cooked-yours"] as const;
export const NEED_KINDS = ["groceries", "house", "ride", "repair", "gas", "bills", "health", "errand", "visit", "pets", "other"] as const;
/** Ticket lifecycle. "claimed" = assigned to a family member (kept for old rows). */
export const NEED_STATUSES = ["open", "claimed", "progress", "done", "cancelled"] as const;
export const PRIORITIES = ["normal", "soon", "urgent"] as const;
export const RECURRENCE = ["none", "weekly", "monthly"] as const;
export const COURSES = ["breakfast", "main", "side", "snack", "sweet", "drink", "other"] as const;
export const STORY_THEMES = ["animals", "legends", "our-village", "family", "funny", "lesson", "lullaby", "other"] as const;
export const STORY_AGES = ["all", "under-5", "5-8", "9-12"] as const;
/** One game, the one every generation already knows (SPEC §28). */
export const GAME_KINDS = ["ludo"] as const;
export const PROJECT_KINDS = ["play", "make", "learn", "celebrate", "visit"] as const;
/** What a photo is of, as Muse sees it (drives automatic albums). */
export const EVENT_KINDS = ["wedding", "ritual", "festival", "birthday", "gathering", "trip", "food", "nature", "school", "everyday"] as const;
export const PLACE_KINDS = ["home", "temple", "market", "school", "park", "tea-stall", "hospital", "station", "friend", "other"] as const;
export const SAFETY_KINDS = ["home-safe", "heading", "journey", "out-late", "help"] as const;
export const PET_SPECIES = ["dog", "cat", "bird", "fish", "rabbit", "other"] as const;
export const HELPER_ROLES = ["groceries", "house help", "driver", "cook", "gas booking", "repairs", "plumber", "electrician", "neighbour", "caregiver", "doctor's clinic", "pet care", "friend", "warden", "landlord", "colleague", "relative nearby", "other"] as const;
export const SITTING_REASONS = ["chai", "cook", "story", "festival", "birthday", "music", "just-sit"] as const;
/** Where a sitting happens: the virtual place the family sits (lib/venues.ts has the photos and seats). */
export const VENUE_IDS = ["courtyard", "terrace", "pergola", "deck", "lounge", "patio"] as const;
export type VenueId = (typeof VENUE_IDS)[number];

/** "How to listen" (an optional wish on a voice note sent to someone): only its addressees ever see it. */
export const LISTEN_WAYS = ["just-listen", "help-me-think", "keep-me-company"] as const;
