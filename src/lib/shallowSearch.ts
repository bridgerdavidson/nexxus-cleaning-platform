/**
 * Same-pathname search-param updates go through the NATIVE history API, never
 * `router.replace`.
 *
 * Why: Next 16's client router breaks this exact move on statically
 * prerendered routes. After a hard load whose URL already carried search
 * params (reload on `/admin/settings?section=branding`, a deep link, a PWA
 * relaunch), a same-pathname `router.replace` with different params is served
 * from the client cache, and applying the cached entry RESTORES its canonical
 * URL: history.replaceState fires with the OLD url, no RSC fetch happens, and
 * the navigation is a silent no-op. Every section switch, filter, tab, and
 * detail-sheet open/close in the app rode that pattern, so they all went dead
 * after any reload-with-params. (Hard loads WITHOUT params seed the cache
 * differently and happen to work, which is why this hid for so long.)
 *
 * Native history updates are officially supported by Next (>= 14.1 syncs
 * usePathname/useSearchParams from pushState/replaceState) and bypass the
 * router cache entirely; they are also cheaper, since a search-param-only
 * change never needs the server.
 *
 * ONLY use this for URLs on the CURRENT pathname. Navigating to a different
 * pathname must keep using the router, or the URL and the rendered route
 * desync. (router.push is NOT affected by the bug: it creates a fresh history
 * entry instead of reusing the poisoned one, verified against a prod build,
 * so cross-page and push-semantics navigation stays on the router.)
 */
export function replaceSearchShallow(url: string): void {
  // Accept the call-site URL shapes as-is: "path?qs", "?qs", "path", and the
  // clear-everything forms "path?" / "?" (empty query string). A bare or
  // trailing "?" must resolve to the pathname, because replaceState with ""
  // means "current URL" and would leave the params in place.
  const target = url.replace(/\?$/, "") || window.location.pathname;
  // Enforce the same-pathname contract at runtime: a stale closure can hand us
  // a URL for a pathname we have already navigated away from (a deferred
  // sheet-close timer firing after a route change, or a tap landing while a
  // popstate transition is still committing, where usePathname() lags
  // window.location). Rewriting the current history entry to a DIFFERENT
  // pathname's URL would desync the address bar from the rendered route, so
  // drop the update instead: the navigation that made it stale wins.
  const targetPathname = target.startsWith("?")
    ? window.location.pathname
    : new URL(target, window.location.origin).pathname;
  if (targetPathname !== window.location.pathname) return;
  window.history.replaceState(null, "", target);
}
