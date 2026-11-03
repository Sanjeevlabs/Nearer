// May this member have this stored file? A file that is the media of a note for particular
// people is theirs and its author's only (lib/card-privacy.ts); for anyone else it does not
// exist. Both byte doors use it: GET /api/media/<path> (signed URLs) and the mock byte server.
// Server only.
import { dbCardsWithMedia } from "./db";
import { canSeeCard } from "./card-privacy";

export async function mediaAllowed(familyId: string, memberId: string, path: string): Promise<boolean> {
  const owners = await dbCardsWithMedia(familyId, `storage:${path}`);
  return owners.length === 0 || owners.some((c) => canSeeCard(c, memberId));
}
