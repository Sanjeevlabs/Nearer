import { afterEach, describe, expect, it, vi } from "vitest";
import { money } from "@/components/send-sheet";
import { isSampleMode } from "@/lib/config";
import { connectedGroups } from "@/lib/connected-apps";
import { searchCandidates, UCP_PROFILE } from "@/lib/partners/catalog";
import { isEnabled, PARTNERS, partnersForCountry, storesForCountry } from "@/lib/partners/registry";
import { MemberSchema, type Member, type Relationship } from "@/lib/schemas";
import { appsFor, countryForTz, sendCountry, SEND_APPS, SendAppsSchema } from "@/lib/send-apps";
import raw from "@/data/send-apps.json";

const m = (id: string, role: Member["role"], tz: string): Member => MemberSchema.parse({ id, familyId: "f", firstName: id, displayName: id, role, tz });
const rel = (memberId: string, relationMemberId: string, canonicalKind: Relationship["canonicalKind"]): Relationship => ({ id: `${memberId}-${relationMemberId}`, familyId: "f", memberId, relationMemberId, relation: canonicalKind, canonicalKind });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Send something: one country for the links and Muse's ideas", () => {
  it("is the recipient's own country from their zone; an unknown zone is generic, never India", () => {
    expect(sendCountry("Europe/London")).toBe("GB");
    expect(sendCountry("America/Toronto")).toBe("CA");
    expect(sendCountry("Asia/Kolkata")).toBe("IN");
    expect(sendCountry("Europe/Berlin")).toBe("DE");
    expect(sendCountry("Pacific/Fiji")).toBe("*");
    expect(sendCountry(undefined)).toBe("*");
    expect(countryForTz("Australia/Sydney")).toBe("AU");
  });

  it("has link-out lists for CA, AU, AE, SG, DE besides IN, US, GB; still one app per category, https, no tracking", () => {
    expect(SendAppsSchema.safeParse(raw).success).toBe(true);
    for (const c of ["IN", "US", "GB", "CA", "AU", "AE", "SG", "DE"]) expect(appsFor(c).country).toBe(c);
    for (const c of ["CA", "AU", "AE", "SG", "DE"]) expect(appsFor(c).categories.length).toBeGreaterThanOrEqual(4);
    expect(Object.values(SEND_APPS.countries).flatMap((c) => Object.values(c.apps).flat()).every((a) => a.url.startsWith("https://") && !/[?#]/.test(a.url))).toBe(true);
  });

  it("Muse's ideas exist only where a partner or store serves the country", () => {
    expect(storesForCountry("GB").map((s) => s.id)).toContain("biscuiteers");
    expect(storesForCountry("US").map((s) => s.id)).toEqual(expect.arrayContaining(["urbanstems", "milk-bar"]));
    expect(storesForCountry("IN").some((s) => s.id === "anand-sweets")).toBe(false);
    for (const c of ["*", "DE", "SG"]) expect(storesForCountry(c).length + partnersForCountry(c).filter((p) => p.sendable).length).toBe(0);
  });
});

describe("live partner search does not depend on the Muse key", () => {
  it("MOCK unset: stores are enabled and searched for real (not sample)", async () => {
    vi.stubEnv("MOCK", "");
    expect(isSampleMode()).toBe(false);
    const shopify = PARTNERS.find((p) => p.id === "shopify-gifts");
    expect(shopify && isEnabled(shopify)).toBe(true);
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { id: number; method: string; params?: { arguments?: { meta?: { "ucp-agent"?: { profile?: string } } } } };
      calls.push(`${new URL(url).host} ${body.method} ${body.params?.arguments?.meta?.["ucp-agent"]?.profile ?? ""}`.trim());
      if (body.method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "store", version: "1" } } }), { headers: { "content-type": "application/json" } });
      if (body.id === undefined) return new Response(null, { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ products: [] }) }] } }), { headers: { "content-type": "application/json" } });
    });
    const out = await searchCandidates({ familyId: "f", memberId: "me", country: "GB", city: "London", kind: "occasion", title: "Thank you" });
    expect(out.sample).toBe(false);
    expect(calls.some((c) => c.startsWith("biscuiteers.com tools/call") && c.endsWith(UCP_PROFILE))).toBe(true);
  });

  it("MOCK=true still gives labelled samples", async () => {
    vi.stubEnv("MOCK", "true");
    const out = await searchCandidates({ familyId: "f", memberId: "me", country: "GB", city: "London", kind: "occasion", title: "Thank you" });
    expect(out.sample).toBe(true);
    expect(out.candidates.some((c) => c.via === "Biscuiteers")).toBe(true);
  });
});

describe("prices in the item's own currency", () => {
  it("formats pounds, dollars and rupees each in their own way", () => {
    expect(money(3995, "GBP")).toBe("£39.95");
    expect(money(4800, "USD")).toBe("$48");
    expect(money(99000, "INR")).toBe("₹990");
    expect(money(1250, "XXX")).toContain("12.5");
  });
});

describe("Settings → Connected apps lists everything Send something offers, by home", () => {
  const members = [m("me", "adult", "Europe/London"), m("Maa", "elder", "Asia/Kolkata"), m("Papa", "elder", "Asia/Kolkata")];
  const relationships = [rel("me", "Maa", "parent"), rel("me", "Papa", "parent")];
  const groups = connectedGroups({ members, relationships, connected: new Set(["swiggy"]), accountOn: () => true, partnerOn: (p) => p.id !== "swiggy-dineout" });

  it("a family with IN and GB homes gets both groups, labelled by home and country", () => {
    expect(groups.map((g) => g.label)).toEqual(["For Maa & Papa · India", "For me · United Kingdom"]);
  });

  it("each row has a name, what it is for and a status that matches its action", () => {
    const india = groups.find((g) => g.country === "IN")?.rows ?? [];
    const by = (name: string) => india.find((r) => r.name === name);
    expect(by("Instamart")).toMatchObject({ status: "connected", what: "Groceries", accountId: "swiggy" });
    expect(by("Zomato")).toMatchObject({ status: "connect", accountId: "zomato" });
    expect(by("Gift stores")?.status).toBe("no-account");
    expect(by("Dineout")?.status).toBe("soon");
    expect(by("Urban Company")).toMatchObject({ status: "link", url: expect.stringContaining("https://") });
    expect(india.filter((r) => r.name === "Zomato")).toHaveLength(1);
    const uk = groups.find((g) => g.country === "GB")?.rows ?? [];
    expect(uk.map((r) => r.name)).toEqual(expect.arrayContaining(["Ocado", "Boots", "Interflora"]));
    expect(uk.find((r) => r.name === "Gift stores")?.status).toBe("no-account");
    expect(uk.filter((r) => r.name !== "Gift stores").every((r) => r.status === "link" && r.url?.startsWith("https://"))).toBe(true);
    expect(uk.some((r) => r.name === "Urban Company")).toBe(false);
  });
});
