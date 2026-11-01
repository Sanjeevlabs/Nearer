import { requireSession, sessionFromRequest } from "@/lib/auth";
import { adoptMemo, memberFor } from "@/lib/request-memo";
import { CHILD_KINDS, ELDER_KINDS, prefetchDocs, preloadCourtyard } from "@/lib/request-data";
import { guardWrites } from "@/lib/api-guard";
import { GET as getCare } from "../care/route";
import { GET as getEvents } from "../gather/events/route";
import { GET as getGifts } from "../gifts/route";
import { GET as getBedtime } from "../bedtime/route";
import { GET as getHabits } from "../habits/route";
import { GET as getHeight } from "../height/route";
import { GET as getKidAsk } from "../kid-ask/route";
import { GET as getKeeper } from "../keeper/route";
import { GET as getLetters } from "../letters/route";
import { GET as getPresence } from "../presence/route";
import { GET as getSafety } from "../safety/route";
import { GET as getFestivalWeek } from "../festival-week/route";
import { GET as getSides } from "../sides/route";
import { GET as getSit } from "../sit/route";
import { GET as getStories } from "../stories/route";
import { GET as getSuggestions } from "../suggestions/route";
import { GET as getToday } from "../today/route";
import { GET as getTogether } from "../together/route";

// One request for everything the courtyard reads on first paint. It runs the
// same GET handlers the individual routes serve (same auth, same per-viewer
// filtering, same rate limits) in parallel and returns each payload under the
// key the client maps from the route's URL (lib/courtyard-data.tsx). A slice
// that fails is left out, and its hook falls back to its own fetch.
//
// GET → { sides, safety, events, today, suggestions, letters, presence,
//         together, sit, festivalWeek, habits, kidAsk, bedtime, height, [gifts, keeper, care] for elders, [stories] for children }

type Handler = (req: Request) => Promise<Response>;

async function slice(req: Request, path: string, handler: Handler): Promise<unknown> {
  try {
    const sub = new Request(new URL(path, req.url), { headers: req.headers });
    // The sub-handler's requireSession finds the member already loaded for this request.
    adoptMemo(req, sub);
    const res = await handler(sub);
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

async function getHandler(req: Request): Promise<Response> {
  // Everything the slices share (members, cards, calendar settings, the common
  // document kinds) starts now, in the same wave as the auth lookup; the slices
  // then find it already read (lib/request-data.ts).
  const claimed = sessionFromRequest(req);
  if (claimed) preloadCourtyard(req, claimed.familyId);
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const me = await memberFor(req, auth.memberId);
  // The role's own kinds, in one query, before the slices that read them.
  if (me?.role === "elder") prefetchDocs(req, auth.familyId, ELDER_KINDS);
  if (me?.role === "child") prefetchDocs(req, auth.familyId, CHILD_KINDS);
  const parts: [string, string, Handler][] = [
    ["sides", "/api/sides", getSides],
    ["safety", "/api/safety", getSafety],
    ["events", "/api/gather/events", getEvents],
    ["today", "/api/today", getToday],
    ["suggestions", "/api/suggestions?status=pending", getSuggestions],
    ["letters", "/api/letters", getLetters],
    ["presence", "/api/presence", getPresence],
    ["together", "/api/together", getTogether],
    ["sit", "/api/sit", getSit],
    ["festivalWeek", "/api/festival-week", getFestivalWeek],
    ["habits", "/api/habits", getHabits],
    ["kidAsk", "/api/kid-ask", getKidAsk],
    ["bedtime", "/api/bedtime", getBedtime],
    ["height", "/api/height", getHeight],
  ];
  if (me?.role === "elder") parts.push(["gifts", "/api/gifts", getGifts], ["keeper", "/api/keeper", getKeeper], ["care", "/api/care", getCare]);
  if (me?.role === "child") parts.push(["stories", "/api/stories", getStories]);
  const done = await Promise.all(parts.map(async ([key, path, handler]) => [key, await slice(req, path, handler)] as const));
  const out: Record<string, unknown> = {};
  for (const [key, value] of done) if (value !== undefined) out[key] = value;
  return Response.json(out, { headers: { "cache-control": "no-store" } });
}

export const GET = guardWrites(getHandler);
