const CONSENT_KEY = "aangan:voice-consent";
const sessionConsent = new Set<string>();

export function hasVoiceConsent(memberId: string): boolean {
  if (sessionConsent.has(memberId)) return true;
  try { return localStorage.getItem(`${CONSENT_KEY}:${memberId}`) === "1"; }
  catch { return false; }
}

export function grantVoiceConsent(memberId: string): void {
  sessionConsent.add(memberId);
  try { localStorage.setItem(`${CONSENT_KEY}:${memberId}`, "1"); }
  catch { /* Keep consent in this session when storage is unavailable. */ }
}
