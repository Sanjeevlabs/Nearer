// Limits for what's written on a printed photo. Shared by the schema and the add sheet (zod-free for client bundles).
export const CARD_PLACE_MAX = 60;
export const CARD_NOTE_MAX = 140;
/** Who a voice note is addressed to: member ids, comma-joined. Room for any family (about 50 ids), not a handful. */
export const ADDRESSED_TO_MAX = 2048;
