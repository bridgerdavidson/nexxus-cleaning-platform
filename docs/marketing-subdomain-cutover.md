# Marketing subdomain cutover runbook

**Status: not yet live.** The marketing landing page ships inside this app and is
reachable at `/landing` on any deploy. Serving it from a dedicated subdomain (Jobber's
`get.jobber.com` pattern) is a deliberate ops step, triggered when we obtain the subdomain
from the Tri-Nexus domain owner. This doc is the checklist to run at that point.

Related code (already merged, PR #130):
- `src/middleware.ts` — host-based rewrite of `/` -> `/landing`, gated on `MARKETING_HOST`.
- `next.config.ts` — the `/` -> `/login` redirect has a `missing: [{ type: "host", value: MARKETING_HOST }]` guard so it does not swallow the rewrite on the marketing host.
- `src/app/(marketing)/` — the landing page + its always-light layout.

## How the switch works (recap)

`MARKETING_HOST` is the on/off switch. Unset (today) -> middleware is a no-op and the app
is unchanged. Set to the marketing host string -> a request to `https://<that-host>/`
gets an **invisible rewrite** to `/landing` (URL bar stays at the bare `/`), while the app
domain keeps redirecting `/` to `/login`. The middleware only runs on `/` (`matcher: '/'`),
so every other route is untouched on both hosts.

## Cutover checklist

Do these in order. Steps 1-4 are ops (DNS/Vercel); step 5 is the code change; step 6 verifies.

### 1. Decide the marketing host string
Pick the exact hostname, e.g. `get.cleaning.tri-nexus.com` (confirm the final form with the
domain owner). Everything below uses `<MARKETING_HOST>` for this value.

### 2. Add the domain in Vercel
Vercel project (`nexxus-cleaning-platform`) -> Settings -> Domains -> add `<MARKETING_HOST>`.
Vercel will show the DNS record it wants.

### 3. Point DNS at Vercel
At the registrar for the domain, add the record Vercel asked for (typically a CNAME from
`<MARKETING_HOST>` to `cname.vercel-dns.com`). This is the step the domain owner may need to
do. Wait for it to verify in Vercel (can take minutes to a few hours).

### 4. Set the env var and redeploy
In Vercel -> Settings -> Environment Variables, add `MARKETING_HOST = <MARKETING_HOST>` for
**Production** (and Preview if you want previews to behave the same). Redeploy so the value
is picked up. From this moment the middleware is live.

### 5. Point the landing-page CTAs at the app domain (code change — bullet 3)
Once marketing and the app are on different hosts, the landing page's relative links to the
app (e.g. `Log in` -> `/login`) resolve against the **marketing** host, which is wrong. Fix:

- Add `NEXT_PUBLIC_APP_URL` (e.g. `https://cleaning.tri-nexus.com`) as an env var. Leave it
  unset in the current single-host setup so nothing changes until cutover.
- Introduce a small helper, e.g. `appUrl(path: string)` in `src/lib/marketing.ts`:
  returns `${process.env.NEXT_PUBLIC_APP_URL ?? ''}${path}`. Unset -> relative (today's
  behavior); set -> absolute to the app domain.
- Swap the app-pointing links to use it. Current call sites (grep for `/login` and `/signup`
  under `src/components/marketing/`):
  - `MarketingNav.tsx` — the `Log in` button (`<Link href="/login">`).
  - `MarketingFooter.tsx` — the `Log in` link.
  - Any future `Start free trial` / signup CTA.
  - Do NOT change in-page anchor links (`#pricing`, `#waitlist`, `#faq`, `#try-it`) or the
    waitlist `fetch('/api/waitlist')` — the API must stay same-origin so it runs on whichever
    host serves the page. `/api/waitlist` exists in this app, so it resolves on the marketing
    host too. Good.

### 6. Verify
- `https://<MARKETING_HOST>/` shows the landing page, URL stays at `/` (rewrite, not redirect).
- `https://<MARKETING_HOST>/login` — decide per Option A below what this should do.
- App domain `/` still redirects to `/login`; app routes unaffected.
- Landing `Log in` / signup now navigate to the app domain (absolute), not the marketing host.
- Waitlist submit still succeeds (posts to `/api/waitlist` on the marketing host).
- Local dry run: `MARKETING_HOST=get.nexxus.test npm run dev`, then
  `curl -s -H "Host: get.nexxus.test" http://localhost:3000/ | grep -c "without the chaos"`
  should print `1`; `curl -sI http://localhost:3000/` (app host) should still 307 to `/login`.

## Open decisions (resolve at cutover)

### Option A — one-page host, or a marketing tree?
Today `matcher: '/'` means only the root is intercepted; `<MARKETING_HOST>/anything-else`
falls through to the app's routes on that host. For a single landing page this is fine.
If we add more marketing pages later (`/about`, `/terms`, a blog), widen the matcher and add
rules for what the marketing host serves vs. what should redirect back to the app domain
(e.g. `<MARKETING_HOST>/login` -> `https://<APP_HOST>/login`).
- **Default recommendation:** keep it one-page (`/` only) until there is a second marketing page.

### Option B — canonical host + www/apex handling
If more than one hostname can serve this page (apex, `www.`, the subdomain), pick ONE
canonical host and 301-redirect the others to it, so SEO does not see duplicates. If only the
single dedicated subdomain points here, skip this.
- **Default recommendation:** only the dedicated subdomain resolves here; no extra redirects needed.

### Option C — absolute app URLs for CTAs
This is step 5 above. It is the one required code change at cutover. It is env-var gated
(`NEXT_PUBLIC_APP_URL`) so it is a no-op until the two hosts split.
- **Default recommendation:** implement the helper now-or-at-cutover; only flips on when the env var is set.

## Rollback
Unset `MARKETING_HOST` (and `NEXT_PUBLIC_APP_URL`) in Vercel and redeploy. Middleware and the
config redirect revert to no-ops; CTAs go back to relative links. Removing the domain in
Vercel + the DNS record fully detaches the subdomain. No data migration is involved.
