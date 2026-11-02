// Single source of truth for providers and model IDs.
// Nothing here is secret. Keys come from the environment only:
// META_API_KEY (Meta Model API), BASETEN_API_KEY (Baseten-hosted Muse Spark Open)
// and MODAL_API_KEY + MODAL_MUSE_URL (our own Muse Spark Open endpoint on Modal,
// an OpenAI-compatible vLLM server; see docs/NATIVE.md / .env.example).

export const SPEND_CAP_USD = 120;

export type ProviderName = "meta" | "baseten" | "modal";

/** Failover order. The active provider goes first; the rest follow in this order. */
export const PROVIDER_CHAIN: readonly ProviderName[] = ["meta", "baseten", "modal"];

export interface ProviderConfig {
  baseUrl: string;
  captionModel: string;
  transcribeModel: string;
  imageModel: string;
}

export const PROVIDERS: Record<ProviderName, ProviderConfig> = {
  meta: {
    baseUrl: "https://api.meta.ai/v1",
    captionModel: "muse-spark-1.3",
    // Public model name per 06_muse_voice/01 (utils.py DEFAULT_MODEL).
    transcribeModel: "muse-voice-transcribe-1.0",
    imageModel: "muse-image-1.0",
  },
  baseten: {
    baseUrl: "https://inference.baseten.co/v1",
    captionModel: "meta-models/muse-spark-open-1026",
    transcribeModel: "meta-models/muse-spark-open-1026",
    imageModel: "meta-models/muse-spark-open-1026",
  },
  modal: {
    // Read at call time: the URL is per deployment (https://<workspace>--<app>.modal.run/v1).
    get baseUrl() {
      return (process.env.MODAL_MUSE_URL ?? "").replace(/\/+$/, "");
    },
    captionModel: process.env.MODAL_MUSE_MODEL ?? "meta-models/muse-spark-open-1026",
    transcribeModel: process.env.MODAL_MUSE_MODEL ?? "meta-models/muse-spark-open-1026",
    imageModel: process.env.MODAL_MUSE_MODEL ?? "meta-models/muse-spark-open-1026",
  },
};

/** Each provider's own key. Never send one provider's key to the other. */
export function providerKey(p: ProviderName): string | undefined {
  if (p === "baseten") return process.env.BASETEN_API_KEY;
  // Modal needs both its key and its endpoint URL to count as configured.
  if (p === "modal") return process.env.MODAL_MUSE_URL ? process.env.MODAL_API_KEY : undefined;
  return process.env.META_API_KEY;
}

/**
 * Meta's Model API is primary. MUSE_PROVIDER=baseten|modal makes that host
 * primary instead (when it is configured).
 */
export function activeProvider(): ProviderName {
  const want = process.env.MUSE_PROVIDER;
  if ((want === "baseten" || want === "modal") && providerKey(want)) return want;
  return "meta";
}

/** Where a failed text/vision call goes next: the next configured host in the chain. */
export function failoverProvider(p: ProviderName): ProviderName | null {
  return PROVIDER_CHAIN.find((o) => o !== p && providerKey(o)) ?? null;
}

export function isMockMode(): boolean {
  return process.env.MOCK === "true" || !providerKey(activeProvider());
}

/** Sample partner data and pretend connections: only when MOCK=true. A missing Muse key does not make partner stores pretend; they are searched live. */
export function isSampleMode(): boolean {
  return process.env.MOCK === "true";
}
