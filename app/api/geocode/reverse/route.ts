import { z } from "zod";
import { htmlLang } from "@/lib/ui-strings/lang";
import { reverseGeocode } from "@/lib/location";
import { allowAuthAttempt, callerKey } from "@/lib/otp";
import { guardApi } from "@/lib/api-guard";

// "Use my location": coordinates in, a city name out. Public (the details step
// comes before any session) but limited per address and, inside the lib, to one
// OpenStreetMap call a second. Coordinates are never logged or stored.
const HEADERS = { "cache-control": "private, no-store" };
const Query = z.object({ lat: z.string().min(1).pipe(z.coerce.number().min(-90).max(90)), lng: z.string().min(1).pipe(z.coerce.number().min(-180).max(180)) });

async function getHandler(req: Request): Promise<Response> {
  const ip = callerKey(req);
  if (ip && !allowAuthAttempt(`geocode:${ip}`, 10)) return Response.json({ error: "rate-limited" }, { status: 429, headers: HEADERS });
  const q = new URL(req.url).searchParams;
  const parsed = Query.safeParse({ lat: q.get("lat") ?? "", lng: q.get("lng") ?? "" });
  if (!parsed.success) return Response.json({ error: "bad-coordinates" }, { status: 400, headers: HEADERS });
  if (process.env.MOCK === "true") return Response.json({ error: "unavailable" }, { status: 503, headers: HEADERS });
  const found = await reverseGeocode(parsed.data.lat, parsed.data.lng, htmlLang(q.get("lang")));
  if (!found) return Response.json({ error: "unavailable" }, { status: 503, headers: HEADERS });
  return Response.json(found, { headers: HEADERS });
}

export const GET = guardApi(getHandler);
