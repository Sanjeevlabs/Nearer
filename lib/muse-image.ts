// Muse Image (muse-image-1.0) for family portraits and photo restoration.
// Server only.
//
// API shape, from the official cookbook (meta-model-cookbook,
// 05_muse_image/01_image_api_fundamentals and 03_anchored_generation):
//   POST https://api.meta.ai/v1/responses
//   { model: "muse-image-1.0",
//     input: [{ role: "user", content: [
//       { type: "input_text", text: "..." },
//       { type: "input_image", image_url: "data:image/jpeg;base64,..." }, ...] }],
//     tools: [{ type: "image_generation", size: "1024x1024" | "1024x1536" | "1536x1024" }],
//     store: false }
//   → { id, status, output: [ {type:"reasoning"}, {type:"message"},
//        {type:"image_generation_call", result: "<base64 image>"} ], usage: {...} }
// Reference images must be wrapped in a user message (a bare content list is
// a 400). store:false keeps no conversation state on Meta's side.
//
// Every render: refused past the shared spend cap (estimate checked first),
// cached by its exact input, logged to "What Muse did". In mock mode, or with
// no Meta key, nothing is called: the screen paints a labelled sample itself.
import { isMockMode, PROVIDERS, providerKey } from "./config";
import { cacheKey, sha256Hex, type LlmStore, type SpendLedger } from "./llm";
import { serverLedger, serverStore } from "./llm-server";
import { newId, putDoc } from "./family-docs";
import { MUSE_IMAGE_ESTIMATE_USD } from "./muse-portrait";
import { createDownloadUrl, mockGetBlob, usesMockStorage } from "./storage";
import { MEDIA_MODEL_TIMEOUT_MS, MEDIA_READ_TIMEOUT_MS, SERVICE_TIMEOUT_MS, deadline, isTimeout } from "./timeouts";

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export type MuseImageResult =
  | { status: "ok"; image: string; cached: boolean; cost: number }
  | { status: "sample" }
  | { status: "refused" }
  | { status: "failed" };

/** The request body for one Muse Image turn. Pure, so tests can assert the payload. */
export function buildMuseImageRequest(prompt: string, images: string[], size: ImageSize, model = PROVIDERS.meta.imageModel) {
  return {
    model,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }, ...images.map((image_url) => ({ type: "input_image", image_url }))],
      },
    ],
    tools: [{ type: "image_generation", size }],
    store: false,
  };
}

/** Finds the image in a Responses output list. Null when there is none. */
export function extractImage(json: unknown): string | null {
  const out = (json as { output?: unknown } | null)?.output;
  if (!Array.isArray(out)) return null;
  for (const item of out) {
    const it = item as { type?: unknown; result?: unknown };
    if (it?.type === "image_generation_call" && typeof it.result === "string" && it.result.length > 100) return it.result;
  }
  return null;
}

/** base64 → data URL, typed by its magic bytes (WebP, PNG or JPEG). */
export function toDataUrl(b64: string): string {
  const head = Buffer.from(b64.slice(0, 24), "base64");
  const mime =
    head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP"
      ? "image/webp"
      : head[0] === 0x89 && head[1] === 0x50
        ? "image/png"
        : "image/jpeg";
  return `data:${mime};base64,${b64}`;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export async function museImage(opts: {
  familyId: string;
  /** Human sentence for What Muse did. */
  purpose: string;
  prompt: string;
  /** Reference images as data URLs (0-10). */
  images: string[];
  attempts?: 1 | 2;
  size?: ImageSize;
  /** Try again: a new variant is a new render, never the cached one. */
  variant?: number;
  ledger?: SpendLedger;
  store?: LlmStore;
  fetcher?: Fetcher;
}): Promise<MuseImageResult> {
  const ledger = opts.ledger ?? serverLedger;
  const store = opts.store ?? serverStore;
  const model = PROVIDERS.meta.imageModel;
  const started = Date.now();
  const log = (ok: boolean, cached: boolean, cost: number) =>
    putDoc(opts.familyId, "muse_call", { id: newId("muse"), purpose: opts.purpose, model, cached, ok, ms: Date.now() - started, cost, at: new Date().toISOString() }).catch(() => undefined);

  // Muse Image lives on Meta's Model API only (the fallback hosts serve text).
  const key = providerKey("meta");
  if (isMockMode() || !key) return { status: "sample" };
  if (opts.images.length > 10) return { status: "failed" };

  const ck = `museimg:${cacheKey(model, `${opts.prompt}|${opts.size ?? "1024x1024"}|${opts.variant ?? 0}`, opts.images.map((i) => sha256Hex(new TextEncoder().encode(i))).join(","))}`;
  const hit = store.get(ck);
  if (hit) {
    await log(true, true, 0);
    return { status: "ok", image: hit, cached: true, cost: 0 };
  }
  if (!(await ledger.check(MUSE_IMAGE_ESTIMATE_USD))) {
    await log(false, false, 0);
    return { status: "refused" };
  }
  const doFetch: Fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  for (let attempt = 0; attempt < (opts.attempts ?? 2); attempt++) {
    try {
      const res = await doFetch(`${PROVIDERS.meta.baseUrl}/responses`, {
        method: "POST",
        signal: deadline(MEDIA_MODEL_TIMEOUT_MS),
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(buildMuseImageRequest(opts.prompt, opts.images, opts.size ?? "1024x1024", model)),
      });
      if (!res.ok) continue;
      const b64 = extractImage(await res.json());
      if (!b64) continue;
      const image = toDataUrl(b64);
      await ledger.commit(MUSE_IMAGE_ESTIMATE_USD);
      store.set(ck, image);
      await log(true, false, MUSE_IMAGE_ESTIMATE_USD);
      return { status: "ok", image, cached: false, cost: MUSE_IMAGE_ESTIMATE_USD };
    } catch (err) {
      if (isTimeout(err)) break;
      continue;
    }
  }
  await log(false, false, 0);
  return { status: "failed" };
}

const MAX_REF_BYTES = 6 * 1024 * 1024;

/**
 * A bundled file from this app. On Cloudflare a Worker can't reliably fetch its
 * own hostname, so read it through the static-assets binding; elsewhere
 * (next start, tests) a plain fetch works.
 */
async function fetchOwnAsset(url: URL): Promise<Response> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as { ASSETS?: { fetch: (input: URL | string) => Promise<Response> } };
    if (env.ASSETS) return await env.ASSETS.fetch(url);
  } catch {
    /* not running on Cloudflare */
  }
  return fetch(url, { signal: deadline(SERVICE_TIMEOUT_MS) });
}

/**
 * A family photo ref → a data URL for Muse. Only the family's own media:
 * bundled demo files on this origin, or this family's private storage.
 * Anything else (another host, another family's path) is refused.
 */
export async function loadFamilyImage(ref: string, familyId: string, origin: string): Promise<string | null> {
  try {
    let bytes: Uint8Array | null = null;
    let mime = "image/jpeg";
    if (ref.startsWith("storage:")) {
      const path = ref.slice("storage:".length);
      if (!path.startsWith(`${familyId}/`) || path.includes("..")) return null;
      const local = usesMockStorage(path) ? mockGetBlob(path) : undefined;
      if (local) {
        bytes = local.bytes;
        mime = local.mime;
      } else {
        const signed = await createDownloadUrl(path);
        if (!signed || signed.mock) return null;
        const res = await fetch(signed.url, { signal: deadline(MEDIA_READ_TIMEOUT_MS) });
        if (!res.ok) return null;
        bytes = new Uint8Array(await res.arrayBuffer());
        mime = res.headers.get("content-type") ?? mime;
      }
    } else if (/^\/demo\/[\w.-]+\.(webp|jpe?g|png)$/i.test(ref)) {
      const res = await fetchOwnAsset(new URL(ref, origin));
      if (!res.ok) return null;
      bytes = new Uint8Array(await res.arrayBuffer());
      mime = res.headers.get("content-type") ?? (ref.endsWith(".webp") ? "image/webp" : ref.endsWith(".png") ? "image/png" : "image/jpeg");
    } else {
      return null;
    }
    if (!bytes || bytes.length === 0 || bytes.length > MAX_REF_BYTES) return null;
    return `data:${mime.split(";")[0]};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

/** A data URL the browser sent (an old photo to restore): an image, and not too big. */
export function acceptDataUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  if ((m[2].length * 3) / 4 > MAX_REF_BYTES) return null;
  return raw;
}
