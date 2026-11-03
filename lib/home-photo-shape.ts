// The family page's header shows the middle of a wide band. Say what makes a good home photo,
// and warn (gently, never block) when a chosen one is portrait or small. Client-safe.
export const HOME_PHOTO_MIN_W = 1600;
export const HOME_PHOTO_MIN_H = 900;
export const HOME_PHOTO_RULE = "Use a wide (landscape) photo, at least 1600 × 900. The middle is what shows.";

/** A gentle warning for a photo this shape, or null when it is fine. */
export function homePhotoWarning(width: number, height: number): string | null {
  if (!(width > 0) || !(height > 0)) return null;
  if (height > width) return "This photo is tall, so only a thin slice of the middle will show. A wide photo works best.";
  if (width < HOME_PHOTO_MIN_W || height < HOME_PHOTO_MIN_H) return "This photo is smaller than 1600 × 900, so it may look soft. You can still use it.";
  return null;
}
