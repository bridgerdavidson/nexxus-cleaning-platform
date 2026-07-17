# Redesign + Stripe Cutover Runbook

Status: **draft for review** (audit run 2026-07-16 against master `065445f`).
Owner: Bridger. This is the ordered plan for making the redesign the production
default and finishing the Stripe multi-tenant cutover. Nothing in this document
executes automatically; every phase is a deliberate step with its own
verification and rollback.

Companion docs: `docs/stripe-architecture.md` (payment architecture + the
original cutover prerequisites), `docs/redesign/2026-07-09-functionality-audit.md`
(the finished audit checklist).

---

## 1. Current state, as actually observed (2026-07-16)

The audit inspected the code on master, the Vercel env for Production and
Preview, and the webhook dispatcher. Several findings **contradict the
documented rollout state** — read this table before trusting any older doc.

### 1.1 UI half

| Fact | Detail |
|---|---|
| Gate | `src/app/(redesign)/layout.tsx`: the whole `/app/*` tree 404s unless `NODE_ENV !== "production"` OR `VERCEL_ENV === "preview"` OR `NEXT_PUBLIC_REDESIGN_ENABLED === "true"`. Evaluated at **build time** (deliberately static for Link prefetch — PR #152). |
| Prod today | `NEXT_PUBLIC_REDESIGN_ENABLED` is **not set in any Vercel environment**. Production `/app/*` 404s; prod users have never seen the redesign. Previews always show it (the `VERCEL_ENV === "preview"` arm), which is why all preview testing worked without the var. |
| Landing logic | `getDashboardPath(role, { redesign })` (`src/lib/redesign/dashboardPath.ts`) branches every post-auth destination — login, accept-invite, reset-password, not-found — on the same flag. Flipping the one var repoints all of them at once. Platform admins bypass it (`isPlatformAdmin → /owner` at the login call site). |
| Legacy routes | `/admin-dashboard`, `/manager-dashboard`, `/cleaner-dashboard`, `/homeowner-dashboard` (1–2 files each), `/settings` (14 files, fully re-implemented in the redesign). **No redirects exist**: with the flag on, legacy routes stay reachable by URL. |
| Separation | Zero redesign imports from legacy page dirs; zero live legacy hrefs in redesign code (only a stale comment + an `activeFor: ["/settings"]` highlight alias in `nav-items.ts`). Deleting legacy page dirs breaks nothing in the redesign. |
| Shared keep-list | The redesign imports these from `src/components/*` outside `redesign/`: `WorkspaceErrorScreen`, `TenantStripeConnect`, `CleanerStripeConnect`, `settings/ManagerPermissionEditor`, `MessageAttachmentsLightbox`, `JobPhotoLightbox`, `HomeownerCardPicker`, `PayoutTimingNotice`, plus the shared data hooks (`useAdminData`, `useManagerData`, `useCleanerData`, `useHomeownerData`). **Do not delete these during legacy cleanup.** |
| Middleware | Host-based marketing rewrite only (`/` → `/landing` on `MARKETING_HOST`). No auth or redesign gating server-side; all route protection is client-side in layouts (same as legacy — not a cutover blocker, but a known hardening follow-up). |
| Root | `next.config.ts` redirects `/` → `/login` (temporary, host-excluded for marketing). |
| One-off repair tooling | Already deleted in the #68 security audit. Nothing to clean. The `(dev)` route group (ui-kit, `*-preview`) is dev scaffolding — optional Phase 4 cleanup. |

### 1.2 Stripe half

| Fact | Detail |
|---|---|
| Handlers | `dispatchStripeEvent.ts` **already implements all three "missing" events** (`transfer.reversed`, `payout.paid`, `payout.failed`) plus `payout.canceled` and the dispute/refund/subscription/fraud families — 26 event types total (§5.1). The doc's "add the missing prod webhook events" is a **Stripe-Dashboard config step, not code**. |
| Connect endpoint | The webhook route accepts a second secret (`STRIPE_CONNECT_WEBHOOK_SECRET`), set in **both** Preview and Production env — so a Connect-scoped endpoint likely already exists in the live dashboard. `payout.*` and `account.updated` arrive with `event.account` set only via a Connect endpoint; the handler logs a warning when it's missing. |
| Prod flags (observed) | `STRIPE_ENABLED=true`, `STRIPE_NEW_CHARGE_FLOW_ENABLED=true` (server **and** client), `NEXT_PUBLIC_STRIPE_TENANT_CONNECT_ENABLED=true` (client), but the **server `STRIPE_TENANT_CONNECT_ENABLED` row does not exist in Production**. `STRIPE_FEE_PASSTHROUGH_ENABLED=true`. ACH and self-pay off. |
| ⚠️ Split-flag state | This contradicts `docs/stripe-architecture.md` ("flags default off; the legacy platform-as-merchant path still runs in production until cutover") and the R6/R7 notes ("dormant in prod"). With `STRIPE_NEW_CHARGE_FLOW_ENABLED=true`, prod bookings run the **new** save-card/charge-at-completion lifecycle, and `chargeCompletedAppointment` returns `tenant_not_ready` for any org without a fully-onboarded Connect account — there is **no legacy fallback in that path**. Since the server tenant-connect flag is missing in prod, no org can even onboard there. Net: any real prod completion charge today would fail with `tenant_not_ready`. |
| Preview flags | Full new stack on: both tenant-connect flags + new charge flow + fee passthrough true. Matches how R6/R7 was live-tested on the dev preview. |

### 1.3 Open questions for Bridger (answer before Phase 2)

1. **Was `STRIPE_NEW_CHARGE_FLOW_ENABLED=true` in Production deliberate?** If prod
   has no real charge traffic yet, it's harmless but should be acknowledged; if
   there IS traffic, completions are currently failing `tenant_not_ready` and
   that's a live incident, not a cutover step.
2. **Tenant onboarding plan:** which real org(s) onboard to Connect at cutover,
   and who walks them through the embedded onboarding?
3. **Legacy soak window:** after the flag flip, do legacy dashboards stay
   reachable-by-URL for a soak period (recommended, Phase 3 makes them
   redirect), or hard-redirect immediately?
4. **`/owner`**: the owner back-office is being built in another session at
   top-level `/owner` (not flag-gated). Cutover does not depend on it, but
   Phase 4's legacy deletion should wait until the owner platform no longer
   needs any legacy page for reference.

---

## 2. Phase 0 — prerequisites (can run any time, no freeze)

- [ ] Merge or close all in-flight PRs that touch app code. At audit time only
      PR #150 (marketing, 2 files) was open. The other active sessions
      (email live-test, small UI fixes on `fix/ui-minor-fixes`, owner platform)
      each finish or reach a safe pause point.
- [ ] Land the pre-cutover hygiene PRs (tracked separately from this runbook):
      tsc baseline → 0 errors, then flip `continue-on-error: false` in CI
      (last, after all in-flight branches are type-clean); 049 RPC fallback
      removal; em-dash sweep; stale-comment sweep (`nav-items.ts` header).
- [ ] Verify Brevo SMTP env is live in Production (rows exist, added
      2026-07-16) with a real card-link email test — the email session owns this.
- [ ] Confirm answers to §1.3.

## 3. Phase 1 — Stripe readiness (server-side, invisible to users)

Do these in order; none of them changes user-facing behavior by itself.

- [ ] **1a. Add the missing Production env row**: `STRIPE_TENANT_CONNECT_ENABLED=true`
      (server flag; the client mirror is already true). This enables the tenant
      Connect onboarding routes in prod. Vercel env change → triggers rebuild on
      next deploy; no build-cache concern for server-only vars.
- [ ] **1b. Verify live-mode webhook endpoints** in the Stripe Dashboard
      (account `acct_1SnTq548N73Xa8rR`):
      - Platform endpoint (`STRIPE_WEBHOOK_SECRET`) subscribes to the §5.1
        platform list — the known-missing one is `transfer.reversed`.
      - Connect endpoint (`STRIPE_CONNECT_WEBHOOK_SECRET`) exists, points at
        the prod URL, "Listen to events on Connected accounts" is ON, and
        subscribes to `payout.paid`, `payout.failed`, `payout.canceled`,
        `account.updated`.
      - No Stripe CLI is installed on this machine and the MCP can't list
        endpoints, so this is a Dashboard (or live-key API) check.
- [ ] **1c. Onboard the real tenant org(s)** via Settings → embedded Connect
      onboarding (works once 1a ships). Confirm in the dashboard or DB:
      `organizations.stripe_connect_account_id` set and
      `stripe_connect_charges_enabled = true`. **Charges hard-fail
      `tenant_not_ready` without this.**
- [ ] **1d. Drain legacy in-flight payments**: list prod appointments created
      under the legacy upfront-PaymentIntent flow that are not yet settled;
      let them complete or manually settle before removing the legacy path
      (Phase 4). (If prod truly has no real payment traffic, record that and
      skip.)
- [ ] **1e. Cleaner payout accounts**: any `percentage_contractor` cleaners in
      the live org need their own Connect onboarding before their % can
      transfer; `settleCleanerPayout` parks the payout as pending otherwise
      (recoverable, not blocking).

**Rollback:** remove the env row added in 1a; webhook event additions are
harmless to leave (unhandled events log and return 200).

## 4. Phase 2 — the UI flip (the visible moment)

- [ ] **2a. Freeze**: no merges to master from any session between the final
      pre-flip deploy and the post-flip verification. Coordinate the three
      other sessions. The flip itself needs no code change, so the freeze can
      be short (an hour is plenty).
- [ ] **2b. Set `NEXT_PUBLIC_REDESIGN_ENABLED=true` in Production** (Vercel env,
      Production target only — Preview doesn't need it).
- [ ] **2c. Redeploy prod with a fresh build.** `NEXT_PUBLIC_*` is inlined at
      build time. Vercel invalidates the build cache when env vars change, but
      do NOT use any "redeploy with existing build cache" shortcut — a stale
      `.next` keeps the old inlined value (this bit us locally; see the
      tab-nav PR #152 notes). If in doubt, "Redeploy" → uncheck build cache.
- [ ] **2d. Verify (prod, real account each role):**
      - login as admin → lands on `/app/admin-dashboard`, all 11 tabs render;
      - cleaner → `/app/cleaner-dashboard`; homeowner → `/app/homeowner-dashboard`;
      - manager → `/app/admin-dashboard` with permission-filtered nav;
      - `/app/*` deep links no longer 404; legacy `/admin-dashboard` still
        renders (soak window, Phase 3 not applied yet);
      - accept-invite and reset-password land on `/app/*`;
      - booking detail sheet: payment section, photos, routing history;
      - platform admin login still lands on `/owner`.
- [ ] **2e. Watch** Vercel runtime logs + Supabase logs for 24–48h (auth
      redirects, 404 spikes, RLS errors from redesign-only queries).

**Rollback:** set the var to `""` (or delete it) and redeploy fresh. Users fall
back to legacy dashboards via the same `getDashboardPath` branch. No data or
schema involvement — the flip is purely which UI renders.

## 5. Phase 3 — repoint legacy routes (small code PR, after the soak)

Add permanent redirects so old bookmarks and muscle memory land in the
redesign: `/admin-dashboard` → `/app/admin-dashboard` (map `?tab=bookings|
payments|messages|settings|...` to the matching `/app/admin-dashboard/<tab>`),
`/manager-dashboard` → `/app/admin-dashboard`, `/cleaner-dashboard` →
`/app/cleaner-dashboard`, `/homeowner-dashboard` → `/app/homeowner-dashboard`,
`/settings/*` → `/app/admin-dashboard/settings`.

Implementation note: `next.config.ts` `redirects()` can branch on
`process.env.NEXT_PUBLIC_REDESIGN_ENABLED` at build time, so the PR can merge
**before** the flip and activate with it — previews (flag implicitly on) get
the redirects, local flag-off builds keep legacy reachable.

- [ ] PR: conditional redirects + e2e assertion that legacy URLs 308 to
      redesign routes when the flag is on.
- [ ] Keep the redirects for at least one release cycle before Phase 4.

### 5.1 Webhook event list (the config target for Phase 1b)

Platform endpoint: `payment_intent.succeeded`, `payment_intent.payment_failed`,
`payment_intent.processing`, `payment_intent.canceled`, `setup_intent.succeeded`,
`setup_intent.setup_failed`, `charge.refunded`, `charge.failed`,
`charge.dispute.created`, `charge.dispute.closed`, `application_fee.refunded`,
`transfer.reversed`, `refund.failed`, `refund.updated`,
`customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.payment_succeeded`,
`invoice.payment_failed`, `radar.early_fraud_warning.created`, `review.opened`,
`review.closed`.

Connect endpoint (events on connected accounts): `payout.paid`,
`payout.failed`, `payout.canceled`, `account.updated`.

Unsubscribed-but-handled events cost nothing; **subscribed-but-unhandled**
events log `Unhandled event type` and ack — also harmless. Err on subscribing
to the full list above.

## 6. Phase 4 — retirement (separate PRs, after the soak + redirects)

Order matters; each bullet is its own reviewable PR.

- [ ] **4a. Remove the legacy charge path** in
      `src/app/api/stripe/create-payment-intent/route.ts` (+ its client
      callers in legacy components). Only after Phase 1d confirms no legacy
      in-flight payments. This was the original cutover step 4 in
      `docs/stripe-architecture.md`.
- [ ] **4b. Delete legacy page dirs**: `src/app/{admin,manager,cleaner,
      homeowner}-dashboard`, `src/app/settings` — the redirects from Phase 3
      take over the URLs (move redirect handling out of the deleted pages if
      any was in-page). Verified safe: no redesign imports.
- [ ] **4c. Delete legacy-only components/hooks** that lose their last
      consumer in 4b (run `npx tsc --noEmit` + lint to find orphans;
      the §1.1 shared keep-list stays).
- [ ] **4d. Simplify the gates**: remove the `(redesign)/layout.tsx` 404 gate +
      `redesignUiEnabled()` + the `getDashboardPath` legacy branches, and
      retire `NEXT_PUBLIC_REDESIGN_ENABLED` from Vercel. The redesign is just
      "the app" now.
- [ ] **4e. Optional cleanup**: `(dev)` route group, `activeFor: ["/settings"]`
      alias, stale rollout comments, `docs/stripe-architecture.md` rollout
      note rewritten to describe the post-cutover state.

**Rollback:** 4a–4d are git reverts; nothing schema-level. That's why they're
separate PRs.

## 7. Coordination with concurrent sessions

- The flip (Phase 2) is env-only: safe while other sessions have branches in
  flight, but freeze merges during the flip window so a bad deploy is
  unambiguous.
- Phase 3/4 PRs conflict with ANY session editing legacy pages or shared
  components — schedule them when other sessions are idle or scoped to
  redesign/marketing/owner files.
- The owner platform session's work is orthogonal (top-level `/owner`, not
  flag-gated); only Phase 4b/4c need a check that the owner build doesn't
  reference legacy pages.
