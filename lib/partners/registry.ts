// The curated partner registry (data/partners.json + data/gift-stores.json),
// validated once at load. Named partners only; nothing here is a listing by
// an unknown seller (SPEC §9).
import { z } from "zod";
import { isSampleMode } from "../config";
import partnersRaw from "../../data/partners.json";
import storesRaw from "../../data/gift-stores.json";

export const PartnerKindSchema = z.enum(["groceries", "food", "dining", "gifts", "home-services"]);
export const TransportSchema = z.enum(["mcp-oauth", "mcp-public", "link"]);

const ToolSpecSchema = z.object({ name: z.string().min(1), args: z.record(z.unknown()).default({}) });
export type ToolSpec = z.infer<typeof ToolSpecSchema>;

const SampleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(140),
  price: z.number().int().nonnegative(),
  currency: z.string().length(3),
  url: z.string().url().optional(),
  image: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
});
export type SampleItem = z.infer<typeof SampleSchema>;

const QueriesSchema = z.object({ occasion: z.array(z.string()).default([]), need: z.array(z.string()).default([]) });

const AccountSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  discovery: z.string().url(),
  scope: z.string(),
  clientIdEnv: z.string(),
  envFlag: z.string(),
  note: z.string().default(""),
});
export type PartnerAccount = z.infer<typeof AccountSchema>;

const PartnerSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  account: z.string().nullable(),
  kind: PartnerKindSchema,
  transport: TransportSchema,
  envFlag: z.string(),
  defaultOn: z.boolean().default(false),
  countries: z.array(z.string().length(2)),
  url: z.string().url().optional(),
  urlEnv: z.string().optional(),
  sendable: z.boolean(),
  eta: z.string().optional(),
  verified: z.boolean(),
  tools: z
    .object({
      addresses: ToolSpecSchema.optional(),
      search: ToolSpecSchema,
      clearCart: ToolSpecSchema.optional(),
      addToCart: ToolSpecSchema,
      cart: ToolSpecSchema,
      checkout: ToolSpecSchema,
    })
    .optional(),
  queries: QueriesSchema,
  samples: z.array(SampleSchema),
});
export type Partner = z.infer<typeof PartnerSchema>;

const StoreSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  domain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
  countries: z.array(z.string().length(2)),
  queries: QueriesSchema,
  samples: z.array(SampleSchema),
});
export type GiftStore = z.infer<typeof StoreSchema>;

const RegistrySchema = z.object({ accounts: z.array(AccountSchema), partners: z.array(PartnerSchema) });
const StoresSchema = z.object({ checkedAt: z.string(), stores: z.array(StoreSchema) });

const REGISTRY = RegistrySchema.parse(partnersRaw);
const STORES = StoresSchema.parse(storesRaw);

export const ACCOUNTS: readonly PartnerAccount[] = REGISTRY.accounts;
export const PARTNERS: readonly Partner[] = REGISTRY.partners;
export const GIFT_STORES: readonly GiftStore[] = STORES.stores;

export function getPartner(id: string): Partner | undefined {
  return PARTNERS.find((p) => p.id === id);
}

export function getAccount(id: string): PartnerAccount | undefined {
  return ACCOUNTS.find((a) => a.id === id);
}

export function getStore(id: string): GiftStore | undefined {
  return GIFT_STORES.find((s) => s.id === id);
}

/** Live only when its env flag says so (or it is on by default and the flag is unset). Mock mode enables all. */
export function isEnabled(p: Pick<Partner, "envFlag" | "defaultOn">, env: NodeJS.ProcessEnv = process.env): boolean {
  if (isSampleMode()) return true;
  const flag = env[p.envFlag];
  if (flag === undefined || flag === "") return p.defaultOn;
  return flag === "true";
}

/** The MCP server URL: env override first, then the published default. */
export function serverUrl(p: Partner, env: NodeJS.ProcessEnv = process.env): string | null {
  const override = p.urlEnv ? env[p.urlEnv] : undefined;
  if (override && /^https?:\/\//.test(override)) return override;
  return p.url ?? null;
}

export function partnersForCountry(country: string): Partner[] {
  return PARTNERS.filter((p) => p.countries.includes(country) && isEnabled(p));
}

export function storesForCountry(country: string): GiftStore[] {
  return GIFT_STORES.filter((s) => s.countries.includes(country));
}

export function storeMcpUrl(store: GiftStore): string {
  return `https://${store.domain}/api/ucp/mcp`;
}
