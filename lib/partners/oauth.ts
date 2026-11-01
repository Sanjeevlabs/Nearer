// OAuth 2.1 authorization code + PKCE (S256) for partner accounts (Swiggy,
// Zomato). Metadata comes from each partner's RFC 8414 discovery document;
// the client id from env, else RFC 7591 dynamic registration (public client,
// no secret). The verifier travels in a sealed, httpOnly, 10-minute cookie
// bound to the member; the state is single-use. Server only.
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import type { PartnerAccount } from "./registry";
import { seal, unseal } from "./seal";
import type { TokenSet } from "./tokens";

const TIMEOUT_MS = 8000;
export const OAUTH_COOKIE = "aangan_partner_oauth";
const FLOW_TTL_MS = 10 * 60_000;

const MetadataSchema = z.object({
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  registration_endpoint: z.string().url().optional(),
  code_challenge_methods_supported: z.array(z.string()).optional(),
});
type Metadata = z.infer<typeof MetadataSchema>;

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});

const FlowSchema = z.object({
  account: z.string(),
  familyId: z.string(),
  memberId: z.string(),
  verifier: z.string().min(43),
  state: z.string().min(16),
  redirectUri: z.string().url(),
  clientId: z.string(),
  exp: z.number(),
});
export type OAuthFlow = z.infer<typeof FlowSchema>;

const g = globalThis as typeof globalThis & { __aanganOAuth?: { meta: Map<string, Metadata>; clients: Map<string, string>; used: Set<string> } };
const shared = (g.__aanganOAuth ??= { meta: new Map(), clients: new Map(), used: new Set() });
const metaCache = shared.meta;
const clientCache = shared.clients;
const usedStates = shared.used;

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`oauth-http-${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(t);
  }
}

export async function metadata(acct: PartnerAccount): Promise<Metadata> {
  const hit = metaCache.get(acct.id);
  if (hit) return hit;
  const m = MetadataSchema.parse(await fetchJson(acct.discovery));
  if (m.code_challenge_methods_supported && !m.code_challenge_methods_supported.includes("S256")) throw new Error("oauth-no-s256");
  metaCache.set(acct.id, m);
  return m;
}

/** Env client id, else a dynamically registered public client for this redirect URI. */
export async function clientIdFor(acct: PartnerAccount, redirectUri: string): Promise<string> {
  const fromEnv = process.env[acct.clientIdEnv];
  if (fromEnv) return fromEnv;
  const cacheKey = `${acct.id}|${redirectUri}`;
  const hit = clientCache.get(cacheKey);
  if (hit) return hit;
  const m = await metadata(acct);
  if (!m.registration_endpoint) throw new Error("oauth-no-registration");
  const reg = z.object({ client_id: z.string().min(1) }).parse(
    await fetchJson(m.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Nearer",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: acct.scope,
      }),
    }),
  );
  clientCache.set(cacheKey, reg.client_id);
  return reg.client_id;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function newFlow(input: Omit<OAuthFlow, "verifier" | "state" | "exp">): { flow: OAuthFlow; challenge: string } {
  const { verifier, challenge } = pkcePair();
  return { flow: { ...input, verifier, state: randomBytes(18).toString("base64url"), exp: Date.now() + FLOW_TTL_MS }, challenge };
}

export function authorizeUrl(m: Pick<Metadata, "authorization_endpoint">, acct: PartnerAccount, flow: OAuthFlow, challenge: string): string {
  const u = new URL(m.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", flow.clientId);
  u.searchParams.set("redirect_uri", flow.redirectUri);
  u.searchParams.set("scope", acct.scope);
  u.searchParams.set("state", flow.state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export function flowCookie(flow: OAuthFlow): string | null {
  const sealed = seal("oauth-flow", flow);
  if (!sealed) return null;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${OAUTH_COOKIE}=${sealed}; Path=/connect; HttpOnly; SameSite=Lax${secure}; Max-Age=${FLOW_TTL_MS / 1000}`;
}

export function clearFlowCookie(): string {
  return `${OAUTH_COOKIE}=; Path=/connect; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Read and check the flow cookie for this callback. Single-use per state. */
export function readFlow(req: Request, account: string, state: string | null): OAuthFlow | null {
  const raw = (req.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${OAUTH_COOKIE}=`));
  if (!raw || !state) return null;
  const parsed = FlowSchema.safeParse(unseal("oauth-flow", raw.slice(OAUTH_COOKIE.length + 1)));
  if (!parsed.success) return null;
  const f = parsed.data;
  if (f.account !== account || f.state !== state || f.exp < Date.now() || usedStates.has(f.state)) return null;
  usedStates.add(f.state);
  return f;
}

function toTokenSet(raw: unknown, clientId: string, prevRefresh?: string): TokenSet {
  const t = TokenResponseSchema.parse(raw);
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? prevRefresh,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined,
    clientId,
    sample: false,
  };
}

export async function exchangeCode(acct: PartnerAccount, flow: OAuthFlow, code: string): Promise<TokenSet> {
  const m = await metadata(acct);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: flow.redirectUri,
    client_id: flow.clientId,
    code_verifier: flow.verifier,
  });
  const raw = await fetchJson(m.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  return toTokenSet(raw, flow.clientId);
}

/** Refresh tokens rotate (Swiggy): always keep the newest refresh token. */
export async function refreshTokens(acct: PartnerAccount, tokens: TokenSet): Promise<TokenSet | null> {
  if (!tokens.refreshToken || !tokens.clientId) return null;
  try {
    const m = await metadata(acct);
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refreshToken, client_id: tokens.clientId });
    const raw = await fetchJson(m.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    return toTokenSet(raw, tokens.clientId, tokens.refreshToken);
  } catch {
    return null;
  }
}

/** Where the partner sends the member back. APP_ORIGIN pins it in production. */
export function redirectUriFor(req: Request, account: string): string {
  const origin = process.env.APP_ORIGIN && /^https?:\/\//.test(process.env.APP_ORIGIN) ? process.env.APP_ORIGIN.replace(/\/$/, "") : new URL(req.url).origin;
  return `${origin}/connect/${account}`;
}
