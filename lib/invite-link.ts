// The one link a family sends (nearer.site/join/<CODE>), the one-tap WhatsApp invite (plain
// English), and reading a pasted link back. Client and server; reuse for "send invite again".

/** Opens the family's join page: who's inviting you, then Google or your email, then in. */
export function joinLink(origin: string, code: string): string {
  return `${origin}/join/${encodeURIComponent(code)}`;
}

export function whatsappInvite(origin: string, code: string, from?: string): string {
  const text = `${from ? `${from} has` : "I've"} opened a window between our homes on Nearer. Join here: ${joinLink(origin, code)}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * The code in whatever was pasted: a full link (…/join/ABC123 or the older …/join?code=ABC123), a
 * WhatsApp message with the link in it, or the bare code. Null when there is no code-shaped thing.
 */
export function codeFromInput(text: string): string | null {
  const s = text.trim();
  if (!s) return null;
  const path = s.match(/\/join\/([A-Za-z0-9-]{4,64})/);
  if (path) return path[1].toUpperCase();
  const query = s.match(/[?&]code=([A-Za-z0-9-]{4,64})/);
  if (query) return query[1].toUpperCase();
  return /^[A-Za-z0-9-]{4,64}$/.test(s) ? s.toUpperCase() : null;
}
