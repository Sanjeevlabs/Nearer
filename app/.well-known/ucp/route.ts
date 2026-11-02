import profile from "@/data/ucp-agent-profile.json";

// Nearer's agent profile for Shopify's Universal Commerce Protocol (UCP): the stores we
// search fetch this URL (sent as meta.ucp-agent.profile) to learn what the agent supports.
// Static, public, no secrets. It lists the shopping capabilities only; Nearer searches the
// catalogue and hands the buyer to the store's own checkout, it never completes one.
export function GET(): Response {
  return Response.json(profile, { headers: { "cache-control": "public, max-age=3600" } });
}
