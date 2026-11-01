// OpenNext adapter config for Cloudflare Workers (npm run cf:build).
// Prerendered pages are served from Workers static assets. Nearer uses no ISR
// or revalidation, so no R2/KV cache bucket is needed.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
