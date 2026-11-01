import { createHash } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as partnersGet } from "@/app/api/partners/route";
import { DELETE as disconnect, GET as connect } from "@/app/api/partners/[id]/connect/route";
import { POST as suggestPost } from "@/app/api/partners/suggest/route";
import { POST as orderPost } from "@/app/api/partners/order/route";
import { GET as callback } from "@/app/connect/[id]/route";
import { fillArgs } from "@/lib/partners/adapter";
import { isBlockedText } from "@/lib/partners/catalog";
import { McpClient, McpError, parseSse } from "@/lib/partners/mcp-client";
import { authorizeUrl, flowCookie, newFlow, pkcePair, readFlow } from "@/lib/partners/oauth";
import { shopifyCartUrl, resetOrders } from "@/lib/partners/orders";
import { parseCartTotal, parseUcpProducts } from "@/lib/partners/parse";
import { GIFT_STORES, PARTNERS, getAccount, storeMcpUrl } from "@/lib/partners/registry";
import { defaultPicks } from "@/lib/partners/suggest";
import { loadToken, memoryTokenStore, resetTokens, saveToken, setTokenStore } from "@/lib/partners/tokens";
import { sessionCookie } from "./auth-helper";

const post = (url: string, member: string, body: unknown) =>
  new Request(`http://test${url}`, { method: "POST", headers: { "content-type": "application/json", cookie: sessionCookie(member) }, body: JSON.stringify(body) });
const get = (url: string, member: string, extraCookie = "") => new Request(`http://test${url}`, { headers: { cookie: [sessionCookie(member), extraCookie].filter(Boolean).join("; ") } });
const json = async <T = Record<string, unknown>>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

type S = { id: string; partnerId: string; via: string; kind: string; name: string; price: number; sample: boolean };

beforeEach(() => {
  resetTokens();
  resetOrders();
});

describe("mcp client (Streamable HTTP)", () => {
  function fakeServer(opts: { sse?: boolean; status?: number; hang?: boolean } = {}) {
    const seen: { method: string; headers: Record<string, string> }[] = [];
    const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id?: number; method: string };
      seen.push({ method: body.method, headers: init?.headers as Record<string, string> });
      if (opts.hang)
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      if (opts.status) return new Response("{}", { status: opts.status });
      if (body.id === undefined) return new Response(null, { status: 202 });
      const result =
        body.method === "initialize"
          ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake" } }
          : body.method === "tools/list"
            ? { tools: [{ name: "search_products" }] }
            : { content: [{ type: "text", text: JSON.stringify({ products: [{ name: "Kaju katli", variants: [{ spinId: "s1", price: 549 }] }] }) }] };
      const msg = JSON.stringify({ jsonrpc: "2.0", id: body.id, result });
      return opts.sse
        ? new Response(`event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: ${msg}\n\n`, { headers: { "content-type": "text/event-stream", "mcp-session-id": "sess-1" } })
        : new Response(msg, { headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } });
    }) as typeof fetch;
    return { impl, seen };
  }

  it("initializes, lists tools and calls one (JSON), carrying the session id and token", async () => {
    const { impl, seen } = fakeServer();
    const c = new McpClient("https://mcp.example/im", { token: "tok", fetchImpl: impl });
    expect((await c.listTools()).map((t) => t.name)).toEqual(["search_products"]);
    const r = await c.callTool("search_products", { query: "sweets" });
    expect(r.content[0].text).toContain("Kaju");
    expect(seen.map((s) => s.method)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    expect(seen[2].headers["mcp-session-id"]).toBe("sess-1");
    expect(seen[2].headers["mcp-protocol-version"]).toBe("2025-06-18");
    expect(seen[0].headers.authorization).toBe("Bearer tok");
  });

  it("reads an SSE reply and skips other events", async () => {
    const { impl } = fakeServer({ sse: true });
    const c = new McpClient("https://mcp.example/im", { fetchImpl: impl });
    expect((await c.listTools())[0].name).toBe("search_products");
    expect(parseSse("data: a\n\ndata: b\ndata: c\n\n")).toEqual(["a", "b\nc"]);
  });

  it("maps 401 to unauthorized and times out", async () => {
    await expect(new McpClient("https://x", { fetchImpl: fakeServer({ status: 401 }).impl }).listTools()).rejects.toMatchObject({ code: "unauthorized" });
    const slow = new McpClient("https://x", { fetchImpl: fakeServer({ hang: true }).impl, timeoutMs: 30 });
    await expect(slow.listTools()).rejects.toBeInstanceOf(McpError);
    await expect(new McpClient("https://x", { fetchImpl: fakeServer({ hang: true }).impl, timeoutMs: 30 }).listTools()).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("registry, parsing and helpers", () => {
  it("loads the curated partners and verified Shopify gift stores", () => {
    expect(PARTNERS.map((p) => p.id)).toEqual(expect.arrayContaining(["swiggy-instamart", "zomato", "shopify-gifts", "urban-company"]));
    expect(GIFT_STORES.length).toBeGreaterThan(0);
    expect(storeMcpUrl(GIFT_STORES[0])).toMatch(/^https:\/\/[a-z.]+\/api\/ucp\/mcp$/);
    expect(getAccount("swiggy")?.discovery).toBe("https://mcp.swiggy.com/.well-known/oauth-authorization-server");
  });

  it("fills tool argument templates, keeping types", () => {
    expect(fillArgs({ items: [{ spinId: "$itemId", quantity: "$quantity" }], addressId: "$addressId" }, { itemId: "s1", quantity: 1 })).toEqual({ items: [{ spinId: "s1", quantity: 1 }] });
  });

  it("parses UCP products in minor units and builds a cart permalink", () => {
    const items = parseUcpProducts({ products: [{ title: "Hamper", url: "https://s.example/p", media: [{ type: "image", url: "https://cdn.example/a.jpg" }], variants: [{ id: "gid://shopify/ProductVariant/123", price: { amount: 99000, currency: "INR" }, availability: { available: true } }] }] });
    expect(items).toEqual([{ itemId: "gid://shopify/ProductVariant/123", name: "Hamper", price: 99000, currency: "INR", image: "https://cdn.example/a.jpg", url: "https://s.example/p", available: true }]);
    expect(shopifyCartUrl("s.example", "gid://shopify/ProductVariant/123")).toBe("https://s.example/cart/123:1");
    expect(parseCartTotal({ data: { bill: { toPay: 599 } } })).toBe(59900);
    expect(parseCartTotal({ data: {} })).toBeNull();
  });

  it("blocks medical, alcohol and tobacco words without catching food", () => {
    expect(isBlockedText("BP tablets")).toBe(true);
    expect(isBlockedText("Vitamin D supplement")).toBe(true);
    expect(isBlockedText("Ginger tea, rumali roti")).toBe(false);
  });

  it("default picks mix two everyday items with one gift", () => {
    const c = (id: string, kind: "groceries" | "gifts") => ({ id, kind }) as Parameters<typeof defaultPicks>[0][number];
    expect(defaultPicks([c("g1", "gifts"), c("a", "groceries"), c("b", "groceries"), c("c", "groceries")]).map((x) => x.id)).toEqual(["a", "b", "g1"]);
  });
});

describe("tokens and OAuth", () => {
  it("seals tokens at rest and only returns them to their own member", async () => {
    const store = memoryTokenStore();
    setTokenStore(store);
    await saveToken("demo-family", "arjun", "swiggy", { accessToken: "secret-access", refreshToken: "secret-refresh", sample: false });
    const rows = await store.list("demo-family");
    expect(JSON.stringify(rows)).not.toContain("secret-");
    expect((await loadToken("demo-family", "arjun", "swiggy"))?.accessToken).toBe("secret-access");
    expect(await loadToken("demo-family", "leo", "swiggy")).toBeNull();
  });

  it("builds a PKCE S256 authorize URL and accepts the flow once, for the matching state", () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    const acct = getAccount("swiggy")!;
    const { flow, challenge: ch } = newFlow({ account: "swiggy", familyId: "demo-family", memberId: "arjun", redirectUri: "http://localhost:3000/connect/swiggy", clientId: "cid" });
    const u = new URL(authorizeUrl({ authorization_endpoint: "https://mcp.swiggy.com/auth/authorize" }, acct, flow, ch));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: "code", client_id: "cid", code_challenge_method: "S256", state: flow.state, redirect_uri: "http://localhost:3000/connect/swiggy" });
    const cookie = flowCookie(flow)!.split(";")[0];
    const req = new Request("http://test/connect/swiggy", { headers: { cookie } });
    expect(readFlow(req, "swiggy", "wrong-state-xxxxxxxx")).toBeNull();
    expect(readFlow(req, "swiggy", flow.state)?.verifier).toBe(flow.verifier);
    expect(readFlow(req, "swiggy", flow.state)).toBeNull();
  });

  it("the callback refuses a missing or forged flow", async () => {
    const res = await callback(get("/connect/swiggy?code=abc&state=forged", "arjun"), ctx("swiggy"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/connect/swiggy/done?status=error");
    expect(await loadToken("demo-family", "arjun", "swiggy")).toBeNull();
  });
});

const connectSwiggy = () => connect(get("/api/partners/swiggy/connect", "arjun"), ctx("swiggy"));

describe("send something (MOCK)", () => {
  it("shows an account partner only once that account is connected; gift stores need none", async () => {
    const before = await json<{ suggestions: S[] }>(suggestPost(post("/api/partners/suggest", "arjun", { forMemberId: "dadi", occasion: "Diwali" })));
    expect(before.suggestions.length).toBeGreaterThan(0);
    expect(before.suggestions.some((s) => s.partnerId.startsWith("swiggy") || s.partnerId.startsWith("zomato"))).toBe(false);
    expect(before.suggestions.every((s) => s.kind === "gifts")).toBe(true);
    await connectSwiggy();
    const after = await json<{ suggestions: S[] }>(suggestPost(post("/api/partners/suggest", "arjun", { forMemberId: "dadi", occasion: "Diwali" })));
    expect(after.suggestions.some((s) => s.partnerId === "swiggy-instamart")).toBe(true);
  });

  it("suggests three grounded, labelled samples for an occasion", async () => {
    await connectSwiggy();
    const out = await json<{ sample: boolean; suggestions: S[] }>(suggestPost(post("/api/partners/suggest", "arjun", { forMemberId: "dadi", occasion: "Diwali" })));
    expect(out.sample).toBe(true);
    expect(out.suggestions).toHaveLength(3);
    expect(out.suggestions.every((s) => s.sample)).toBe(true);
    expect(out.suggestions.filter((s) => s.partnerId === "swiggy-instamart")).toHaveLength(2);
    expect(out.suggestions.some((s) => s.kind === "gifts")).toBe(true);
    const catalogue = new Map([...PARTNERS.flatMap((p) => p.samples), ...GIFT_STORES.flatMap((s) => s.samples)].map((x) => [x.name, x.price]));
    for (const s of out.suggestions) expect(catalogue.get(s.name)).toBe(s.price);
  });

  it("matches a need to the right items and refuses medicines", async () => {
    await connectSwiggy();
    const need = await json<{ suggestions: S[] }>(suggestPost(post("/api/partners/suggest", "arjun", { forMemberId: "dadi", need: "Milk and atta for the week" })));
    expect(need.suggestions.map((s) => s.name)).toEqual(expect.arrayContaining(["Toned milk, 1 L", "Whole wheat atta, 5 kg"]));
    const med = await json<{ suggestions: S[]; refused?: string }>(suggestPost(post("/api/partners/suggest", "arjun", { forMemberId: "dadi", need: "BP tablets" })));
    expect(med).toMatchObject({ suggestions: [], refused: "medical" });
  });

  it("validates input and the recipient's family", async () => {
    expect((await suggestPost(post("/api/partners/suggest", "arjun", { forMemberId: "dadi", occasion: "x".repeat(200) }))).status).toBe(400);
    expect((await suggestPost(post("/api/partners/suggest", "arjun", { forMemberId: "nobody" }))).status).toBe(404);
    expect((await suggestPost(new Request("http://test/api/partners/suggest", { method: "POST", body: "{}" }))).status).toBe(401);
  });

  it("asks to connect, then previews, needs an explicit confirm, and places it once", async () => {
    await connectSwiggy();
    const { suggestions } = await json<{ suggestions: S[] }>(suggestPost(post("/api/partners/suggest", "arjun", { forMemberId: "dadi", occasion: "Diwali" })));
    const im = suggestions.find((s) => s.partnerId === "swiggy-instamart")!;
    // The connection is dropped after the list was shown: the order asks to connect again.
    await disconnect(new Request("http://test/api/partners/swiggy/connect", { method: "DELETE", headers: { cookie: sessionCookie("arjun") } }), ctx("swiggy"));
    expect(await json(orderPost(post("/api/partners/order", "arjun", { action: "preview", suggestionId: im.id, forMemberId: "dadi" })))).toEqual({ needsConnect: "swiggy", name: "Swiggy" });

    const c = await connect(get("/api/partners/swiggy/connect", "arjun"), ctx("swiggy"));
    expect(c.status).toBe(302);
    expect(c.headers.get("location")).toContain("/connect/swiggy/done?status=ok");
    const list = await json<{ accounts: { id: string; connected: boolean }[] }>(partnersGet(get("/api/partners", "arjun")));
    expect(list.accounts.find((a) => a.id === "swiggy")?.connected).toBe(true);
    expect(JSON.stringify(list)).not.toContain("sample\"}");

    const pv = await json<{ preview: { id: string; total: number; address: { line: string }; eta: string; sample: boolean } }>(orderPost(post("/api/partners/order", "arjun", { action: "preview", suggestionId: im.id, forMemberId: "dadi" })));
    expect(pv.preview).toMatchObject({ total: im.price, eta: "~25 min", sample: true });
    expect(pv.preview.address.line).toBe("Amritsar");

    expect((await orderPost(post("/api/partners/order", "arjun", { action: "confirm", previewId: pv.preview.id }))).status).toBe(400);
    expect((await orderPost(post("/api/partners/order", "leo", { action: "confirm", previewId: pv.preview.id, confirm: true }))).status).toBe(404);
    const done = await json<{ result: { status: string; eta: string } }>(orderPost(post("/api/partners/order", "arjun", { action: "confirm", previewId: pv.preview.id, confirm: true })));
    expect(done.result).toMatchObject({ status: "placed", eta: "~25 min" });
    expect((await orderPost(post("/api/partners/order", "arjun", { action: "confirm", previewId: pv.preview.id, confirm: true }))).status).toBe(404);
  });

  it("a gift hands off to the store's own checkout, no account needed", async () => {
    const { suggestions } = await json<{ suggestions: S[] }>(suggestPost(post("/api/partners/suggest", "arjun", { forMemberId: "dadi", occasion: "Diwali" })));
    const gift = suggestions.find((s) => s.kind === "gifts")!;
    const pv = await json<{ preview: { id: string; handoff: boolean; address: null } }>(orderPost(post("/api/partners/order", "arjun", { action: "preview", suggestionId: gift.id, forMemberId: "dadi" })));
    expect(pv.preview).toMatchObject({ handoff: true, address: null });
    const done = await json<{ result: { status: string; url: string } }>(orderPost(post("/api/partners/order", "arjun", { action: "confirm", previewId: pv.preview.id, confirm: true })));
    expect(done.result.status).toBe("handoff");
    expect(done.result.url).toMatch(/^https:\/\/[a-z.]+\/cart\/\d+:1$/);
  });

  it("can't preview an item the server never showed this member, and disconnect forgets the token", async () => {
    expect((await orderPost(post("/api/partners/order", "kavya", { action: "preview", suggestionId: "swiggy-instamart:im-kaju-katli", forMemberId: "dadi" }))).status).toBe(410);
    await connect(get("/api/partners/swiggy/connect", "arjun"), ctx("swiggy"));
    const del = await disconnect(new Request("http://test/api/partners/swiggy/connect", { method: "DELETE", headers: { cookie: sessionCookie("arjun") } }), ctx("swiggy"));
    expect(await json(del)).toEqual({ ok: true, connected: false });
    expect(await loadToken("demo-family", "arjun", "swiggy")).toBeNull();
  });
});
