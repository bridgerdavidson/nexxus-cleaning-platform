# Cleaner app redesign, Slice 4: Earnings (design spec)

**Date:** 2026-06-28
**Branch:** `feat/redesign-cleaner-app-slice4` (worktree off `master` @ #97)
**Status:** design approved (brainstormed with Bridger 2026-06-28), ready for implementation plan.
**Spec context:** Slice 4 of the 6-slice cleaner (field-worker) app redesign. See `docs/superpowers/specs/2026-06-26-redesign-cleaner-app-design.md` (overall design, §5.4 Earnings + §8 reuse map + §9 slice cut) and `docs/superpowers/cleaner-app-status.md` (where we are).

---

## 1. Goal

Replace the Earnings tab placeholder (`src/app/(redesign)/app/cleaner-dashboard/earnings/page.tsx`, currently a "coming soon" `EmptyState`) with the real phone-first Earnings screen for the contractor (`percentage_contractor`) model. It answers a field worker's two questions: **how much am I getting, and when.** Reuse-everything: NO new data layer, NO new API routes, NO migration.

## 2. The governing principle (decided this brainstorm)

**Stripe owns every money number.** Available balance, money in transit to the bank, and paid-out history all come from Stripe's embedded payouts component, never from our database aggregates. We deliberately deleted our white-label balance cards once before (`project_payouts_stripe_embed`) for this reason; this slice holds that line. Do **not** surface `useCleanerStats.totalEarnings` / `pendingPayouts` or any of our own money aggregates as headline figures.

There is exactly **one** money concept Stripe's cleaner view cannot show, and it is the only money figure we contribute: **a completed job whose customer payment has not settled yet.** In the charge-at-completion flow the cleaner's cut only transfers into Stripe after the customer's charge clears; for card that is effectively immediate, but for **ACH it takes about 4 business days**, during which the job is done and nothing has hit the cleaner's Stripe balance. That is the "Still clearing" section. It is *upstream* of Stripe, so it never duplicates or competes with the Stripe numbers.

Everything else on the screen is non-money **activity** (job counts), which is safe to compute from our data because it is not money.

## 3. Screen anatomy (connected, money flowing)

Phone-first single column inside the existing `CleanerShell` (the shell already provides the top bar, the 5-tab bottom nav, the `max-w-lg` phone column, the skip link, and `pb-28`; the screen adds only vertical spacing, never chrome or width). Top to bottom:

1. **Payout timing note** — the reused one-time, dismissible `PayoutTimingNotice` ("First payout in 7 to 14 days, then about 2 business days."). localStorage-persisted; comes free with the reuse.
2. **Payouts to your bank** (STRIPE, authoritative) — a redesign-tokenized `Card` wrapping the embedded Stripe `ConnectPayouts` table (available balance, money on the way to the bank, paid-out history) with an **Open Stripe** action (`handleOpenStripeDashboard`). This is the money. We never hand-build balance numbers.
3. **Still clearing** (OURS, pre-Stripe) — list of completed jobs whose customer payment is still settling. Each row: service name, customer label ("Company-paid" for self-pay), completed date, a **Clearing** status badge, and the cleaner's **expected** cut (right-aligned, tabular, labeled so it reads as a placeholder until Stripe confirms). A short note: "Settles in about 4 business days, then moves into your Stripe payouts above." The whole section is **hidden when the list is empty** (legacy parity). Decision: amounts are shown (Bridger: they are the cleaner's own cut, accurate, and will not change).
4. **Activity** — three count tiles: **This week**, **Completed**, **Upcoming**. Counts only, no money. (Bridger: keep these; Stripe + clearing already give enough money detail.)

## 4. States to design (all of them)

The screen is a state machine over (a) the feature flags, (b) auth/org gating, (c) the Stripe Connect onboarding state, and (d) whether there is anything to show.

- **Flag-off (prod):** the entire `(redesign)` tree is `notFound()`-gated centrally in `src/app/(redesign)/layout.tsx` via `redesignUiEnabled()` (`NEXT_PUBLIC_REDESIGN_ENABLED`); preview/dev always allowed. The Earnings screen itself does **not** re-check the flag.
- **Auth / org gating:** handled by the cleaner-dashboard layout (spinner while loading, workspace-error screen on org error, non-cleaners redirected). The screen renders only after.
- **Stripe disabled** (`useCleanerConnect.enabled === false`: not cleaner role / `NEXT_PUBLIC_STRIPE_ENABLED !== "true"` / no publishable key): a calm "Payout setup isn't available yet" placeholder in the payouts slot; still show "Still clearing" + activity if present.
- **Connect status loading (first paint only):** design-system `Skeleton` stack (a card-height block for the payouts slot, row skeletons for clearing, pill skeletons for the count tiles). Never a bare spinner in the content column. Guarded so a background status refresh never re-toggles the skeleton (the iframe-unmount invariant, below).
- **Not set up yet** (`cleanerStatusKind === 'inactive'`, no Stripe account): the redesign-native **"Get paid for your work"** card (bank icon, comforting copy, single **Set up payouts** primary button). The button reveals Stripe's embedded onboarding inline (`ConnectAccountOnboarding`, the legacy "CTA reveals inline embedded onboarding" pattern); our card is the *entry/framing*, Stripe's component is the actual onboarding UI. Plus, if the cleaner already has completed-but-unpaid jobs, a **"Waiting for you"** variant of the clearing list with "Connect your bank to receive this." (a deliberate pull toward setup). Activity tiles still shown. (Bridger explicitly liked this state's wording: automatic payment is a core promise of the app and this makes setup the obvious click.)
- **Setup unfinished / pending verification / restricted** (`cleanerStatusKind === 'pending'`, the single bucket): same card shape with "Finish payout setup" / "Verifying your details" copy and a continue action into the embedded onboarding. We rely on Stripe's embedded `notification_banner` to surface the specific requirement rather than re-deriving requirement detail.
- **Active + payouts enabled** (`cleanerStatusKind === 'active'`): the full screen in §3.
- **Empty (connected, nothing yet):** when onboarded, no clearing payments, and the Stripe payouts table is naturally empty, a single design-system `EmptyState` (DollarSign, "Your payouts and what you've earned will show up here.") **Note:** the Stripe payouts table renders its own empty/zero state, so the redesign empty state primarily covers the "Still clearing" + activity gap; keep the payouts Card present so a freshly-connected cleaner still sees the canonical Stripe surface.
- **Errors:** `useStripeConnect.connectError` (inline non-fatal banner above the embed; embed still shows), `useCleanerConnect.initError` (replaces the embed with a graceful error box), and `useCleanerAwaitingPayments` / `useCleanerStats` errors (graceful inline treatment, no crash). There is no established cleaner-folder error primitive; use a small design-system-consistent inline message.
- **Employee / hourly model** (`organizations.default_payout_model === 'hourly_external'`): no Connect/payouts surface; a simple **"Your office handles your pay"** placeholder. Full employee model is deferred (Slice 6 / its own brainstorm); this is a placeholder only. NOTE: Slice 1 hardcodes `"percentage_contractor"`; wiring the real `default_payout_model` is a Slice 6 task, so for Slice 4 the contractor experience is the live path and the employee branch is built defensively but may not be reachable until Slice 6.

## 5. Data sources and reuse (no new data layer)

| Need | Reuse | Notes |
|---|---|---|
| Embedded payouts table + onboarding | `CleanerStripeConnect` (`src/components/CleanerStripeConnect.tsx`) | Renders `ConnectPayouts` when onboarded else `ConnectAccountOnboarding`, inside `StripeFramedCard`; handles disabled/loading/init/connect errors. Accepts an `appearance` prop. Also exports `cleanerStatusKind()` and `shouldShowCleanerConnectSkeleton()`. |
| Brand-matched embed theme | `getRedesignConnectAppearance` (`src/lib/stripe/appearance.ts`) | Theme-aware, brand `#0150FC`. Pass it in so the iframe is not legacy yellow. Mirror `PaymentsYourMoney.tsx` (Card + appearance + mounted-gate + Skeleton). |
| Onboarding state booleans + Open-Stripe + refetch | `useStripeConnect` (`src/hooks/useStripeConnect.ts`) | `{has_account, onboarding_complete, payouts_enabled}`, `statusLoading`, `connectError`, `handleOpenStripeDashboard`, `refetchStatus`. Already subscribes to `cleaner_profiles` realtime + handles the `stripe_return` URL param. |
| Embed instance | `useCleanerConnect` (`src/hooks/useCleanerConnect.ts`) | Client secret from `POST /api/stripe/connect/cleaner/start`; `enabled` gates cleaner role + `NEXT_PUBLIC_STRIPE_ENABLED` + key. Pass the redesign appearance (it hardcodes legacy yellow otherwise). |
| "Still clearing" rows | `useCleanerAwaitingPayments` (`src/hooks/useCleanerData.ts`) | `AwaitingPaymentRow[]` with `cleanerCut` (dollars, cut-only, privacy-safe) + `appointment.{homeownerName ('Company-paid' for self-pay), serviceName, scheduledDate}`. **Owns the single `payouts:cleaner:{userId}` realtime sub** that invalidates the awaiting key + `keys.stats.cleaner` + `keys.payouts.byCleaner`. Reuse verbatim; do NOT add a second payouts sub. |
| Activity counts | `useCleanerStats` (`src/hooks/useCleanerData.ts`) | Use only the **non-money** fields: `completedThisWeek`, `completedJobs`/`totalJobs`, `upcomingJobs`. Do NOT surface `totalEarnings`/`pendingPayouts`. |
| Timing note | `PayoutTimingNotice` (`src/components/PayoutTimingNotice.tsx`) | One-time dismissible; localStorage-persisted. |
| $ formatting | `money2` (`src/components/redesign/payments/payments-presenters.tsx`) | Whole-dollars to `$1,234.56`. These paths are **dollars, not cents**. Apply `tabular-nums`. (Re-export into the cleaner folder if a cross-import feels wrong; do not pick a cents-based helper.) |
| Dates / labels | `job-presenters` (`src/components/redesign/cleaner/shared/job-presenters.ts`) | `formatCardDate`, `customerLabel`, etc. |
| Screen chrome | `src/components/ui/*` | `Card`, `Badge`/`StatusPill`, `EmptyState`, `Skeleton`, `Button`, `Separator`, and the count tiles (StatTile or a small local tile). No raw hex, no legacy `gray-*` one-offs. |

**Do NOT use `useCleanerPayouts` (`src/hooks/useCleanerData.ts`).** It is currently dead code and its `amount` is the **full customer charge** joined with the homeowner name. Rendering it raw would leak the customer charge to a `payout_only` cleaner (migration 096). We keep payout history on the Stripe embed and never build a native per-job payout-history list in this slice.

## 6. Privacy

The screen is **payout-only-safe by construction**: every money figure is either Stripe's own (the cleaner's connected-account balance, which is inherently their money) or `cleanerCut` from `useCleanerAwaitingPayments` (already the cut, never the charge). We never render the customer charge or the payout percentage. This mirrors the `presentChargeProjection` rule (omit, do not merely hide) by simply never sourcing a charge figure. (Known platform-level gap, out of scope: a cleaner's RLS still allows reading `payments.amount` directly in the browser; full DB-layer redaction is a separate, riskier payments-RLS change.)

## 7. Architecture (matches the redesign convention exactly)

Mirror `src/components/redesign/cleaner/today/` (page -> Container -> View -> derive + test):

- `src/app/(redesign)/app/cleaner-dashboard/earnings/page.tsx` — replace the stub body with `return <CleanerEarnings />`. Stays a 1-line server wrapper, no logic.
- `src/components/redesign/cleaner/earnings/CleanerEarnings.tsx` — **Container** (`"use client"`). Does ALL data fetching (`useStripeConnect`, `useCleanerConnect`, `useCleanerAwaitingPayments`, `useCleanerStats`), computes the derived view-model via `deriveEarnings()`, wires callbacks (open-Stripe), and renders `CleanerEarningsView`. Owns the Stripe embed mount so it survives any internal re-render.
- `src/components/redesign/cleaner/earnings/CleanerEarningsView.tsx` — **pure presentational**. Renders the branch for each state (loading / stripe-disabled / employee / not-set-up / pending / active / empty) from `ui/*` primitives. Receives the embed element (or a render prop) from the Container so the View stays presentational while the stateful embed lives in the Container (preserving the never-unmount invariant).
- `src/components/redesign/cleaner/earnings/deriveEarnings.ts` — **pure, React-free**: raw inputs (connect status, awaiting rows, stats, flags) -> typed `EarningsData` (named state enum + clearing rows view-model + activity counts + `isEmpty`). All branching logic lives here so it is unit-testable without rendering Stripe.
- `src/components/redesign/cleaner/earnings/deriveEarnings.test.ts` — Vitest, table-driven, with small `appt()`/`payment()`/`status()` factories (per the `create-tests` skill).
- `src/components/redesign/cleaner/earnings/earnings-types.ts` — `EarningsData` + the state enum. Import `CleanerStats` / `AwaitingPaymentRow` from `@/hooks/useCleanerData`; do not redefine.

**Nav is already wired:** the Earnings tab (`id: 'earnings'`, `DollarSign`, `/app/cleaner-dashboard/earnings`) exists in `cleaner-nav-items.ts`. No nav change.

## 8. Critical implementation invariants

- **Never unmount the Stripe embed once painted.** The `ConnectComponentsProvider` / `CleanerStripeConnect` must not unmount after first render, or the bank-link popup loses `window.opener` and loops on "Select an account for payouts." Reuse `shouldShowCleanerConnectSkeleton`; do not toggle `statusLoading` after first load. The embed lives in the Container, not behind a branch that mounts/unmounts as data loads.
- **Onboarding mounts on demand; the payouts table never unmounts.** The not-set-up / pending states show our framing card first and reveal the embedded `ConnectAccountOnboarding` on the button press (mounting on click is the proven legacy behavior and predates any painted payouts table, so the popup invariant does not apply yet). Once a cleaner is `active` and the `ConnectPayouts` table has painted, it stays mounted. The plan must decide whether the `active` path reuses `CleanerStripeConnect` wholesale or composes the embed pieces directly while keeping our `inactive`/`pending` framing cards; either way the `ConnectComponentsProvider` instance from `useCleanerConnect` is shared so onboarding and payouts do not double-initialize.
- **Exactly one `payouts:cleaner:{userId}` realtime sub** exists, inside `useCleanerAwaitingPayments`. Identical `channelName` dedups, so mounting these hooks alongside the legacy dashboard is safe; do not add a second payouts subscription.
- **Reduced motion:** any `AnimatedNumber` / count-up and the `.redesign` reduced-motion CSS neutralize automatically; nothing extra required.

## 9. UI implementation and styling source (contract)

The browser-companion mockups produced during this brainstorm are **UX/structure reference ONLY.** Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft "pillowy" shadows, the rounded scale). Do **not** copy ad-hoc colors, raw hex, or bespoke classes from a mockup (the amber "Clearing" tone and the dashed embed box in the sketches are placeholders, not design decisions). Status/urgency is signaled with the **Badge/StatusPill vocabulary**, never decorative stripes. If a needed pattern has no primitive yet, build it as a reusable primitive that matches the system. Run `ui-feature-workflow` + `ui-ux-pro-max` at BOTH design and implementation per CLAUDE.md.

Copy rules: cleaner-facing copy says **"office," never "operator"**; **no em dashes** anywhere in UI copy (use a period, comma, parentheses, or "to"); `bank_paid` reads as "Paid out" (handled inside the embed/existing code).

## 10. Testing

- `deriveEarnings.test.ts` co-located, Vitest, table-driven: cover every state branch (stripe-disabled, employee, inactive/pending/active, empty, clearing present/absent, activity counts), the empty-vs-populated decision, and that no money aggregate leaks into the view-model.
- No new API routes are introduced (all reuse), so **no new `*.integration.test.ts`** unless an existing route is touched (it should not be).
- Visual verification with Playwright MCP against the worktree dev server (logged in as `cleaner@nexxus.com`), plus `ui-ux-pro-max` conformance at implementation. Send Bridger screenshots of the **built** screen (he is usually mobile, though this session is desktop).

## 11. Out of scope / deferred

- Native per-job payout-history list (Stripe embed is the history; avoids the `useCleanerPayouts` privacy footgun).
- Period (this week / this month) earnings **dollars** (the data only gives a count cleanly; Stripe owns money; not wanted).
- Full employee/hourly model Earnings (placeholder only; Slice 6 + its own brainstorm).
- Wiring the real `default_payout_model` into the app (Slice 6).
- DB-layer payments-RLS redaction of `payments.amount` for cleaners (separate, riskier change).
- "Message office" (Slice 5).

## 12. Ship

Flag-gated, its own PR off `master`. Local gates (`npm run test`, `npx tsc --noEmit`, `npm run lint`), Codex review on the finished branch, then a whole-branch review pass, then push + PR; merge when the 4 checks are green. Dollars not cents; no em dashes. Update `docs/superpowers/cleaner-app-status.md` + memory after merge.
