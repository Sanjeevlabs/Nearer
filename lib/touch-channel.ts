// Two touches meet (an experiment). Server side: the private channel name for one pair of
// people, HMAC-SHA256(SESSION_SECRET, familyId + the two ids sorted), so nobody outside the
// pair can guess it. Nothing is stored and no message is ever sent on it: the client only
// joins its Presence while a finger is on the lamp. Server only.
import { createHmac } from "crypto";

export function touchChannel(familyId: string, a: string, b: string, secret: string | undefined = process.env.SESSION_SECRET): string | null {
  if (!secret || a === b) return null;
  const pair = [a, b].sort().join(":");
  return `touch:${createHmac("sha256", secret).update(`${familyId}:${pair}`).digest("hex").slice(0, 40)}`;
}
