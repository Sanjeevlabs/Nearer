/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cloudflare Workers has no built-in Next.js image optimizer. The only
  // optimised images were a handful of bundled demo photos, so they are served
  // as-is (Workers static assets, edge-cached) rather than adding a Cloudflare
  // Images dependency. See docs/DEPLOY.md.
  images: { unoptimized: true },
  // Which build an error came from (the error beacon); CI sets the commit, local runs say "dev".
  env: { NEXT_PUBLIC_BUILD_ID: (process.env.NEXT_PUBLIC_BUILD_ID || process.env.GITHUB_SHA || process.env.WORKERS_CI_COMMIT_SHA || "dev").slice(0, 12) },
};

export default nextConfig;
