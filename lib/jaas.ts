// Jitsi as a Service (8x8 JaaS): rooms that do not wait for a signed-in moderator.
// Tokens are RS256 JWTs signed with WebCrypto (Workers have no Node crypto).
// The private key is read from the environment only and never logged.

export const JAAS_DOMAIN = "8x8.vc";

export type JaasConfig = { appId: string; kid: string; privateKey: string };

export function jaasConfig(): JaasConfig | null {
  const appId = process.env.JAAS_APP_ID?.trim();
  const kid = process.env.JAAS_KID?.trim();
  // Secret stores often hand the PEM over on one line with literal "\n" sequences.
  const privateKey = process.env.JAAS_PRIVATE_KEY?.trim().replace(/\\n/g, "\n");
  return appId && kid && privateKey ? { appId, kid, privateKey } : null;
}

export const jaasEnabled = (): boolean => jaasConfig() !== null;

/** The room name used inside Aangan: unguessable per knock or sitting. */
export const roomName = (id: string): string => `Aangan-${id.replace(/[^a-zA-Z0-9-]/g, "")}`;

const enc = new TextEncoder();
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const part = (o: unknown) => b64url(enc.encode(JSON.stringify(o)));

let cached: { pem: string; key: CryptoKey } | null = null;
async function signingKey(pem: string): Promise<CryptoKey> {
  if (cached?.pem === pem) return cached.key;
  const body = pem.replace(/-----(BEGIN|END)[^-]*-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  cached = { pem, key };
  return key;
}

export async function mintJaasToken(input: {
  room: string;
  user: { id: string; name: string; avatar?: string; moderator: boolean };
  ttlSec?: number;
}): Promise<string> {
  const cfg = jaasConfig();
  if (!cfg) throw new Error("jaas-not-configured");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: cfg.kid };
  const payload = {
    aud: "jitsi",
    iss: "chat",
    sub: cfg.appId,
    room: input.room.startsWith(`${cfg.appId}/`) ? input.room.slice(cfg.appId.length + 1) : input.room,
    exp: now + (input.ttlSec ?? 2 * 3600),
    nbf: now - 10,
    context: {
      user: { id: input.user.id, name: input.user.name, avatar: input.user.avatar ?? "", moderator: input.user.moderator ? "true" : "false", email: "" },
      features: { livestreaming: "false", recording: "false", transcription: "false", "outbound-call": "false" },
    },
  };
  const signingInput = `${part(header)}.${part(payload)}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await signingKey(cfg.privateKey), enc.encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}
