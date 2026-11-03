import { requireSession } from "@/lib/auth";
import { clearFlowCookie, exchangeCode, readFlow } from "@/lib/partners/oauth";
import { getAccount } from "@/lib/partners/registry";
import { saveToken } from "@/lib/partners/tokens";
import { guardApi } from "@/lib/api-guard";

// OAuth redirect URI (/connect/{partner}): the partner sends the member back
// here with ?code&state. The flow cookie must match the state and the same
// signed-in member; the token is stored server-side, never sent on.
export const dynamic = "force-dynamic";

async function getHandler(req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const acct = /^[a-z0-9-]{1,32}$/.test(params.id) ? getAccount(params.id) : undefined;
  const finish = (status: "ok" | "error" | "denied") =>
    new Response(null, { status: 302, headers: { location: new URL(`/connect/${acct?.id ?? "partner"}/done?status=${status}`, req.url).toString(), "set-cookie": clearFlowCookie(), "cache-control": "no-store" } });
  if (!acct) return finish("error");
  const auth = await requireSession(req);
  if (auth instanceof Response) return finish("error");
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return finish("denied");
  const code = url.searchParams.get("code");
  const flow = readFlow(req, acct.id, url.searchParams.get("state"));
  if (!code || code.length > 2048 || !flow || flow.memberId !== auth.memberId || flow.familyId !== auth.familyId) return finish("error");
  try {
    const tokens = await exchangeCode(acct, flow, code);
    if (!(await saveToken(auth.familyId, auth.memberId, acct.id, tokens))) return finish("error");
    return finish("ok");
  } catch (err) {
    console.error("[partners] token exchange failed", acct.id, err instanceof Error ? err.message : "error");
    return finish("error");
  }
}

export const GET = guardApi(getHandler);
