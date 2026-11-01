// Two-step ordering through the member's own partner account:
//   preview → cart, total and delivery address read back from the partner;
//   confirm → only with the single-use preview id, from the same member,
//             after an explicit tap (the route requires confirm: true).
// Muse never reaches this module. Payment happens in the partner's own
// flow (UPI QR / store checkout); Aangan never sees payment details.
// Server only.
import { randomBytes } from "crypto";
import { claimDoc } from "../family-docs";
import { isMockMode } from "../config";
import { NeedsConnect, openPartner } from "./adapter";
import type { Candidate } from "./catalog";
import { pickAddress } from "./catalog";
import { parseAddresses, parseCartTotal, parseCheckout, type ParsedAddress } from "./parse";
import { getPartner, getStore } from "./registry";
import { seal, unseal } from "./seal";
import { loadToken } from "./tokens";

const PREVIEW_TTL_MS = 10 * 60_000;

export interface Preview {
  id: string;
  partnerId: string;
  via: string;
  item: { name: string; quantity: number; price: number; image?: string };
  total: number;
  currency: string;
  /** Delivery address from the member's partner account; null when the store's checkout asks for it. */
  address: ParsedAddress | null;
  addresses: ParsedAddress[];
  eta: string | null;
  handoff: boolean;
  sample: boolean;
}

export type ConfirmResult =
  | { status: "placed"; eta: string | null; orderId: string | null; sample: boolean }
  | { status: "awaiting-payment"; paymentUrl: string | null; qr: string | null; orderId: string | null }
  | { status: "handoff"; url: string };

interface Pending {
  preview: Omit<Preview, "id">;
  candidate: Candidate;
  f: string;
  m: string;
  n: string;
  exp: number;
}

// The preview id is the sealed preview itself (AES-GCM, bound to the member,
// 10 minutes): nothing to look up, and it can't be edited client-side.
// Confirmed ids are remembered (family_docs "preview_used", claimed with an
// insert that fails on a repeat) so one preview places one order even when two
// taps reach two different Workers.
const PREVIEW_PURPOSE = "partner-preview";
/** Test hook, kept for callers: spent ids live in family_docs now (resetDocs clears the mock copy). */
export function resetOrders(): void {}

function sampleAddresses(recipientCity: string, ownCity: string): ParsedAddress[] {
  const list: ParsedAddress[] = [];
  if (recipientCity) list.push({ id: "sample-addr-1", label: "Parents' home", line: recipientCity });
  if (ownCity && ownCity !== recipientCity) list.push({ id: "sample-addr-2", label: "Home", line: ownCity });
  if (list.length === 0) list.push({ id: "sample-addr-1", label: "Home", line: "Saved address" });
  return list;
}

/** Shopify cart permalink: the store's own checkout with this variant in the cart. */
export function shopifyCartUrl(domain: string, variantGid: string, quantity = 1): string | null {
  const m = /ProductVariant\/(\d+)$/.exec(variantGid);
  return m ? `https://${domain}/cart/${m[1]}:${quantity}` : null;
}

export async function createPreview(input: {
  familyId: string;
  memberId: string;
  candidate: Candidate;
  recipientCity: string;
  ownCity: string;
  addressId?: string;
}): Promise<Preview> {
  const { candidate: c } = input;
  const partner = getPartner(c.partnerId);
  if (!partner || !partner.sendable) throw new Error("unknown-partner");
  if (partner.transport === "mcp-oauth" && partner.account && !(await loadToken(input.familyId, input.memberId, partner.account))) throw new NeedsConnect(partner.account);

  const base = { partnerId: c.partnerId, via: c.via, item: { name: c.name, quantity: 1, price: c.price, image: c.image }, currency: c.currency };
  let preview: Omit<Preview, "id">;

  if (partner.transport === "mcp-public") {
    // Gift stores: the price as the store listed it; the address is entered at the store's checkout.
    preview = { ...base, total: c.price, address: null, addresses: [], eta: null, handoff: true, sample: c.sample };
  } else if (isMockMode() || c.sample) {
    const addresses = sampleAddresses(input.recipientCity, input.ownCity);
    const address = pickAddress(addresses, input.recipientCity, input.addressId) ?? addresses[0];
    preview = { ...base, total: c.price, address, addresses, eta: partner.eta ?? null, handoff: false, sample: true };
  } else {
    const s = await openPartner(input.familyId, input.memberId, partner);
    const addresses = parseAddresses(await s.call(partner.tools?.addresses));
    const address = pickAddress(addresses, input.recipientCity, input.addressId);
    if (!address) throw new Error("no-address");
    await s.call(partner.tools?.clearCart);
    await s.call(partner.tools?.addToCart, { itemId: c.itemId, quantity: 1, addressId: address.id });
    const total = parseCartTotal(await s.call(partner.tools?.cart, { addressId: address.id }));
    if (total === null) throw new Error("no-total");
    preview = { ...base, total, address, addresses, eta: partner.eta ?? null, handoff: false, sample: false };
  }

  const sealed: Pending = { preview, candidate: c, f: input.familyId, m: input.memberId, n: randomBytes(9).toString("base64url"), exp: Date.now() + PREVIEW_TTL_MS };
  const id = seal(PREVIEW_PURPOSE, sealed);
  if (!id) throw new Error("server-misconfigured");
  return { ...preview, id };
}

/** Place the previewed order. Single-use; only the member who previewed it. */
export async function confirmPreview(input: { familyId: string; memberId: string; previewId: string }): Promise<ConfirmResult> {
  const p = unseal(PREVIEW_PURPOSE, input.previewId) as Pending | null;
  const now = Date.now();
  if (!p || typeof p.n !== "string" || p.exp < now || p.f !== input.familyId || p.m !== input.memberId) throw new Error("preview-not-found");
  // Single use, across Workers: only the request that inserts the spent marker goes on.
  if (!(await claimDoc(input.familyId, "preview_used", { id: `preview-${p.n}`.slice(0, 120), memberId: input.memberId, at: new Date(now).toISOString() }))) throw new Error("preview-not-found");
  const partner = getPartner(p.preview.partnerId);
  if (!partner) throw new Error("unknown-partner");

  if (partner.transport === "mcp-public") {
    const store = p.candidate.storeId ? getStore(p.candidate.storeId) : undefined;
    const url = store ? shopifyCartUrl(store.domain, p.candidate.itemId) : null;
    if (!url) throw new Error("no-handoff");
    return { status: "handoff", url };
  }
  if (partner.transport === "mcp-oauth" && partner.account && !(await loadToken(input.familyId, input.memberId, partner.account))) throw new NeedsConnect(partner.account);
  if (p.preview.sample) return { status: "placed", eta: p.preview.eta, orderId: null, sample: true };

  const s = await openPartner(input.familyId, input.memberId, partner);
  // checkout is not idempotent (Swiggy): one attempt, never retried here.
  const out = parseCheckout(await s.call(partner.tools?.checkout, { addressId: p.preview.address?.id }));
  if (out.paymentUrl || out.qr) return { status: "awaiting-payment", paymentUrl: out.paymentUrl, qr: out.qr, orderId: out.orderId };
  return { status: "placed", eta: p.preview.eta, orderId: out.orderId, sample: false };
}
