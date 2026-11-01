import { checkRateLimit, requireSession } from "@/lib/auth";
import { dbListMembers } from "@/lib/db";
import { countryOfMember } from "@/lib/place";
import { fetchWeather, mockWeather } from "@/lib/weather";

// The sky over a family member's city. Only cities that someone in *this*
// family lives in can be looked up: this is not an open weather proxy.
export async function GET(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/weather")) return Response.json({ error: "rate-limited" }, { status: 429 });
  const memberId = new URL(req.url).searchParams.get("memberId") ?? "";
  const member = (await dbListMembers(auth.familyId)).find((m) => m.id === memberId);
  if (!member) return Response.json({ error: "unknown-member" }, { status: 404 });
  if (!member.city) return Response.json({ weather: null });
  const weather = process.env.MOCK === "true" ? mockWeather(member.city) : ((await fetchWeather(member.city, { country: countryOfMember(member), tz: member.tz })) ?? null);
  return Response.json({ weather });
}
