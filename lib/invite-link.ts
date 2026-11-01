// The join link a family sends, and the one-tap WhatsApp invite (plain
// English). Client and server; reuse for "send invite again".

/** Opens /join with the code filled in. */
export function joinLink(origin: string, code: string): string {
  return `${origin}/join?code=${encodeURIComponent(code)}`;
}

export function whatsappInvite(origin: string, code: string, from?: string): string {
  const text = `${from ? `${from} has` : "I've"} opened a window between our homes on Nearer. Join here: ${joinLink(origin, code)} (your code: ${code})`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
