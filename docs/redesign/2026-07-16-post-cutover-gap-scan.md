# Post-cutover gap scan (2026-07-16)

> **Pickup guide.** This work is split into three Claude Code tasks (see TaskList), one per
> session, per Bridger's plan:
> **Task #1 "legacy leaks"** → fix everything in §1 (blocker + should-fixes), ~2 small PRs.
> **Task #2 "UX wins"** → ship §2 in small batches, the six "high" S items first.
> **Task #3 "payout models"** → /grill-me + spec for the cleaner-decides-payment model (no spec
> exists yet; questions are queued in the task; do not start until Bridger opens the topic).
> Line numbers below were verified 2026-07-16; re-verify before editing, code moves.

Full-codebase sweep run the evening after the redesign flip, looking for (1) anything that still
leads to or renders legacy UI, (2) redesign work that shipped incomplete, and (3) small UX wins
worth building before MVP. Seven scan passes: route inventory, client-side navigation, server/email
URLs, parity/TODOs, auth-flow trace, and two UX reviews. Every finding below was verified against
source at the cited file:line.

Overall verdict: the cutover is remarkably tight. Login, accept-invite, reset-password, sign-out,
and impersonation all land on `/app/*` with no 307 dependence; the redesign tree has zero
TODO/FIXME markers and zero dead buttons; emails and Supabase auth redirects point at flag-aware
paths; manager permission gating is real (nav filter + per-route `useRequireManagerFlag` + settings
section gating). The gaps are the short list below.

## 1. Legacy leaks

### Blocker

- **Legacy `/owner` is fully reachable and renders legacy UI.** `next.config.ts` legacyRedirects
  covers the four dashboards and `/settings` but not `/owner`; `middleware.ts` matcher is `/` only,
  so there is no other net. `src/app/owner/page.tsx:40` renders the legacy `PlatformOverviewPage`
  for any signed-in platform admin (guard only bounces signed-out and non-admins). Login routes
  platform admins to `/app/owner` correctly, so the exposure is bookmarks/typed URLs, and the
  audience is platform staff only, but it is the one legacy screen still standing post-flip.
  Fix: add `{ source: "/owner", destination: "/app/owner", permanent: false }` (+ `/owner/:path*`),
  delete `src/app/owner` in Phase 4. Related: the legacy `ImpersonationBanner` Exit button pushes
  `/owner` (`src/components/platform/ImpersonationBanner.tsx:31`) and legacy `PlatformOrgDetail`
  "View as" pushes `/admin-dashboard` (`:67`); both only render on legacy `/owner` itself and die
  with it.

### Should-fix (papered over by the 307s today; break or misbehave at Phase 4)

- **Stripe Connect onboarding return/refresh URLs point at legacy `/cleaner-dashboard`.**
  `src/app/api/stripe/connect/onboarding-link/route.ts:49-50`. URLs are clicked from Stripe's
  hosted flow, fully outside the SPA. No client callers remain (embedded onboarding components are
  used instead), so either repoint to `/app/cleaner-dashboard` or delete the route in Phase 4.
- **Stripe billing-portal fallback return_url is legacy `/admin-dashboard`.**
  `src/app/api/stripe/billing/portal-link/route.ts:31` ("Scenario 3 scaffolding", no callers yet).
  Change the fallback to `/app/admin-dashboard` whenever this gets a consumer, or fold into Phase 4.
- **`?tab=` deep links are only mapped for the `/admin-dashboard` source.** `/manager-dashboard?tab=payments`,
  homeowner tabs (`payment-methods`, etc.), and cleaner tabs all 307 to the target dashboard ROOT,
  landing on the wrong screen. Extend the tab-map generation in `next.config.ts` to the other three
  sources (homeowner `?tab=payment-methods` → `/app/homeowner-dashboard/account/payment-methods`, etc.).
- **Operator layout has no wrong-role guard, and the `/settings` redirect funnels every role there.**
  `src/app/(redesign)/app/admin-dashboard/layout.tsx:36` only checks signed-in; the cleaner and
  homeowner layouts both soft-bounce wrong roles (`cleaner-dashboard/layout.tsx:38`,
  `homeowner-dashboard/layout.tsx:42`). Legacy chrome gave EVERY role a `/settings` link, and
  `next.config.ts` 307s `/settings` → `/app/admin-dashboard/settings`, so a homeowner or cleaner
  with an old settings bookmark lands inside OperatorShell with empty/erroring org queries (RLS
  protects data; it is a wrong-shell dead end, and `useRequireManagerFlag` can spin forever). Add
  the same soft role guard the sibling layouts have.
- **`/billing/add-card` (live emailed card-collection page) still wears the legacy yellow.**
  `src/app/billing/add-card/page.tsx:81,135,177` use `bg-primary-600`/`text-primary-600` (the
  retired yellow ramp) and raw grays around a Stripe element that PR #164 already re-themed
  brand-blue. This page is a production entry point (Brevo card-link emails). Re-theme the chrome
  to redesign tokens. NOTE: its absence from the redirect list is CORRECT (standalone token-gated
  public page, not a legacy screen), and Phase 4 deletion must NOT remove it; the emailed URL
  `${appBase}/billing/add-card?t=...` has live 7-day tokens.
- **Invoices capability was lost at cutover.** Legacy `PaymentsPage` had an invoices tab
  (`src/components/PaymentsPage.tsx:21`); the redesign payments screen has none (zero invoice UI
  under `src/components/redesign/**`), and the 2026-07-09 functionality audit left it as
  "decide deliberately" with no decision recorded.
  **DECISION (Bridger, 2026-07-17): retire for MVP.** The `invoices` table (migration 000) and
  `/api/invoices/create` (route + integration test) still exist, but nothing live creates
  invoices (zero callers in the app) and the redesign shipped without the view with no one
  missing it, so the feature is dormant. No invoices UI will be built for MVP; the data model +
  route stay in place, so a proper invoices feature can be built later if the business needs it.
  Reversible.
- **`HomeownerPaymentRecovery` hardcodes `isSelfPay: false`, and its justifying comment is now stale.**
  `src/components/redesign/homeowner/cleanings/HomeownerPaymentRecovery.tsx:110`;
  `useHomeownerData.ts` now selects and types `is_self_pay` (lines 40, 164). Comped homeowners see
  Pay now / Update card actions that 403. One-line fix (`isSelfPay: !!appointment.is_self_pay`) +
  a unit test on the derive wiring.

### Notes (cleanup / hardening, mostly Phase 4)

- `reset-password` success and `not-found` route the platform owner by `user_profiles.role` only,
  landing them on `/app/admin-dashboard` (org spinner) instead of `/app/owner`
  (`reset-password/page.tsx:144`, `not-found.tsx:14`). Login is the only entry that waits for
  `isPlatformAdmin`. Edge case for exactly one account; still `/app/*`, no legacy leak.
- `getDashboardPath` default returns `/`, which 307s to `/login`, which pushes the default again:
  a role-less signed-in user would ping-pong. Practically unreachable (AuthContext fallback always
  derives a role); harden when the legacy branches are deleted from the helper.
- Dead `/signup` reference in `AuthContext.tsx:649` (no signup route exists; invite-only).
- Dead code: `DashboardHeader.tsx` / `DesktopMenuDropdown.tsx` have zero importers.
- Phase 4 retirement checklist confirmed still-standing (deliberate, per runbook soak window):
  legacy dirs `src/app/{admin,manager,cleaner,homeowner}-dashboard`, `src/app/settings` (14 files),
  `src/app/owner`; legacy charge path `api/stripe/create-payment-intent`; 307 → 308 graduation;
  `nav-items.ts` `activeFor: ["/settings"]` alias + stale comments (`dashboardPath.ts:2`).
- Audit §4 nice-to-haves (custom analytics range/PDF export, homeowner photo gallery, cleaner
  own-jobs calendar, bulk payout-% editor, staff profile edit, homeowner-invites view, manager
  read-only business settings) remain unbuilt with no recorded decision. Log the deferral.
- No legacy one-off admin/repair pages remain in `src/app` (already deleted). All redirect targets
  exist (no 404s).

## 2. UX quick wins (small, high-leverage, no scope creep)

### Operator

1. **Unread-messages badge on the operator Messages nav** (S, high). Cleaner + homeowner shells
   already badge via `useUnreadMessageCount`; the operator rail/mobile nav has no badge support.
2. **Show availability in the assign-cleaner select** (S, high). `BookingDetailSheet` lists bare
   names; the conflict derivation already exists in `reschedule/deriveReschedule.ts` (Reschedule
   dialog labels Available/Busy). Stop the pick-blind → error-toast loop.
3. **Make Today's schedule / Active now rows open the booking sheet** (S, high).
   `TodayActivePanel` rows are inert text while the adjacent Needs-you-now queue opens the sheet;
   `openBooking` is already in scope in `OperatorOverview`.
4. **Calendar loading skeleton** (S, high). `OperatorCalendar` doesn't destructure `loading`, so
   first paint is an empty grid that reads as "no jobs".
5. **Customer sheet quick actions** (M, high). New booking (seeded `customerId`), Message
   (`messages?to=`), clickable history rows; all target infrastructure already exists.
6. **Persist Bookings segment/filters in the URL** (S). Payments already does `?ledger=`; mirror
   for `?segment=/&status=/&cleaner=`. Unlocks deep links + sane back button.
7. **"View booking" from the payment detail sheet** (S). `appointmentId` is already on the VM,
   never rendered.
8. **Message action on the cleaner detail sheet** (S). Same `?to=` contract as everywhere else.
9. **Remember the calendar view mode** (S). `useCalendarNavigation` hard-resets to week every
   mount; persist last explicit pick (first localStorage use → add a tiny `getUiPref/setUiPref`).
10. **KPI tiles click through** (S). Extend `StatTile` primitive with optional `href`; pairs with #6.

### Homeowner

1. **Make the blue next/in-progress hero tappable** (S, high). `HomeownerCleaningHero` only wires
   `onOpen` for the completed state; the most prominent element on Home does nothing when tapped.
2. **The `isSelfPay` fix above** (S, high) — doubles as the top homeowner UX bug.
3. **Prefill booking from the last completed cleaning** (S, high). `BookingFlow` only pre-selects
   a property; default home+service from the cached last appointment (stale-prefill guards exist).
4. **Elapsed timer actually ticks** (S). `LiveCleaningProgress` captures `Date.now()` once in a
   `useMemo`; "Started 45m ago" freezes while the homeowner watches.
5. **44px tap targets in the booking flow** (S). Time chips (~33px) and remove-slot X (32px) are
   below the app's own `min-h-[44px]` convention.

### Cleaner

1. **"Next up" card on Today: one-tap Start + Directions** (M, high). Today is a flat row list;
   starting a job is row → overlay → Start. `useStartJob` and `CleanerDirectionsButton` already
   exist standalone.
2. **"You're owed $X" total on Earnings** (S, high). ClearingSection lists per-job cuts but never
   sums; also motivates Connect setup ("Connect your bank to receive $X").
3. **Street address on job rows** (S). When a property has a name, the address is invisible until
   the overlay opens; bad for route planning.
4. **Auto-retry failed photo uploads on reconnect** (S). `uploader.retryFailed()` exists; add a
   window `online` listener + "Will retry when you're back online" chip copy.
5. **Cache last-known Today list for offline opens** (M). Cold open with no signal = skeleton →
   error, exactly when a field worker needs addresses. Persist just the cleaner appointments query.

## 3. Suggested sequencing

1. **PR: cutover leak fixes** (small): `/owner` redirect, operator-layout role guard, extended
   tab maps, `isSelfPay` one-liner, repoint/kill the two orphaned Stripe-URL routes.
2. **PR: add-card page re-theme** + decide invoices (port read-only view or log retirement).
3. **UX quick-win batches**, cherry-picked from §2 (the six "high" S items first; candidates for
   the rolling `fix/ui-minor-fixes` cadence).
4. **Phase 4 retirement PRs** after the soak window (legacy dirs, legacy charge path, 307→308,
   dead code, decision log for §4 nice-to-haves).
5. **Cleaner-decides-payment payout model** (pilot) — spec pending clarification, then build.
6. **Cleaning-company-with-availability model** — build while the pilot runs on #5.

Ops items still open (tracked elsewhere): live-test of #161 on dev preview, Stripe live-webhook checklist +
the 3 missing prod events (`transfer.reversed`, `payout.paid`, `payout.failed`), balance-floor
monitor, lint-gate flip, `fix/ui-minor-fixes` push decision.
