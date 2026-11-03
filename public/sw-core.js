// The service worker's decisions, kept pure (no caches, no fetch of its own) so they are unit tested
// (tests/sw-core.test.ts). Loaded by sw.js with importScripts and by the tests with require.
(function (root) {
  // Waits before retry 1 and 2 of a page that came back 5xx or failed (the host's CPU cut-off).
  var NAV_DELAYS = [300, 900];
  var NAV_CACHE_CAP = 30;
  // Pages that are never kept: the API, the sign-in callback (one-time code) and public share links.
  var NEVER_CACHE_PAGE = ["/api/", "/auth/", "/r/"];

  function isCutOff(status) {
    return status >= 500;
  }

  /** Is this path an app page whose HTML may be kept as a fallback copy? */
  function cacheablePage(pathname) {
    for (var i = 0; i < NEVER_CACHE_PAGE.length; i++) if (pathname.indexOf(NEVER_CACHE_PAGE[i]) === 0) return false;
    return true;
  }

  /** Which cached page keys to delete so at most `cap` remain (oldest first; `keys` is oldest to newest). */
  function overflow(keys, cap) {
    var n = keys.length - (cap == null ? NAV_CACHE_CAP : cap);
    return n > 0 ? keys.slice(0, n) : [];
  }

  /**
   * Answer a page navigation. `load()` fetches the page; `copy()` returns the kept copy (or null).
   * Up to two retries (300, 900 ms) on a 5xx or a network error, then the kept copy, then the
   * self-retrying page ("wait"). Anything below 500 (a 200, a redirect, a 404) is the real answer.
   * Resolves { kind: "network", res } | { kind: "copy", res } | { kind: "wait" } | { kind: "offline" }.
   */
  async function navigate(load, copy, sleep, delays) {
    var waits = delays || NAV_DELAYS;
    var sawResponse = false;
    for (var n = 0; n <= waits.length; n++) {
      try {
        var res = await load();
        sawResponse = true;
        if (!isCutOff(res.status)) return { kind: "network", res: res };
      } catch (e) {
        /* network error: same as a cut-off */
      }
      if (n < waits.length) await sleep(waits[n]);
    }
    var kept = await copy();
    if (kept) return { kind: "copy", res: kept };
    // Never a response at all: the device is offline, not the host cutting us off.
    return { kind: sawResponse ? "wait" : "offline" };
  }

  var api = { NAV_DELAYS: NAV_DELAYS, NAV_CACHE_CAP: NAV_CACHE_CAP, isCutOff: isCutOff, cacheablePage: cacheablePage, overflow: overflow, navigate: navigate };
  root.NearerSW = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
