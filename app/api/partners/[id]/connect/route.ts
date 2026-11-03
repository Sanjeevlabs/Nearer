import { requireSession } from "@/lib/auth";
import { isSampleMode } from "@/lib/config";
import { authorizeUrl, clientIdFor, flowCookie, metadata, newFlow, redirectUriFor } from "@/lib/partners/oauth";
import { getAccount, isEnabled } from "@/lib/partners/registry";
import { deleteToken, saveToken } from "@/lib/partners/tokens";
import { guardApi } from "@/lib/api-guard";

// GET    → start connecting the member's own partner account (OAuth + PKCE): 302 to the partner.
// DELETE → disconnect: forget the member's token for that partner.
// MOCK mode connects a sample account at once so the demo runs with no network.

const done = (req: Request, id: string, status: "ok" | "error") => new URL(`/connect/${id}/done?status=${status}`, req.url).toString();

function account(id: string) {
  const a = /^[a-z0-9-]{1,32}$/.test(id) ? getAccount(id) : undefined;
  return a && isEnabled({ envFlag: a.envFlag, defaultOn: false }) ? a : undefined;
}

async function getHandler(req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const acct = account(params.id);
  if (!acct) return Response.json({ error: "unknown-partner" }, { status: 404 });
  if (isSampleMode()) {
    await saveToken(auth.familyId, auth.memberId, acct.id, { accessToken: "sample", sample: true });
    return Response.redirect(done(req, acct.id, "ok"), 302);
  }
  try {
    const redirectUri = redirectUriFor(req, acct.id);
    const [m, clientId] = await Promise.all([metadata(acct), clientIdFor(acct, redirectUri)]);
    const { flow, challenge } = newFlow({ account: acct.id, familyId: auth.familyId, memberId: auth.memberId, redirectUri, clientId });
    const cookie = flowCookie(flow);
    if (!cookie) return Response.json({ error: "server-misconfigured" }, { status: 500 });
    return new Response(null, { status: 302, headers: { location: authorizeUrl(m, acct, flow, challenge), "set-cookie": cookie, "cache-control": "no-store" } });
  } catch (err) {
    console.error("[partners] connect failed", acct.id, err instanceof Error ? err.message : "error");
    return Response.redirect(done(req, acct.id, "error"), 302);
  }
}

async function deleteHandler(req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const acct = /^[a-z0-9-]{1,32}$/.test(params.id) ? getAccount(params.id) : undefined;
  if (!acct) return Response.json({ error: "unknown-partner" }, { status: 404 });
  await deleteToken(auth.familyId, auth.memberId, acct.id);
  return Response.json({ ok: true, connected: false });
}

export const GET = guardApi(getHandler);
export const DELETE = guardApi(deleteHandler);
