// Host routing for the docs site. On docs.nearer.site the docs live at the root; the app serves them
// at /docs. Pure, so the Worker entry (cf-worker.mjs) and the tests share it. Every other host is untouched.

export const DOCS_HOST = "docs.nearer.site";

// Paths the docs host must still serve from the app as they are: build assets, brand files, the API.
const PASS_THROUGH = /^\/(_next|brand|api|docs)(\/|$)/;

/** The path to serve for a request, or null to leave the request alone. */
export function docsRewrite(host, pathname) {
  if (String(host || "").toLowerCase().split(":")[0] !== DOCS_HOST) return null;
  if (PASS_THROUGH.test(pathname)) return null;
  // Files (favicon.ico, robots.txt, images) come from the app as they are.
  if (/\.[a-z0-9]{2,5}$/i.test(pathname)) return null;
  const clean = pathname.replace(/\/+$/, "");
  return clean === "" ? "/docs" : `/docs${clean}`;
}
