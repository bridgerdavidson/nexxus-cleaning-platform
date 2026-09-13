# Phase 1b billing core (PRs D and E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every organization a billing state that the server enforces, and give its owner a Stripe subscription they can buy, change, and manage, with the whole paywall dark behind a flag until ops flips it.

**Architecture:** One migration adds the billing columns to `organizations` and comps every pre-existing org. A pure function `deriveBillingAccess` turns those columns into exactly one definition of "frozen", and a guard built on it returns `402` from the write routes Phase 1a created. Stripe work sits behind the guard's seam: a plan catalog in TypeScript, eight Prices resolved by lookup key, Checkout for the first purchase, a single `subscriptions.update` for every later change, and webhook mirroring that treats Stripe as the source of truth for tier, period, and seat count.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres + service-role admin client), Stripe Billing (Checkout Sessions, Customer Portal, Subscriptions), Vitest, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-09-08-saas-billing-design.md`

**Predecessor:** `docs/superpowers/plans/2026-09-12-phase1a-write-routes.md` (PRs A, B, C, shipped as #270, #273, #274). Phase 1a moved every freeze-relevant browser write behind an API route. This plan installs the paywall in the seam it created.

## Global Constraints

Every task's requirements implicitly include this section.

- **Branches.** PR D is `feat/phase1b-billing-core`. PR E is `feat/phase1b-stripe-billing`, stacked on D via `gh stack`. Merge bottom-up. Never commit to `master`.
- **Flag.** `BILLING_ENFORCEMENT_ENABLED` (server) and `NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED` (client) default to off. With the server flag off, every guard added in this plan is a no-op that returns success without reading a row. Nothing in PRs D or E changes behavior in production until ops flips it.
- **Runtime.** Every route file that imports `supabaseAdmin` or Stripe declares `export const runtime = 'nodejs'`. Dynamic route params are `params: Promise<{ ... }>` and must be awaited (Next.js 16).
- **Stripe access.** Never `new Stripe()`. Use `getStripe()` from `src/lib/stripe.ts`, which throws unless `STRIPE_ENABLED === 'true'`. Every new Stripe SDK call lives in `src/lib/stripe/billing.ts` so integration tests can `vi.mock('@/lib/stripe/billing')`; the global integration setup already stubs `getStripe()` to throw.
- **Never pass `payment_method_types`** to any Stripe call. Stripe selects eligible methods dynamically from Dashboard settings.
- **Service role is never gated.** `src/lib/billing/guard.ts` must never be imported, directly or transitively, by `src/lib/payments/**`, `src/app/api/cron/**`, or `src/app/api/stripe/webhook/**`. Task D6 adds a unit test that enforces this in CI.
- **Migrations.** Create with `npx supabase migration new <name>`; never hand-number. Write idempotently (`IF NOT EXISTS`, `DROP ... IF EXISTS` before `CREATE`, `ON CONFLICT`), because the shared dev database may apply a migration more than once during reconciliation. Never move or rename a migration after it has been pushed. Run `npx supabase db reset` locally before pushing any branch that adds one.
- **Copy.** No em dashes in any user-facing string: route error messages, toasts, UI text. Use a period, a comma, parentheses, or the word "to" for ranges.
- **Money numbers are cents, integers.** The catalog stores cents. Never store a float dollar amount.
- **Pricing is owned by the brain doc** `~/ai-os/projects/nexxus-service-solutions/strategy-decisions/2026-07-26-pricing-decision.md`. The numbers in `src/lib/billing/plans.ts` mirror it. Changing one requires a logged decision there first.
- **Tests.** Every new route gets a co-located `*.integration.test.ts`. Every new pure function in `src/lib/**` gets a co-located `*.test.ts`. Before pushing: `npm run test`, `npx tsc --noEmit`, `npm run lint`.
- **Commit trailer.** Every commit ends with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
  ```

---

## Plan-time rulings

Research against the live codebase (2026-09-13) contradicted six assumptions in the spec. Each is ruled here so no task has to stop and ask. Anything marked **spec correction** should be folded back into the spec in a later docs commit.

**R1. `integration_identifier` is dropped from Phase 1.** *(spec correction, §10 and locked decision 10)*
The installed SDK is `stripe@20.1.2` and `src/lib/stripe.ts:22` pins `apiVersion: '2025-12-15.clover'`. The parameter requires API version `2026-03-25.dahlia` or later and is absent from the installed type definitions. Getting it means bumping the SDK two majors and moving the pinned API version, which changes request and response behavior for every charge, transfer, Connect, and payout call in a live payments system. That regression risk is not worth a Dashboard analytics label. The other half of decision 10, the `checkout.session.completed` audit row capturing `session_id` and `amount_total`, ships as specified. Adding `integration_identifier` becomes a named follow-up attached to a future SDK-upgrade PR that carries its own payments regression pass.
*Cost if wrong:* checkout flows cannot be compared by label in the Stripe Dashboard until that upgrade lands. No functional loss.

**R2. Only `pending` invites reserve a seat.** *(resolves spec §22 item 3)*
`inv_status` is an enum with seven values (`pending`, `accepted`, `revoked`, `expired`, `creating`, `superseded`, `failed`, defined in `supabase/migrations/000_baseline.sql`). `creating` is a transient state during invite creation with no mechanism to clear a stuck row, so counting it would let one failed send consume a seat permanently. `pending` is also the value the partial unique index `idx_invites_one_pending_per_org_email` is built on. The seat count therefore counts `status = 'pending'` only. Spec §9 already accepts a small over-cap race, and this choice sits on the same side of that trade.
*Cost if wrong:* a burst of simultaneous invites can leave an org one or two seats over its cap until someone leaves. Billing is unaffected, because billing counts purchased seats, not used ones.

**R3. `src/lib/settings.ts` is dead code and gets no `billing` entry.** *(resolves spec §22 item 2)*
It exports `SETTINGS_SECTIONS` and has zero importers outside its own test. The live list the app renders is `REDESIGN_SETTINGS_SECTIONS` in `src/components/redesign/settings/sections.ts`, which only mentions the legacy file in a comment. PR F registers the Billing section there. Neither D nor E touches either file.
*Cost if wrong:* none in D or E. If some unfound consumer exists, the Billing nav item fails to appear in PR F, which is visible the moment F is opened in a browser.

**R4. `withTestOrg()` gains billing options and defaults to an open trial.** *(new; the spec did not consider the fixture)*
`tests/helpers/fixtures.ts` inserts an `organizations` row with no `subscription_status`, so after this migration a fresh test org would carry the column default. Under §7 a `none` status is treated as `trial_expired`, which is frozen. Every integration test in the repo would start failing the moment the flag is on. The fixture therefore stamps `subscription_status: 'trialing'` and `trial_ends_at = now + 14 days` by default, mirroring real provisioning, and accepts an optional `billing` override so a test can put an org into any state deliberately.
*Cost if wrong:* if the default were chosen badly, guard tests would pass for the wrong reason. Task D11 asserts the default explicitly rather than relying on it.

**R5. `APP_URL` gets one strict accessor, and the portal-link fallback is a bug fixed in E.** *(resolves spec §22 item 6)*
There is no consistent pattern today. Two routes read bare `process.env.APP_URL` with no fallback and would build the literal string `"undefined/..."`. `src/app/api/stripe/billing/portal-link/route.ts:31` falls back to the hardcoded `'https://app.nexxus'`, which is not a resolvable domain. Task E4 adds `requireAppUrl()` in `src/lib/billing/appUrl.ts`, which returns `APP_URL` or `NEXT_PUBLIC_APP_URL` and throws a named error when neither is set, and repoints portal-link at it. Checkout success and cancel URLs use it. Fixing the other two bare readers is out of scope here and is listed as a follow-up.
*Cost if wrong:* a missing `APP_URL` turns into a clear 500 naming the variable instead of a Stripe redirect to a dead host. Ops step 1 in §20 already sets it.

**R6. `POST /api/billing/trial/extend` moves from PR E to PR D.** *(spec correction, §20 rollout table)*
The route makes no Stripe call. It reads and writes `trial_ends_at` and `trial_extended_at` and its entire correctness argument is `deriveBillingAccess`'s `canExtendTrial`, which PR D builds and unit-tests against fixed clocks. Keeping it in E would split one idea across two PRs and force E's reviewer to re-derive D's clock logic. PR D therefore owns the whole non-Stripe billing model; PR E owns everything that talks to the Stripe API.
*Cost if wrong:* PR D grows by one small route. PR E shrinks. No behavior differs, since the paywall that calls this route ships in PR F either way.

**R7. The seat-cap 409 on `send-invite` belongs to PR D.** *(spec correction, §20 rollout table)*
Spec §9 specifies the cap but the §20 table assigns it to neither D nor E. It needs `seatCap` from `deriveBillingAccess` and a count of members and pending invites, and it makes no Stripe call, so it belongs with the rest of the enforcement work in D.
*Cost if wrong:* none. It ships one PR earlier than an ambiguous reading would have put it, still behind the flag.

---

## File Structure

### PR D — billing core, no Stripe (`feat/phase1b-billing-core`)

| File | Change | Responsibility |
|---|---|---|
| `supabase/migrations/<ts>_saas_billing_phase1.sql` | Create | Org billing columns, `subscription_status` CHECK gains `unpaid`, the comp-every-pre-existing-org backfill, `platform_tenant_notes`, `platform_stats()` extension. |
| `src/lib/billing/plans.ts` (+ `.test.ts`) | Create | The plan catalog. Tiers, seat bounds, lookup keys, `planMonthlyCents`, `seatBounds`, `tierFor`. The single source of pricing truth. |
| `src/lib/billing/flags.ts` | Create | `billingEnforcementEnabled()`, `billingEnforcementUiEnabled()`, `billingTaxEnabled()`. Same shape as `src/lib/stripe/flags.ts`. |
| `src/lib/billing/access.ts` (+ `.test.ts`) | Create | `deriveBillingAccess`. One pure function, the only definition of "frozen". |
| `src/lib/billing/guard.ts` (+ `.test.ts`) | Create | `assertOrgWritable` and the 402 response body. The invariant test that the service-role paths never import it. |
| `src/lib/billing/seats.ts` (+ `.test.ts`) | Create | `countSeatsInUse` and the seat-cap decision, shared by `send-invite` and (later) checkout. |
| `src/lib/auth/requireOrgAuth.ts` | Modify | Options gain `requireWritable?: boolean`. |
| `src/lib/auth/requireManagerPermission.ts` | Modify | Passes `requireWritable` through to `requireOrgAuth`. |
| `src/lib/catalog/authorizeCatalog.ts` | Modify | Passes `requireWritable: true` on the three catalog authorizers. |
| 16 route files under `src/app/api/**` | Modify | One guard call each, inserted immediately after the existing auth check. |
| `src/app/api/admin/send-invite/route.ts` | Modify | `assertOrgWritable` plus the seat-cap 409. |
| `src/app/api/billing/trial/extend/route.ts` (+ test) | Create | One-time 7-day self-serve trial extension. |
| `src/app/api/platform/organizations/route.ts` | Modify | Stamps `trial_ends_at` at org creation. |
| `src/lib/payments/orgBilling.ts` | Modify | `OrgSubscriptionStatus` and `mapSubscriptionStatus` gain `unpaid`. |
| `src/components/marketing/pricing.ts` | Modify | Re-exports from `src/lib/billing/plans.ts` so the marketing page and the billing engine cannot drift. Pro's bullet becomes "No seat limit". |
| `src/types/platform.ts` | Modify | `PlatformStats` gains the six new counters. |
| `src/lib/queryKeys.ts` | Modify | Adds the `billing` namespace. |
| `tests/helpers/fixtures.ts` | Modify | `withTestOrg()` billing defaults and overrides (ruling R4). |

### PR E — Stripe (`feat/phase1b-stripe-billing`, stacked on D)

| File | Change | Responsibility |
|---|---|---|
| `src/lib/billing/appUrl.ts` (+ `.test.ts`) | Create | `requireAppUrl()`. Strict, throws when unset (ruling R5). |
| `src/lib/billing/diffSubscriptionItems.ts` (+ `.test.ts`) | Create | Pure. Turns a current subscription plus a target plan into the `items` array for one `subscriptions.update`. |
| `src/lib/stripe/billing.ts` | Modify | `resolvePrices`, `resolvePortalConfiguration`, `createBillingCheckoutSession`, `updateSubscriptionItems`, `pauseSubscription`, `resumeSubscription`, `cancelSubscription(when)`. Every new Stripe SDK call. |
| `src/lib/payments/orgBilling.ts` | Modify | `appendBillingEvent`, `cancelOrgSubscription(when)`, `pauseOrgBilling`, `resumeOrgBilling`, `getOrgPortalLink` gains the configuration. Deletes `startOrgSubscription`. |
| `src/app/api/billing/checkout/route.ts` (+ test) | Create | First purchase. Never guarded. |
| `src/app/api/billing/plan/route.ts` (+ test) | Create | Every later change. Never guarded. Falls back to checkout when there is no live subscription. |
| `src/app/api/stripe/billing/portal-link/route.ts` | Modify | Uses the resolved portal configuration and `requireAppUrl()`. |
| `src/app/api/stripe/billing/subscriptions/start/**` | Delete | Route and its test. Two purchase paths is one too many. |
| `src/lib/payments/dispatchStripeEvent.ts` | Modify | `handleSubscriptionUpsert` mirrors tier, period, seats, `cancel_at`, pause. New `checkout.session.completed` handler. |
| `src/lib/payments/reconcile.ts` | Modify | `reconcileBillingMirror`, in the existing job shape. |
| `src/app/api/cron/reconcile-payments/route.ts` | Modify | Awaits the new job alongside the others. |
| `scripts/stripe-billing-setup.ts` | Create | Idempotent. Four Products, eight Prices, one Portal configuration. Run once per Stripe account. |

### Execution order

PR D is Tasks 1 to 12, then Task 12b opens it. PR E is Tasks 13 to 22, then Task 23 stacks and merges both.

---

# PR D — billing core

### Task 1: the migration

**Files:**
- Create: `supabase/migrations/<timestamp>_saas_billing_phase1.sql` (generate the name with `npx supabase migration new saas_billing_phase1`; never hand-number)
- Modify: `src/types/platform.ts:57-66` (the `PlatformStats` interface)

**Interfaces:**
- Consumes: nothing.
- Produces: on `organizations`, the columns `trial_ends_at`, `trial_extended_at`, `comped_at`, `plan_tier`, `billing_period`, `seat_count`, `subscription_cancel_at`, `billing_paused_at`, `billing_pause_resumes_at`. The table `platform_tenant_notes`. An extended `platform_stats()` returning six new counters. Every later task reads these columns.

**Context an implementer cannot infer:**
- `organizations.subscription_status` already exists as `text NOT NULL DEFAULT 'none'` (from `supabase/migrations/065_stripe_restructure.sql:49`) and its CHECK constraint is named `organizations_subscription_status_chk` (065:59-61). This migration must DROP that constraint by name and re-ADD it with `unpaid` included. Do not create a new constraint name.
- This codebase uses `text` plus a CHECK for status-like columns, never a Postgres ENUM. 065's header explains why: `ALTER TYPE ... ADD VALUE` cannot run in a transaction. Follow that convention.
- `platform_stats()` is `SECURITY DEFINER` with EXECUTE revoked from `public`, `anon`, and `authenticated`, and granted only to `service_role`. `CREATE OR REPLACE FUNCTION` preserves grants, but re-state the revokes and the grant at the end anyway so a fresh `db reset` is identical to a migrated database.
- MRR is deliberately not computed in SQL. Pricing lives in TypeScript. Do not add a money column to the stats function.

- [ ] **Step 1: Generate the migration file**

```bash
npx supabase migration new saas_billing_phase1
```

Note the generated filename. Every reference below to `<timestamp>` means the version prefix that command produced.

- [ ] **Step 2: Write the migration**

Write the whole file. The backfill's cutoff literal must be the migration's own version timestamp rendered as a timestamptz, so re-application on the shared dev database can never comp an organization created after this migration ran. For a version `20260913041500`, the literal is `'2026-09-13 04:15:00+00'`.

```sql
-- <timestamp>_saas_billing_phase1.sql
-- Phase 1b: SaaS subscription billing.
--
-- Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md §5.
--
-- Adds the billing columns the paywall derives access from, widens the
-- subscription_status CHECK to carry Stripe's `unpaid` (retries exhausted,
-- which freezes) as distinct from `past_due` (still retrying, which does not),
-- and comps every organization that predates this migration so no pilot tenant
-- can hit a trial wall when enforcement is switched on.
--
-- Idempotent: safe to apply more than once on the shared dev database.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. organizations — billing columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_ends_at             timestamptz,
  ADD COLUMN IF NOT EXISTS trial_extended_at         timestamptz,
  ADD COLUMN IF NOT EXISTS comped_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS plan_tier                 text,
  ADD COLUMN IF NOT EXISTS billing_period            text,
  ADD COLUMN IF NOT EXISTS seat_count                integer,
  ADD COLUMN IF NOT EXISTS subscription_cancel_at    timestamptz,
  ADD COLUMN IF NOT EXISTS billing_paused_at         timestamptz,
  ADD COLUMN IF NOT EXISTS billing_pause_resumes_at  timestamptz;

COMMENT ON COLUMN public.organizations.trial_ends_at IS
  'End of the free trial. Dormant while comped_at is set. "Trial expired" is derived, never stored.';
COMMENT ON COLUMN public.organizations.comped_at IS
  'Non-null = complimentary: no trial clock, no freeze, no seat cap. Doubles as the audit stamp.';
COMMENT ON COLUMN public.organizations.seat_count IS
  'Purchased seats, truthed from Stripe webhooks. Adding or removing a cleaner never changes it.';

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_plan_tier_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_plan_tier_chk
  CHECK (plan_tier IS NULL OR plan_tier IN ('starter','growth','pro'));

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_billing_period_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_billing_period_chk
  CHECK (billing_period IS NULL OR billing_period IN ('monthly','annual'));

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_seat_count_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_seat_count_chk
  CHECK (seat_count IS NULL OR seat_count > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. subscription_status — the CHECK gains 'unpaid'
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_subscription_status_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_subscription_status_chk
  CHECK (subscription_status IN ('none','trialing','active','past_due','unpaid','canceled'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.organizations
   SET subscription_status = 'trialing'
 WHERE subscription_status = 'none';

UPDATE public.organizations
   SET trial_ends_at = now() + interval '14 days'
 WHERE subscription_status = 'trialing'
   AND trial_ends_at IS NULL;

-- Every organization that predates this migration was hand-provisioned for the
-- pilot, so comp it: nothing can freeze on deploy or on the later flag flip.
-- The cutoff is this migration's own version timestamp, so a re-application on
-- the shared dev database never comps an org created after it.
UPDATE public.organizations
   SET comped_at = now()
 WHERE comped_at IS NULL
   AND created_at < '<this migration's version rendered as timestamptz>';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. platform_tenant_notes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.platform_tenant_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_tenant_notes_org_created_idx
  ON public.platform_tenant_notes (organization_id, created_at DESC);

-- RLS on with no policies: service-role only, through the platform routes.
-- Same posture as platform_audit_log.
ALTER TABLE public.platform_tenant_notes ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. platform_stats() — billing counters
-- ─────────────────────────────────────────────────────────────────────────────
--
-- MRR is deliberately absent: pricing lives in TypeScript (src/lib/billing/plans.ts)
-- and the platform organizations route computes it per org from the catalog.

CREATE OR REPLACE FUNCTION public.platform_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'tenants',
      (SELECT count(*) FROM organizations),
    'active_plans',
      (SELECT count(*) FROM organizations WHERE subscription_status = 'active'),
    'trialing',
      (SELECT count(*) FROM organizations WHERE subscription_status = 'trialing'),
    'payments_ready',
      (SELECT count(*) FROM organizations
         WHERE stripe_connect_charges_enabled AND stripe_connect_payouts_enabled),
    'platform_fees_cents',
      (SELECT (coalesce(sum(amount), 0) - coalesce(sum(refunded_amount), 0))::bigint
         FROM application_fees),
    'gmv_cents',
      (SELECT coalesce(round(sum(amount) * 100), 0)::bigint
         FROM payments WHERE status = 'paid' AND payment_type = 'revenue'),
    'total_appointments',
      (SELECT count(*) FROM appointments),
    'new_tenants_30d',
      (SELECT count(*) FROM organizations WHERE created_at > now() - interval '30 days'),
    'past_due',
      (SELECT count(*) FROM organizations WHERE subscription_status = 'past_due'),
    'unpaid',
      (SELECT count(*) FROM organizations WHERE subscription_status = 'unpaid'),
    'trial_expired',
      (SELECT count(*) FROM organizations
         WHERE comped_at IS NULL
           AND subscription_status = 'trialing'
           AND trial_ends_at IS NOT NULL
           AND trial_ends_at < now()),
    'trial_expiring_7d',
      (SELECT count(*) FROM organizations
         WHERE comped_at IS NULL
           AND subscription_status = 'trialing'
           AND trial_ends_at IS NOT NULL
           AND trial_ends_at >= now()
           AND trial_ends_at < now() + interval '7 days'),
    'comped',
      (SELECT count(*) FROM organizations WHERE comped_at IS NOT NULL),
    'paused',
      (SELECT count(*) FROM organizations WHERE billing_paused_at IS NOT NULL)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.platform_stats() FROM public;
REVOKE EXECUTE ON FUNCTION public.platform_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.platform_stats() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.platform_stats() TO service_role;
```

- [ ] **Step 3: Extend the `PlatformStats` type**

In `src/types/platform.ts`, the interface currently ends at `new_tenants_30d`. Add the six counters:

```ts
export interface PlatformStats {
  tenants: number;
  active_plans: number;
  trialing: number;
  payments_ready: number;
  platform_fees_cents: number;
  gmv_cents: number;
  total_appointments: number;
  new_tenants_30d: number;
  past_due: number;
  unpaid: number;
  trial_expired: number;
  trial_expiring_7d: number;
  comped: number;
  paused: number;
}
```

- [ ] **Step 4: Verify the schema rebuilds cleanly**

```bash
npx supabase db reset
```

Expected: completes with no error. Then confirm the migration is idempotent by applying it a second time against the running local database:

```bash
docker exec -i supabase_db_nexxus-cleaning-platform psql -U postgres -d postgres \
  -f /dev/stdin < supabase/migrations/<timestamp>_saas_billing_phase1.sql
```

Expected: no error. (The second run re-comps organizations, which is the documented fail-open behavior.)

- [ ] **Step 5: Verify the columns and the function**

```bash
docker exec -i supabase_db_nexxus-cleaning-platform psql -U postgres -d postgres -c \
  "select column_name from information_schema.columns
    where table_name='organizations' and column_name in
    ('trial_ends_at','trial_extended_at','comped_at','plan_tier','billing_period',
     'seat_count','subscription_cancel_at','billing_paused_at','billing_pause_resumes_at')
    order by column_name;"
```

Expected: all nine rows.

```bash
docker exec -i supabase_db_nexxus-cleaning-platform psql -U postgres -d postgres -c \
  "select public.platform_stats();"
```

Expected: a JSON object containing `past_due`, `unpaid`, `trial_expired`, `trial_expiring_7d`, `comped`, and `paused`.

- [ ] **Step 6: Run the migration-filename guard and the full suite**

```bash
npm run test -- validateMigrationFilenames
npx tsc --noEmit
```

Expected: the filename test passes (it enforces the timestamp scheme), and no new type errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/ src/types/platform.ts
git commit -m "$(cat <<'MSG'
feat(billing): organizations billing columns, comp backfill, tenant notes

Adds the columns the paywall derives access from, widens the
subscription_status CHECK to carry Stripe's `unpaid` (retries exhausted,
which freezes) as distinct from `past_due` (still retrying, which does not),
and comps every organization that predates this migration so no pilot tenant
can hit a trial wall when enforcement is switched on.

platform_stats() gains six billing counters. MRR stays out of SQL because
pricing lives in TypeScript.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 2: the plan catalog

**Files:**
- Create: `src/lib/billing/plans.ts`
- Test: `src/lib/billing/plans.test.ts`
- Modify: `src/components/marketing/pricing.ts` (re-export, and Pro's seat bullet)

**Interfaces:**
- Consumes: nothing.
- Produces: `PlanTier`, `BillingPeriod`, `PLANS`, `EXTRA_SEAT_MONTHLY_CENTS`, `EXTRA_SEAT_ANNUAL_CENTS`, `TRIAL_DAYS`, `TRIAL_EXTENSION_DAYS`, `TRIAL_SEAT_CAP`, `LOOKUP_KEYS`, `LookupKey`, `planMonthlyCents(tier, period, seatCount)`, `seatBounds(tier)`, `tierFor(lookupKey)`, `lookupKeyFor(tier, period)`, `seatLookupKeyFor(period)`. Tasks 4, 10, 12, and every PR E task consume these.

**Context an implementer cannot infer:**
- `src/components/marketing/pricing.ts` exists today and is the current source of these numbers. It has exactly two importers: `src/components/marketing/pricing.test.ts` and `src/components/marketing/PricingSection.tsx`, both importing `{ EXTRA_SEAT_PRICE, PRICING_TIERS, overCap, tierTotal, type BillingPeriod }`. Every one of those names must keep working after this task, with identical values, or the marketing page breaks.
- Its shape uses **dollars**, not cents, and calls the hard cap `cap` and the upgrade target `capNeeds`. The new catalog uses **cents** and calls the cap `maxSeats`. `pricing.ts` therefore keeps its own dollar-shaped view and derives it from the catalog rather than the reverse.
- **Eight Prices, not seven.** Stripe requires every item on one subscription to share a billing interval, so an annual subscription needs an annual seat Price. The annual seat price is $120/yr, which is 12 × $10 with no annual discount (confirmed with Bridger 2026-09-12, logged in the pricing doc addendum).
- Annual plans are **one upfront charge per year** ($348, $948, $1,668), not monthly billing on a twelve-month commitment. The per-month numbers are display only.
- Pro's marketing bullet changes from "Unlimited cleaner seats" to "No seat limit" (same addendum).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/billing/plans.test.ts
import { describe, expect, it } from 'vitest';
import {
  EXTRA_SEAT_ANNUAL_CENTS,
  EXTRA_SEAT_MONTHLY_CENTS,
  LOOKUP_KEYS,
  PLANS,
  TRIAL_DAYS,
  TRIAL_SEAT_CAP,
  lookupKeyFor,
  planMonthlyCents,
  seatBounds,
  seatLookupKeyFor,
  tierFor,
} from './plans';

describe('PLANS', () => {
  it('mirrors the locked pricing doc', () => {
    expect(PLANS.starter).toMatchObject({
      name: 'Starter', monthlyCents: 3900, annualMonthlyCents: 2900, includedSeats: 3, maxSeats: 5,
    });
    expect(PLANS.growth).toMatchObject({
      name: 'Growth', monthlyCents: 9900, annualMonthlyCents: 7900, includedSeats: 8, maxSeats: 15,
    });
    expect(PLANS.pro).toMatchObject({
      name: 'Pro', monthlyCents: 16900, annualMonthlyCents: 13900, includedSeats: 15, maxSeats: null,
    });
  });

  it('prices a seat at $10/mo and $120/yr', () => {
    expect(EXTRA_SEAT_MONTHLY_CENTS).toBe(1000);
    expect(EXTRA_SEAT_ANNUAL_CENTS).toBe(12000);
  });

  it('caps the trial at 15 seats for 14 days', () => {
    expect(TRIAL_SEAT_CAP).toBe(15);
    expect(TRIAL_DAYS).toBe(14);
  });
});

describe('planMonthlyCents', () => {
  it('is the base when seats are within the included count', () => {
    expect(planMonthlyCents('starter', 'monthly', 3)).toBe(3900);
    expect(planMonthlyCents('starter', 'monthly', 1)).toBe(3900);
    expect(planMonthlyCents('growth', 'annual', 8)).toBe(7900);
  });

  it('adds a seat price per extra seat', () => {
    expect(planMonthlyCents('starter', 'monthly', 5)).toBe(3900 + 2 * 1000);
    expect(planMonthlyCents('growth', 'monthly', 15)).toBe(9900 + 7 * 1000);
    expect(planMonthlyCents('pro', 'monthly', 20)).toBe(16900 + 5 * 1000);
  });

  it('prices annual extras at the annual seat rate divided across the year', () => {
    // $120/yr is $10/mo of display value, so the monthly-equivalent matches.
    expect(planMonthlyCents('pro', 'annual', 20)).toBe(13900 + 5 * 1000);
  });
});

describe('seatBounds', () => {
  it('runs from the included seats to the hard cap', () => {
    expect(seatBounds('starter')).toEqual({ min: 3, max: 5 });
    expect(seatBounds('growth')).toEqual({ min: 8, max: 15 });
  });

  it('leaves Pro open at the top', () => {
    expect(seatBounds('pro')).toEqual({ min: 15, max: null });
  });
});

describe('lookup keys', () => {
  it('lists all eight', () => {
    expect([...LOOKUP_KEYS].sort()).toEqual([
      'extra_seat_annual', 'extra_seat_monthly',
      'growth_annual', 'growth_monthly',
      'pro_annual', 'pro_monthly',
      'starter_annual', 'starter_monthly',
    ]);
  });

  it('round-trips a tier and period', () => {
    expect(lookupKeyFor('growth', 'annual')).toBe('growth_annual');
    expect(tierFor('growth_annual')).toEqual({ tier: 'growth', period: 'annual' });
    expect(seatLookupKeyFor('annual')).toBe('extra_seat_annual');
  });

  it('returns null for a seat key or an unknown key', () => {
    expect(tierFor('extra_seat_monthly')).toBeNull();
    expect(tierFor('enterprise_monthly')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:unit -- plans.test
```

Expected: FAIL, cannot resolve `./plans`.

- [ ] **Step 3: Write the catalog**

```ts
// src/lib/billing/plans.ts
//
// The single source of truth for SaaS plan pricing, importable from both server
// and client. src/components/marketing/pricing.ts re-exports from here so the
// pricing page and the billing engine cannot drift.
//
// Numbers mirror the locked brain doc
// ~/ai-os/projects/nexxus-service-solutions/strategy-decisions/2026-07-26-pricing-decision.md
// plus its 2026-09-12 addendum. Change one only with a logged decision there.

export type PlanTier = 'starter' | 'growth' | 'pro';
export type BillingPeriod = 'monthly' | 'annual';

export interface PlanDefinition {
  name: string;
  /** Sticker price per month when billed monthly. */
  monthlyCents: number;
  /** Sticker price per month when billed annually (charged once a year as 12x this). */
  annualMonthlyCents: number;
  includedSeats: number;
  /** Hard cap on purchasable seats; null = no limit. */
  maxSeats: number | null;
}

export const PLANS: Record<PlanTier, PlanDefinition> = {
  starter: { name: 'Starter', monthlyCents: 3900,  annualMonthlyCents: 2900,  includedSeats: 3,  maxSeats: 5 },
  growth:  { name: 'Growth',  monthlyCents: 9900,  annualMonthlyCents: 7900,  includedSeats: 8,  maxSeats: 15 },
  pro:     { name: 'Pro',     monthlyCents: 16900, annualMonthlyCents: 13900, includedSeats: 15, maxSeats: null },
};

export const PLAN_TIERS: PlanTier[] = ['starter', 'growth', 'pro'];

/** An extra cleaner seat, billed monthly. */
export const EXTRA_SEAT_MONTHLY_CENTS = 1000;
/** An extra cleaner seat, billed yearly. 12 x $10, no annual discount on seats. */
export const EXTRA_SEAT_ANNUAL_CENTS = 12000;

export const TRIAL_DAYS = 14;
export const TRIAL_EXTENSION_DAYS = 7;
/** Flat seat cap during a trial, regardless of which tier they end up buying. */
export const TRIAL_SEAT_CAP = 15;

/**
 * Eight Prices, not seven: Stripe requires every item on one subscription to
 * share a billing interval, so an annual subscription needs an annual seat Price.
 */
export const LOOKUP_KEYS = [
  'starter_monthly', 'starter_annual',
  'growth_monthly', 'growth_annual',
  'pro_monthly', 'pro_annual',
  'extra_seat_monthly', 'extra_seat_annual',
] as const;

export type LookupKey = (typeof LOOKUP_KEYS)[number];

/** The base Price lookup key for a tier at a billing period. */
export function lookupKeyFor(tier: PlanTier, period: BillingPeriod): LookupKey {
  return `${tier}_${period}` as LookupKey;
}

/** The extra-seat Price lookup key for a billing period. */
export function seatLookupKeyFor(period: BillingPeriod): LookupKey {
  return `extra_seat_${period}` as LookupKey;
}

/** The tier and period a base lookup key names, or null for a seat or unknown key. */
export function tierFor(lookupKey: string): { tier: PlanTier; period: BillingPeriod } | null {
  const match = /^(starter|growth|pro)_(monthly|annual)$/.exec(lookupKey);
  if (!match) return null;
  return { tier: match[1] as PlanTier, period: match[2] as BillingPeriod };
}

/** Purchasable seat range for a tier: [includedSeats, maxSeats]. */
export function seatBounds(tier: PlanTier): { min: number; max: number | null } {
  const plan = PLANS[tier];
  return { min: plan.includedSeats, max: plan.maxSeats };
}

/**
 * Display price per month: base plus one seat price for every seat above the
 * included count. Annual seats cost $120/yr, which is exactly $10/mo of display
 * value, so the monthly-equivalent arithmetic is the same for both periods.
 */
export function planMonthlyCents(tier: PlanTier, period: BillingPeriod, seatCount: number): number {
  const plan = PLANS[tier];
  const base = period === 'annual' ? plan.annualMonthlyCents : plan.monthlyCents;
  const extras = Math.max(0, seatCount - plan.includedSeats);
  const seatMonthly = period === 'annual' ? EXTRA_SEAT_ANNUAL_CENTS / 12 : EXTRA_SEAT_MONTHLY_CENTS;
  return base + extras * seatMonthly;
}

/** What Stripe actually charges per billing cycle: 12x the monthly view for annual. */
export function planChargeCents(tier: PlanTier, period: BillingPeriod, seatCount: number): number {
  const monthly = planMonthlyCents(tier, period, seatCount);
  return period === 'annual' ? monthly * 12 : monthly;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test:unit -- plans.test
```

Expected: PASS.

- [ ] **Step 5: Repoint the marketing pricing file at the catalog**

Rewrite `src/components/marketing/pricing.ts` so it derives from the catalog instead of restating the numbers. Every currently-exported name keeps its exact meaning and value. Keep the feature strings, changing only Pro's seat bullet.

```ts
// src/components/marketing/pricing.ts
//
// The marketing page's dollar-shaped view of the plan catalog. The numbers live
// in src/lib/billing/plans.ts (cents) so the pricing page and the billing engine
// cannot drift; this file only reshapes them and carries the marketing copy.

import {
  EXTRA_SEAT_MONTHLY_CENTS,
  PLANS,
  type PlanTier,
} from '@/lib/billing/plans';

export type BillingPeriod = 'annual' | 'monthly'

export interface PricingTier {
  name: string
  blurb: string
  /** Per-month sticker price at each billing period. */
  bases: Record<BillingPeriod, number>
  includedSeats: number
  /** Hard seat cap before an upgrade is required; null = unlimited. */
  cap: number | null
  /** Tier name shown in the over-cap state ("Needs Growth"). */
  capNeeds: string | null
  features: string[]
  popular?: boolean
}

export const EXTRA_SEAT_PRICE = EXTRA_SEAT_MONTHLY_CENTS / 100

const COPY: Record<PlanTier, { blurb: string; capNeeds: string | null; features: string[]; popular?: boolean }> = {
  starter: {
    blurb: '<keep the existing Starter blurb verbatim>',
    capNeeds: 'Growth',
    features: ['<keep all seven existing Starter feature strings verbatim>'],
  },
  growth: {
    blurb: '<keep the existing Growth blurb verbatim>',
    capNeeds: 'Pro',
    popular: true,
    features: ['<keep all six existing Growth feature strings verbatim>'],
  },
  pro: {
    blurb: '<keep the existing Pro blurb verbatim>',
    capNeeds: null,
    // "Unlimited cleaner seats" becomes "No seat limit" (pricing doc addendum 2026-09-12).
    features: ['<keep the other four existing Pro feature strings verbatim>', 'No seat limit'],
  },
}

function toTier(tier: PlanTier): PricingTier {
  const plan = PLANS[tier]
  const copy = COPY[tier]
  return {
    name: plan.name,
    blurb: copy.blurb,
    bases: { annual: plan.annualMonthlyCents / 100, monthly: plan.monthlyCents / 100 },
    includedSeats: plan.includedSeats,
    cap: plan.maxSeats,
    capNeeds: copy.capNeeds,
    features: copy.features,
    ...(copy.popular ? { popular: true } : {}),
  }
}

export const PRICING_TIERS: PricingTier[] = [toTier('starter'), toTier('growth'), toTier('pro')]

export function tierTotal(tier: PricingTier, period: BillingPeriod, cleaners: number): number {
  return tier.bases[period] + Math.max(0, cleaners - tier.includedSeats) * EXTRA_SEAT_PRICE
}

export function overCap(tier: PricingTier, cleaners: number): boolean {
  return tier.cap != null && cleaners > tier.cap
}
```

**Important:** the four `<keep ...>` placeholders above are instructions, not content. Open the current `src/components/marketing/pricing.ts`, copy each blurb and feature string across character for character, and delete the angle-bracket text. The only string that changes anywhere in this file is Pro's seat bullet. Do not reword a blurb, do not reorder a feature list, and do not introduce an em dash.

- [ ] **Step 6: Verify the marketing page is unchanged**

```bash
npm run test:unit -- pricing.test
npx tsc --noEmit
```

Expected: the existing `src/components/marketing/pricing.test.ts` passes untouched. If it fails, a number or a name drifted; fix the catalog mapping, not the test.

- [ ] **Step 7: Commit**

```bash
git add src/lib/billing/plans.ts src/lib/billing/plans.test.ts src/components/marketing/pricing.ts
git commit -m "$(cat <<'MSG'
feat(billing): plan catalog as the single source of pricing truth

src/lib/billing/plans.ts holds the tiers in cents, the eight Stripe lookup
keys, and the seat arithmetic. The marketing pricing file now derives its
dollar-shaped view from it instead of restating the numbers, so the pricing
page and the billing engine cannot drift.

Eight Prices, not seven: Stripe requires every item on a subscription to share
an interval, so annual plans need an annual seat price ($120/yr).

Pro's seat bullet becomes "No seat limit" per the 2026-09-12 pricing addendum.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 3: the enforcement flags

**Files:**
- Create: `src/lib/billing/flags.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `billingEnforcementEnabled()`, `billingEnforcementUiEnabled()`, `billingTaxEnabled()`. Task 6 and every guarded route consume the first; PR F consumes the second; PR E task 18 consumes the third.

**Context an implementer cannot infer:**
- This repo's flag convention is one small predicate function per flag, comparing to the string `"true"`, with a `NEXT_PUBLIC_` mirror for anything the client needs. See `src/lib/stripe/flags.ts` for the established shape and comment style.
- There is no test for this file. It is three one-line predicates and a test would only restate them.

- [ ] **Step 1: Write the file**

```ts
// src/lib/billing/flags.ts
/**
 * SaaS subscription billing rollout flags (default OFF until ops flips them).
 *
 * BILLING_ENFORCEMENT_ENABLED — gates the server-side paywall. While off, the
 *   402 guard on every write route returns success without reading a row, so
 *   PRs D through G ship dark.
 * BILLING_TAX_ENABLED — gates `automatic_tax` on Checkout Sessions and
 *   subscriptions. Stays off until Stripe Tax has an active registration,
 *   because without one Stripe silently collects nothing and returns no error.
 *
 * Each server flag has a NEXT_PUBLIC_* mirror so client components can hide the
 * billing UI while the server flag is still off (same pattern as
 * STRIPE_ENABLED / NEXT_PUBLIC_STRIPE_ENABLED).
 */

/** Server: the write-route paywall is live. */
export function billingEnforcementEnabled(): boolean {
  return process.env.BILLING_ENFORCEMENT_ENABLED === 'true';
}

/** Client: show the billing pill, banner, and paywall. */
export function billingEnforcementUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED === 'true';
}

/** Server: pass `automatic_tax` to Stripe. Requires an active Stripe Tax registration. */
export function billingTaxEnabled(): boolean {
  return process.env.BILLING_TAX_ENABLED === 'true';
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/billing/flags.ts
git commit -m "$(cat <<'MSG'
feat(billing): rollout flags for enforcement and tax

BILLING_ENFORCEMENT_ENABLED gates the paywall so PRs D through G ship dark.
BILLING_TAX_ENABLED gates automatic_tax, which must stay off until Stripe Tax
has an active registration (without one it silently collects nothing).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 4: `deriveBillingAccess`

**Files:**
- Create: `src/lib/billing/access.ts`
- Test: `src/lib/billing/access.test.ts`

**Interfaces:**
- Consumes: `TRIAL_SEAT_CAP` from `src/lib/billing/plans.ts` (Task 2).
- Produces: `BillingState`, `OrgBillingRow`, `BillingAccess`, `ORG_BILLING_COLUMNS`, `deriveBillingAccess(org, now)`. Tasks 6, 10, and 12 consume it, as do PR E's reconcile job and PR F's entire UI.

**Context an implementer cannot infer:**
- This is the only definition of "frozen" in the system. Server guard, client hook, banner, paywall, and back office all call it. Never re-derive freezing anywhere else.
- **Precedence is strict and ordered**: comped beats everything, then paused, then the trial clock, then the Stripe status. A comped organization with a live Stripe subscription is comped, and a comped organization whose trial expired long ago is comped.
- "Trial expired" is **derived from the clock, never stored**. No cron flips rows, so there is no stale window between a trial ending and the paywall appearing.
- `subscription_status = 'none'` cannot occur after Task 1's backfill and Task 11's provisioning change, but if it ever does it must be treated as `trial_expired`, which is frozen with a plan picker. Failing closed here is the safe direction: the org sees a way to pay rather than silently getting free service.
- `ORG_BILLING_COLUMNS` exists so every caller selects the same column list. Export it as a `const` string and use it in every `.select()`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/billing/access.test.ts
import { describe, expect, it } from 'vitest';
import { deriveBillingAccess, type OrgBillingRow } from './access';

const NOW = new Date('2026-09-13T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const row = (over: Partial<OrgBillingRow> = {}): OrgBillingRow => ({
  subscription_status: 'trialing',
  trial_ends_at: days(7),
  trial_extended_at: null,
  comped_at: null,
  plan_tier: null,
  billing_period: null,
  seat_count: null,
  subscription_cancel_at: null,
  billing_paused_at: null,
  billing_pause_resumes_at: null,
  ...over,
});

describe('deriveBillingAccess precedence', () => {
  it('puts comped above everything, including a canceled subscription', () => {
    const a = deriveBillingAccess(row({ comped_at: days(-30), subscription_status: 'canceled' }), NOW);
    expect(a.state).toBe('comped');
    expect(a.frozen).toBe(false);
    expect(a.seatCap).toBeNull();
  });

  it('keeps a comped org unfrozen even with a long-expired trial', () => {
    const a = deriveBillingAccess(row({ comped_at: days(-90), trial_ends_at: days(-60) }), NOW);
    expect(a.state).toBe('comped');
    expect(a.frozen).toBe(false);
  });

  it('puts paused above the Stripe status', () => {
    const a = deriveBillingAccess(row({ subscription_status: 'active', billing_paused_at: days(-2) }), NOW);
    expect(a.state).toBe('paused');
    expect(a.frozen).toBe(true);
  });

  it('lets comped win over paused', () => {
    const a = deriveBillingAccess(row({ comped_at: days(-1), billing_paused_at: days(-2) }), NOW);
    expect(a.state).toBe('comped');
    expect(a.frozen).toBe(false);
  });
});

describe('deriveBillingAccess trial clock', () => {
  it('is trialing while the clock runs', () => {
    const a = deriveBillingAccess(row({ trial_ends_at: days(7) }), NOW);
    expect(a.state).toBe('trialing');
    expect(a.frozen).toBe(false);
    expect(a.trialDaysLeft).toBe(7);
    expect(a.seatCap).toBe(15);
  });

  it('is still trialing in the final second', () => {
    const a = deriveBillingAccess(
      row({ trial_ends_at: new Date(NOW.getTime() + 1000).toISOString() }),
      NOW,
    );
    expect(a.state).toBe('trialing');
    expect(a.trialDaysLeft).toBe(1);
  });

  it('freezes the moment the clock passes', () => {
    const a = deriveBillingAccess(
      row({ trial_ends_at: new Date(NOW.getTime() - 1000).toISOString() }),
      NOW,
    );
    expect(a.state).toBe('trial_expired');
    expect(a.frozen).toBe(true);
    expect(a.trialDaysLeft).toBe(0);
  });

  it('rounds partial days up, so "0 days left" never shows on a live trial', () => {
    const a = deriveBillingAccess(
      row({ trial_ends_at: new Date(NOW.getTime() + 3 * 3_600_000).toISOString() }),
      NOW,
    );
    expect(a.trialDaysLeft).toBe(1);
  });

  it('offers the extension once and then never again', () => {
    expect(deriveBillingAccess(row({ trial_ends_at: days(2) }), NOW).canExtendTrial).toBe(true);
    expect(deriveBillingAccess(row({ trial_ends_at: days(-2) }), NOW).canExtendTrial).toBe(true);
    expect(
      deriveBillingAccess(row({ trial_ends_at: days(2), trial_extended_at: days(-1) }), NOW).canExtendTrial,
    ).toBe(false);
  });

  it('does not offer an extension to a paying or comped org', () => {
    expect(deriveBillingAccess(row({ subscription_status: 'active' }), NOW).canExtendTrial).toBe(false);
    expect(deriveBillingAccess(row({ comped_at: days(-1) }), NOW).canExtendTrial).toBe(false);
  });

  it('treats a trialing row with no end date as expired', () => {
    const a = deriveBillingAccess(row({ trial_ends_at: null }), NOW);
    expect(a.state).toBe('trial_expired');
    expect(a.frozen).toBe(true);
  });
});

describe('deriveBillingAccess Stripe statuses', () => {
  it.each([
    ['active',   'active',        false],
    ['past_due', 'past_due',      false],
    ['unpaid',   'unpaid',        true],
    ['canceled', 'canceled',      true],
  ] as const)('maps %s to %s (frozen: %s)', (status, state, frozen) => {
    const a = deriveBillingAccess(row({ subscription_status: status, seat_count: 8 }), NOW);
    expect(a.state).toBe(state);
    expect(a.frozen).toBe(frozen);
  });

  it('fails closed on `none` even when the trial clock is still live', () => {
    // The default row has a trial 7 days out. `none` must still freeze: it is an
    // impossible state after the backfill, and free service is the worse error.
    const a = deriveBillingAccess(row({ subscription_status: 'none' }), NOW);
    expect(a.state).toBe('trial_expired');
    expect(a.frozen).toBe(true);
  });

  it('keeps past_due unfrozen because Stripe is still retrying', () => {
    expect(deriveBillingAccess(row({ subscription_status: 'past_due' }), NOW).frozen).toBe(false);
  });
});

describe('deriveBillingAccess seat cap', () => {
  it('is unlimited when comped', () => {
    expect(deriveBillingAccess(row({ comped_at: days(-1) }), NOW).seatCap).toBeNull();
  });

  it('is the flat trial cap during and after a trial', () => {
    expect(deriveBillingAccess(row({ trial_ends_at: days(3) }), NOW).seatCap).toBe(15);
    expect(deriveBillingAccess(row({ trial_ends_at: days(-3) }), NOW).seatCap).toBe(15);
  });

  it('is what they purchased once they are paying', () => {
    expect(deriveBillingAccess(row({ subscription_status: 'active', seat_count: 12 }), NOW).seatCap).toBe(12);
  });

  it('falls back to the trial cap when a paying org has no seat count yet', () => {
    expect(deriveBillingAccess(row({ subscription_status: 'active', seat_count: null }), NOW).seatCap).toBe(15);
  });
});

describe('deriveBillingAccess after an un-comp', () => {
  it('lands in an open trial, never frozen', () => {
    // The exact row shape the back office writes: comp cleared, runway stamped.
    const a = deriveBillingAccess(
      row({ comped_at: null, subscription_status: 'trialing', trial_ends_at: days(14) }),
      NOW,
    );
    expect(a.state).toBe('trialing');
    expect(a.frozen).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:unit -- access.test
```

Expected: FAIL, cannot resolve `./access`.

- [ ] **Step 3: Write the state machine**

```ts
// src/lib/billing/access.ts
//
// The one definition of "frozen" in the system. The server guard, the client
// hook, the banner, the paywall, and the back office all call this. Never
// re-derive freezing anywhere else.
//
// Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md §7.

import { TRIAL_SEAT_CAP, type BillingPeriod, type PlanTier } from './plans';

export type BillingState =
  | 'comped'
  | 'paused'
  | 'trialing'
  | 'trial_expired'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled';

export type OrgSubscriptionStatus =
  | 'none' | 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled';

/** The organizations columns billing access is derived from. */
export interface OrgBillingRow {
  subscription_status: OrgSubscriptionStatus | string;
  trial_ends_at: string | null;
  trial_extended_at: string | null;
  comped_at: string | null;
  plan_tier: PlanTier | string | null;
  billing_period: BillingPeriod | string | null;
  seat_count: number | null;
  subscription_cancel_at: string | null;
  billing_paused_at: string | null;
  billing_pause_resumes_at: string | null;
}

/**
 * Every caller selects the same columns. Use this in every `.select()` that
 * feeds deriveBillingAccess so a new column is added in exactly one place.
 */
export const ORG_BILLING_COLUMNS =
  'subscription_status, trial_ends_at, trial_extended_at, comped_at, plan_tier, ' +
  'billing_period, seat_count, subscription_cancel_at, billing_paused_at, billing_pause_resumes_at';

export interface BillingAccess {
  state: BillingState;
  frozen: boolean;
  /** Whole days remaining, rounded up. Null unless trialing or trial_expired. */
  trialDaysLeft: number | null;
  /** True when the one-time self-serve 7-day extension is still available. */
  canExtendTrial: boolean;
  /** Maximum cleaner seats. Null = no limit (comped only). */
  seatCap: number | null;
}

const FROZEN_STATES: ReadonlySet<BillingState> = new Set<BillingState>([
  'paused', 'trial_expired', 'unpaid', 'canceled',
]);

function daysLeft(trialEndsAt: string | null, now: Date): number {
  if (!trialEndsAt) return 0;
  const remaining = new Date(trialEndsAt).getTime() - now.getTime();
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  // Round up so a trial with three hours left reads "1 day left", never "0".
  return Math.ceil(remaining / 86_400_000);
}

export function deriveBillingAccess(org: OrgBillingRow, now: Date): BillingAccess {
  // Precedence is strict: comp beats everything, then pause, then the trial
  // clock, then whatever Stripe last told us.
  if (org.comped_at) {
    return { state: 'comped', frozen: false, trialDaysLeft: null, canExtendTrial: false, seatCap: null };
  }

  if (org.billing_paused_at) {
    return {
      state: 'paused',
      frozen: true,
      trialDaysLeft: null,
      canExtendTrial: false,
      seatCap: org.seat_count ?? TRIAL_SEAT_CAP,
    };
  }

  // `none` cannot occur after the Phase 1b backfill and the provisioning stamp.
  // If it ever does, fail closed into the paywall regardless of what the trial
  // clock says: the org sees a plan picker rather than silently receiving free
  // service. Spec §7 states this outcome unconditionally.
  if (org.subscription_status === 'none') {
    return {
      state: 'trial_expired',
      frozen: true,
      trialDaysLeft: 0,
      canExtendTrial: org.trial_extended_at == null,
      seatCap: TRIAL_SEAT_CAP,
    };
  }

  const status = org.subscription_status;

  if (status === 'trialing') {
    const left = daysLeft(org.trial_ends_at, now);
    const live = org.trial_ends_at != null && left > 0;
    return {
      state: live ? 'trialing' : 'trial_expired',
      frozen: !live,
      trialDaysLeft: left,
      canExtendTrial: org.trial_extended_at == null,
      seatCap: TRIAL_SEAT_CAP,
    };
  }

  const state: BillingState =
    status === 'active' ? 'active'
    : status === 'past_due' ? 'past_due'
    : status === 'unpaid' ? 'unpaid'
    : 'canceled';

  return {
    state,
    frozen: FROZEN_STATES.has(state),
    trialDaysLeft: null,
    canExtendTrial: false,
    seatCap: org.seat_count ?? TRIAL_SEAT_CAP,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test:unit -- access.test
```

Expected: PASS, every case.

- [ ] **Step 5: Commit**

```bash
git add src/lib/billing/access.ts src/lib/billing/access.test.ts
git commit -m "$(cat <<'MSG'
feat(billing): deriveBillingAccess, the one definition of frozen

A pure function over the organization's billing columns, unit-tested against
fixed clocks. Precedence is strict: comp beats everything, then pause, then the
trial clock, then the Stripe status.

Trial expiry is derived from the clock rather than stored, so no cron flips
rows and there is no stale window between a trial ending and the paywall
appearing. A `none` status fails closed into the paywall.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 5: `unpaid` becomes its own status

**Files:**
- Modify: `src/lib/payments/orgBilling.ts:15-38`
- Test: `src/lib/payments/orgBilling.test.ts` (exists; add cases)

**Interfaces:**
- Consumes: `OrgSubscriptionStatus` from `src/lib/billing/access.ts` (Task 4).
- Produces: `mapSubscriptionStatus` now yields `'unpaid'`. PR E's webhook handler depends on this.

**Context an implementer cannot infer:**
- Today `mapSubscriptionStatus` collapses Stripe's `unpaid` into `past_due` (orgBilling.ts:28-30). That collapse is exactly what this phase undoes: `past_due` means Stripe is still retrying and only shows a banner, while `unpaid` means retries are exhausted and the organization freezes. Keeping them merged would freeze tenants Stripe is still trying to charge.
- Task 1's migration already widened the CHECK constraint, so writing `'unpaid'` is now legal.
- `OrgSubscriptionStatus` is currently declared in `orgBilling.ts:15` and has **no importers anywhere in `src/`**. Task 4 declared the same union in `access.ts`. Delete the `orgBilling.ts` declaration and re-export the one from `access.ts`, so there is a single definition.
- `orgBilling.ts` also declares a module-local `interface OrgBillingRow` at line 40 with a completely different shape (`id`, `name`, `billing_email`, `stripe_customer_id`, `subscription_id`). It is not exported and must not be confused with the one `access.ts` exports. Leave it alone.
- Stripe's `paused` subscription status is unrelated to this codebase's `paused` billing state, which comes from `pause_collection`. `mapSubscriptionStatus` must keep sending Stripe's `paused` to `none`, not to the new value.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/payments/orgBilling.test.ts`:

```ts
describe('mapSubscriptionStatus unpaid', () => {
  it('keeps unpaid distinct from past_due', () => {
    expect(mapSubscriptionStatus('past_due')).toBe('past_due');
    expect(mapSubscriptionStatus('unpaid')).toBe('unpaid');
  });

  it('still collapses the states that have no row value', () => {
    expect(mapSubscriptionStatus('incomplete')).toBe('none');
    expect(mapSubscriptionStatus('paused')).toBe('none');
    expect(mapSubscriptionStatus(null)).toBe('none');
    expect(mapSubscriptionStatus('something_new')).toBe('none');
  });

  it('still maps the terminal states to canceled', () => {
    expect(mapSubscriptionStatus('canceled')).toBe('canceled');
    expect(mapSubscriptionStatus('incomplete_expired')).toBe('canceled');
  });
});
```

If the existing test file already asserts `mapSubscriptionStatus('unpaid') === 'past_due'`, change that assertion to `'unpaid'` rather than leaving two contradictory expectations.

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:unit -- orgBilling.test
```

Expected: FAIL on the `unpaid` case, which currently returns `'past_due'`.

- [ ] **Step 3: Make the change**

Replace `src/lib/payments/orgBilling.ts:15-38` with:

```ts
export type { OrgSubscriptionStatus } from '@/lib/billing/access';
import type { OrgSubscriptionStatus } from '@/lib/billing/access';

/**
 * Collapse any Stripe subscription status into one our
 * `organizations_subscription_status_chk` constraint allows
 * (none | trialing | active | past_due | unpaid | canceled). Unknown or initial
 * states map to a sensible allowed value so a webhook can never violate the
 * constraint.
 *
 * `past_due` and `unpaid` are deliberately NOT merged: past_due means Stripe is
 * still retrying and only shows a banner, unpaid means retries are exhausted and
 * the organization freezes. Stripe's own `paused` status is unrelated to this
 * app's paused state, which is derived from pause_collection, so it stays `none`.
 */
export function mapSubscriptionStatus(stripeStatus: string | null | undefined): OrgSubscriptionStatus {
  switch (stripeStatus) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'unpaid':
      return 'unpaid';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    // 'incomplete', 'paused', null/undefined, or anything unrecognized → not yet active.
    default:
      return 'none';
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test:unit -- orgBilling.test
npx tsc --noEmit
```

Expected: PASS, no new type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/orgBilling.ts src/lib/payments/orgBilling.test.ts
git commit -m "$(cat <<'MSG'
feat(billing): unpaid is its own status, no longer collapsed into past_due

past_due means Stripe is still retrying, which only warrants a banner. unpaid
means retries are exhausted, which freezes the organization. Merging them would
freeze tenants Stripe is still trying to charge.

OrgSubscriptionStatus now has one definition, in src/lib/billing/access.ts.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 6: the guard

**Files:**
- Create: `src/lib/billing/guard.ts`
- Test: `src/lib/billing/guard.test.ts`
- Modify: `src/lib/auth/requireOrgAuth.ts`
- Modify: `src/lib/auth/requireManagerPermission.ts`

**Interfaces:**
- Consumes: `deriveBillingAccess`, `ORG_BILLING_COLUMNS` (Task 4); `billingEnforcementEnabled` (Task 3).
- Produces: `assertOrgWritable(supabaseAdmin, organizationId)` returning `{ ok: true } | { ok: false; response: NextResponse }`, and `RequireOrgAuthOptions.requireWritable?: boolean`. Tasks 7, 8, 9, and 10 consume both.

**Context an implementer cannot infer:**
- `requireOrgAuth` lives at `src/lib/auth/requireOrgAuth.ts:32-75`. Its options type is `RequireOrgAuthOptions { allowedRoles?: OrgRole[] }` and it returns a discriminated union `RequireOrgAuthResult = { ok: true; userId; email; role } | { ok: false; response: NextResponse }`. The new flag goes on the options type, and the check runs **after** the membership and role checks so an outsider still gets 403 rather than a 402 that leaks whether the org is paying.
- `requireManagerPermission` (`src/lib/auth/requireManagerPermission.ts:19-47`) calls `requireOrgAuth` first, then checks the manager flag. Pass `requireWritable` straight through in that first call, so the billing check happens before the flag lookup and a frozen org does not also pay for a `manager_permissions` query.
- **With the flag off, `assertOrgWritable` must return `{ ok: true }` without querying.** This is what makes PRs D through G ship dark, and a reviewer will check for it specifically.
- The 402 body shape is fixed by the spec and the client depends on it: `{ error: 'billing_frozen', state, trial_ends_at, can_extend_trial }`.
- A missing organization row is **not** a billing failure. Return `{ ok: true }` and let the route's own lookup produce its 404, otherwise a bad id turns into a confusing 402.
- A database error while loading billing columns must **fail open** with `{ ok: true }`. A transient Supabase blip must never freeze every tenant at once. Log it instead.
- `NextResponse` is imported from `next/server`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/billing/guard.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assertOrgWritable } from './guard';

const ORG = '11111111-1111-4111-8111-111111111111';

/** Minimal stub with the `.from().select().eq().maybeSingle()` chain the guard uses. */
function stubDb(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, from, select, eq, maybeSingle };
}

const trialingRow = (trialEndsAt: string) => ({
  data: {
    subscription_status: 'trialing',
    trial_ends_at: trialEndsAt,
    trial_extended_at: null,
    comped_at: null,
    plan_tier: null,
    billing_period: null,
    seat_count: null,
    subscription_cancel_at: null,
    billing_paused_at: null,
    billing_pause_resumes_at: null,
  },
  error: null,
});

describe('assertOrgWritable with the flag off', () => {
  beforeEach(() => { delete process.env.BILLING_ENFORCEMENT_ENABLED; });

  it('returns ok without touching the database', async () => {
    const db = stubDb(trialingRow(new Date(Date.now() - 86_400_000).toISOString()));
    const result = await assertOrgWritable(db.client, ORG);
    expect(result.ok).toBe(true);
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe('assertOrgWritable with the flag on', () => {
  beforeEach(() => { process.env.BILLING_ENFORCEMENT_ENABLED = 'true'; });
  afterEach(() => { delete process.env.BILLING_ENFORCEMENT_ENABLED; });

  it('allows a live trial', async () => {
    const db = stubDb(trialingRow(new Date(Date.now() + 7 * 86_400_000).toISOString()));
    expect((await assertOrgWritable(db.client, ORG)).ok).toBe(true);
  });

  it('refuses an expired trial with 402 and the documented body', async () => {
    const endedAt = new Date(Date.now() - 86_400_000).toISOString();
    const db = stubDb(trialingRow(endedAt));
    const result = await assertOrgWritable(db.client, ORG);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(402);
    await expect(result.response.json()).resolves.toEqual({
      error: 'billing_frozen',
      state: 'trial_expired',
      trial_ends_at: endedAt,
      can_extend_trial: true,
    });
  });

  it('allows a comped org whose trial ended long ago', async () => {
    const db = stubDb({
      data: { ...trialingRow('2020-01-01T00:00:00Z').data, comped_at: '2020-01-01T00:00:00Z' },
      error: null,
    });
    expect((await assertOrgWritable(db.client, ORG)).ok).toBe(true);
  });

  it('refuses a paused org', async () => {
    const db = stubDb({
      data: {
        ...trialingRow(new Date(Date.now() + 86_400_000).toISOString()).data,
        subscription_status: 'active',
        billing_paused_at: '2026-09-01T00:00:00Z',
      },
      error: null,
    });
    const result = await assertOrgWritable(db.client, ORG);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(402);
  });

  it('fails open when the organization row is missing', async () => {
    const db = stubDb({ data: null, error: null });
    expect((await assertOrgWritable(db.client, ORG)).ok).toBe(true);
  });

  it('fails open when the query errors, so a database blip cannot freeze every tenant', async () => {
    const db = stubDb({ data: null, error: { message: 'connection reset' } });
    expect((await assertOrgWritable(db.client, ORG)).ok).toBe(true);
  });

  it('returns ok for a null organization id rather than guessing', async () => {
    const db = stubDb(trialingRow(new Date().toISOString()));
    expect((await assertOrgWritable(db.client, null)).ok).toBe(true);
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe('the service-role invariant', () => {
  // A cron job, a webhook, or a settlement path must never be gated by billing.
  // Freezing an org must stop new work, never stop money already in flight.
  const roots = ['src/lib/payments', 'src/app/api/cron', 'src/app/api/stripe/webhook'];

  it('is not imported by any service-role path', () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(join(process.cwd(), root))) {
        const source = readFileSync(file, 'utf8');
        if (/from\s+['"](@\/lib\/billing\/guard|.*\/billing\/guard)['"]/.test(source)) {
          offenders.push(file.replace(process.cwd() + '/', ''));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry: string) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:unit -- guard.test
```

Expected: FAIL, cannot resolve `./guard`.

- [ ] **Step 3: Write the guard**

```ts
// src/lib/billing/guard.ts
//
// The server-side paywall. Returns 402 from write routes when an organization
// is frozen, so a tenant that stopped paying cannot create new work while still
// being able to read everything they have and pay to unfreeze.
//
// NEVER import this from src/lib/payments/**, src/app/api/cron/**, or
// src/app/api/stripe/webhook/**. Freezing an organization must stop new work,
// never stop money already in flight. guard.test.ts enforces that in CI.
//
// Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md §11.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ORG_BILLING_COLUMNS, deriveBillingAccess, type OrgBillingRow } from './access';
import { billingEnforcementEnabled } from './flags';

export type AssertWritableResult = { ok: true } | { ok: false; response: NextResponse };

const WRITABLE: AssertWritableResult = { ok: true };

/**
 * 402 when the organization is frozen, otherwise ok.
 *
 * Fails open on every uncertainty: flag off, no organization id, missing row, or
 * a query error. A transient database problem must never freeze every tenant at
 * once, and a bad id must produce the route's own 404 rather than a confusing 402.
 */
export async function assertOrgWritable(
  supabaseAdmin: SupabaseClient,
  organizationId: string | null | undefined,
): Promise<AssertWritableResult> {
  if (!billingEnforcementEnabled()) return WRITABLE;
  if (!organizationId) return WRITABLE;

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select(ORG_BILLING_COLUMNS)
    .eq('id', organizationId)
    .maybeSingle();

  if (error) {
    console.error('assertOrgWritable: billing lookup failed, allowing the write', error.message);
    return WRITABLE;
  }
  if (!data) return WRITABLE;

  const org = data as unknown as OrgBillingRow;
  const access = deriveBillingAccess(org, new Date());
  if (!access.frozen) return WRITABLE;

  return {
    ok: false,
    response: NextResponse.json(
      {
        error: 'billing_frozen',
        state: access.state,
        trial_ends_at: org.trial_ends_at,
        can_extend_trial: access.canExtendTrial,
      },
      { status: 402 },
    ),
  };
}
```

- [ ] **Step 4: Add `requireWritable` to the auth helpers**

In `src/lib/auth/requireOrgAuth.ts`, extend the options type and run the billing check after the role check. The import of `assertOrgWritable` is the only new import.

```ts
export interface RequireOrgAuthOptions {
  allowedRoles?: OrgRole[];
  /**
   * When true, a frozen organization gets 402 after the membership and role
   * checks pass. Ordered last on purpose: an outsider still gets 403, so the
   * response never leaks whether an org they do not belong to is paying.
   * No-op while BILLING_ENFORCEMENT_ENABLED is off.
   */
  requireWritable?: boolean;
}
```

At the end of the success path, immediately before `return { ok: true, userId, email, role }`:

```ts
  if (options.requireWritable) {
    const writable = await assertOrgWritable(supabaseAdmin, organizationId);
    if (!writable.ok) return { ok: false, response: writable.response };
  }

  return { ok: true, userId, email, role };
```

In `src/lib/auth/requireManagerPermission.ts`, extend its options type the same way and forward the flag into the `requireOrgAuth` call it already makes, so the billing check runs before the `manager_permissions` query:

```ts
export interface RequireManagerPermissionOptions {
  allowedRoles?: OrgRole[];
  errorMessage?: string;
  requireWritable?: boolean;
}
```

```ts
  const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
    allowedRoles: options.allowedRoles ?? ['owner', 'admin', 'manager'],
    requireWritable: options.requireWritable,
  });
  if (!auth.ok) return auth;
```

- [ ] **Step 5: Run the tests**

```bash
npm run test:unit -- guard.test
npx tsc --noEmit
npm run test
```

Expected: `guard.test` passes including the import invariant, no new type errors, and the full suite is unchanged because the flag is off everywhere.

- [ ] **Step 6: Commit**

```bash
git add src/lib/billing/guard.ts src/lib/billing/guard.test.ts src/lib/auth/requireOrgAuth.ts src/lib/auth/requireManagerPermission.ts
git commit -m "$(cat <<'MSG'
feat(billing): the 402 guard and requireWritable

assertOrgWritable returns 402 with the documented body when an organization is
frozen. requireOrgAuth and requireManagerPermission gain requireWritable, which
runs after the membership and role checks so an outsider still gets 403 and the
response never leaks whether someone else's org is paying.

Fails open on every uncertainty: flag off, no org id, missing row, query error.
A transient database problem must never freeze every tenant at once.

A unit test asserts the guard is never imported by src/lib/payments, the cron
routes, or the Stripe webhook, so money already in flight is never gated.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 7: wire the guard onto the catalog routes

This is a batch task. Seven files, one mechanical change each, reviewed as one diff.

**Files:**
- Modify: `src/lib/catalog/authorizeCatalog.ts`
- Modify: `src/app/api/services/route.ts`
- Test: `src/app/api/services/route.integration.test.ts` (exists; add the 402 cases)

**Interfaces:**
- Consumes: `requireWritable` on `requireManagerPermission` (Task 6).
- Produces: nothing new.

**Context an implementer cannot infer:**
- Six of the seven catalog routes do **not** call `requireManagerPermission` directly. They call `authorizeService`, `authorizeChecklist`, or `authorizeLineItem` from `src/lib/catalog/authorizeCatalog.ts:21-61`, which resolve the owning organization from the URL id and then call `requireManagerPermission` with `can_manage_services`. Passing `requireWritable: true` **once in each of those three authorizers** covers all six routes. Do not edit the six route files.
- The seventh, `POST /api/services/route.ts`, calls `requireManagerPermission` directly at line 31 with the org id from the request body. That one route file changes.
- The authorizers resolve the org **before** authorizing, and a 404 for an unknown or malformed id is returned before the token is even checked. That ordering is deliberate and was ruled on during Phase 1a. Do not move the billing check ahead of it: an id that does not exist must still 404, not 402.
- The affected routes are `POST /api/services`, `PATCH|DELETE /api/services/[id]`, `POST /api/services/[id]/checklists`, `PATCH|DELETE /api/checklists/[id]`, `POST /api/checklists/[id]/items`, `PUT /api/checklists/[id]/items/order`, and `PATCH|DELETE /api/checklist-items/[itemId]`.

- [ ] **Step 1: Write the failing test**

Add to `src/app/api/services/route.integration.test.ts`. Use the fixture's billing override from Task 11 if it has landed; if this task runs first, set the columns directly with the admin client as shown.

```ts
describe('POST /api/services billing enforcement', () => {
  afterEach(() => { delete process.env.BILLING_ENFORCEMENT_ENABLED; });

  it('passes through when the flag is off, even for a frozen org', async () => {
    const org = await withTestOrg();
    try {
      await supabase.from('organizations').update({
        comped_at: null,
        subscription_status: 'trialing',
        trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
      }).eq('id', org.organizationId);

      const res = await post(org, { name: 'Flag off', base_price: 100, duration_minutes: 60 });
      expect(res.status).toBe(201);
    } finally {
      await org.cleanup();
    }
  });

  it('returns 402 billing_frozen when the flag is on and the trial has expired', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    const org = await withTestOrg();
    try {
      await supabase.from('organizations').update({
        comped_at: null,
        subscription_status: 'trialing',
        trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
      }).eq('id', org.organizationId);

      const res = await post(org, { name: 'Frozen', base_price: 100, duration_minutes: 60 });
      expect(res.status).toBe(402);
      expect(res.body.error).toBe('billing_frozen');
      expect(res.body.state).toBe('trial_expired');
      expect(res.body.can_extend_trial).toBe(true);
    } finally {
      await org.cleanup();
    }
  });

  it('allows a comped org with the flag on', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    const org = await withTestOrg();
    try {
      await supabase.from('organizations')
        .update({ comped_at: new Date().toISOString() })
        .eq('id', org.organizationId);

      const res = await post(org, { name: 'Comped', base_price: 100, duration_minutes: 60 });
      expect(res.status).toBe(201);
    } finally {
      await org.cleanup();
    }
  });

  it('still returns 403 to a non-member before it considers billing', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    const frozen = await withTestOrg();
    const outsider = await withTestOrg();
    try {
      await supabase.from('organizations').update({
        comped_at: null,
        subscription_status: 'trialing',
        trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
      }).eq('id', frozen.organizationId);

      // Outsider's token against the frozen org: 403, never 402.
      const res = await callRoute(POST, {
        method: 'POST',
        headers: bearerHeader(outsider.admin.accessToken),
        body: { organization_id: frozen.organizationId, name: 'X', base_price: 100, duration_minutes: 60 },
      });
      expect(res.status).toBe(403);
    } finally {
      await frozen.cleanup();
      await outsider.cleanup();
    }
  });
});
```

Match the existing file's helper names (`post`, `supabase`, `callRoute`, `bearerHeader`) rather than inventing new ones. Read the top of the file first.

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:integration -- services/route.integration.test
```

Expected: the 402 cases FAIL with 201, because nothing is guarded yet. The flag-off and non-member cases already pass.

- [ ] **Step 3: Guard the three catalog authorizers**

In `src/lib/catalog/authorizeCatalog.ts`, each of `authorizeService`, `authorizeChecklist`, and `authorizeLineItem` ends with a `requireManagerPermission(...)` call. Add `requireWritable: true` to the options object of all three. For example:

```ts
  const auth = await requireManagerPermission(request, organizationId, supabaseAdmin, FLAG, {
    errorMessage: MESSAGE,
    requireWritable: true,
  });
```

Leave the org resolution and the 404-before-token ordering exactly as they are.

- [ ] **Step 4: Guard `POST /api/services`**

In `src/app/api/services/route.ts`, the call at line 31 gains the same option:

```ts
    const auth = await requireManagerPermission(request, input.organization_id, supabaseAdmin, 'can_manage_services', {
      errorMessage: 'Requires the Manage Services permission',
      requireWritable: true,
    });
```

Keep the existing `errorMessage` string exactly as it is.

- [ ] **Step 5: Run the catalog suites**

```bash
npm run test:integration -- services
npm run test:integration -- checklists
npm run test:integration -- checklist-items
npx tsc --noEmit
```

Expected: every suite passes, including the new 402 cases.

- [ ] **Step 6: Commit**

```bash
git add src/lib/catalog/authorizeCatalog.ts src/app/api/services/route.ts src/app/api/services/route.integration.test.ts
git commit -m "$(cat <<'MSG'
feat(billing): guard the services and checklist write routes

Six of the seven catalog routes authorize through authorizeService,
authorizeChecklist, and authorizeLineItem, so requireWritable goes on those
three helpers rather than on each route. POST /api/services authorizes directly
and gains it inline.

The 404-before-token ordering is untouched: an id that does not exist still
404s rather than 402ing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 8: wire the guard onto the booking and property routes

A batch task: six routes, one added option each.

**Files:**
- Modify: `src/app/api/appointments/route.ts` (the `requireManagerPermission` call at line 39)
- Modify: `src/app/api/properties/route.ts` (line 29)
- Modify: `src/app/api/recurring-appointments/route.ts` (line 75)
- Modify: `src/app/api/appointments/request/route.ts` (the `requireOrgAuth` call at line 63)
- Modify: `src/app/api/appointments/confirm/route.ts` (line 74)
- Modify: `src/app/api/appointments/confirm-series/route.ts` (line 48)
- Test: `src/app/api/appointments/route.integration.test.ts` and `src/app/api/properties/route.integration.test.ts` (both exist; add a 402 case each)

**Interfaces:**
- Consumes: `requireWritable` (Task 6).
- Produces: nothing new.

**Context an implementer cannot infer:**
- All six already resolve an organization id before authorizing, and all six take it from the request body. Adding `requireWritable: true` to the existing options object is the whole change. Do not restructure any handler.
- `appointments/request`, `confirm`, and `confirm-series` call `requireOrgAuth` directly rather than `requireManagerPermission`, and each assigns a user id from `auth.userId` on the line after the check. The option goes in the `requireOrgAuth` options object; the assignment lines stay where they are.
- `POST /api/properties` is called by homeowners adding their own home as well as by operators, and its `allowedRoles` is `['homeowner','owner','admin','manager']`. Freezing it freezes a homeowner too. That is intended: §13 gives the homeowner their own block message, built in PR F. Do not add a role exception here.
- Confirming a booking is guarded on purpose. A homeowner's pending request cannot be confirmed while the org is frozen, and spec §17 accepts that.

- [ ] **Step 1: Write the failing tests**

Add one 402 case to the appointments suite and one to the properties suite, in the same shape as Task 7's. For properties, use the homeowner's token so the test also proves a homeowner is frozen:

```ts
it('returns 402 to a homeowner adding a home while the org is frozen', async () => {
  process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
  const org = await withTestOrg();
  try {
    await supabase.from('organizations').update({
      comped_at: null,
      subscription_status: 'trialing',
      trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
    }).eq('id', org.organizationId);

    const res = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: {
        organization_id: org.organizationId,
        name: 'Frozen House',
        address: '1 Main St', city: 'Austin', state: 'TX', zip_code: '78701',
      },
    });
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('billing_frozen');
  } finally {
    await org.cleanup();
  }
});
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
npm run test:integration -- appointments/route.integration.test
npm run test:integration -- properties/route.integration.test
```

Expected: the new cases FAIL with 201.

- [ ] **Step 3: Add the option to all six routes**

Each route already has an options object on its auth call. Add `requireWritable: true` to it, changing nothing else. In `src/app/api/appointments/route.ts`:

```ts
    const auth = await requireManagerPermission(request, orgId, supabaseAdmin, 'can_edit_bookings', {
      errorMessage: 'Requires the Edit Bookings permission',
      requireWritable: true,
    });
```

For the three routes that call `requireOrgAuth` with only `allowedRoles`, the object gains a second key:

```ts
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: [/* keep the existing list exactly */],
      requireWritable: true,
    });
```

- [ ] **Step 4: Run the suites**

```bash
npm run test:integration -- appointments
npm run test:integration -- properties
npm run test:integration -- recurring-appointments
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/appointments src/app/api/properties src/app/api/recurring-appointments
git commit -m "$(cat <<'MSG'
feat(billing): guard the booking and property write routes

POST /api/appointments, /api/properties, /api/recurring-appointments, and the
three appointment request/confirm routes now refuse new work from a frozen
organization.

Properties is guarded for homeowners too, which is intended: a homeowner of a
frozen org cannot add a home and gets their own block message in the UI.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 9: wire the guard onto the settings and team routes

A batch task: eight routes, one added option each.

**Files:**
- Modify: `src/app/api/organizations/[orgId]/profile/route.ts` (the `requireOrgAuth` call at line 32)
- Modify: `src/app/api/organizations/[orgId]/branding/route.ts` (line 29)
- Modify: `src/app/api/organizations/[orgId]/business-hours/route.ts` (line 50)
- Modify: `src/app/api/organizations/[orgId]/cleaner-experience/route.ts` (line 22)
- Modify: `src/app/api/organizations/[orgId]/cleaner-payouts/route.ts` (line 24)
- Modify: `src/app/api/organizations/[orgId]/payment-settings/route.ts` (line 62)
- Modify: `src/app/api/admin/update-cleaner/route.ts` (line 33)
- Modify: `src/app/api/admin/update-manager-permissions/route.ts` (line 38)

**Interfaces:**
- Consumes: `requireWritable` (Task 6).
- Produces: nothing new.

**Context an implementer cannot infer:**
- The six organization settings routes take the org id from the **URL** (`params.orgId`), not the body. They already pass it to `requireOrgAuth`, so nothing about the id changes.
- **`onboarding` is deliberately absent from this list.** Onboarding checklist stamps are not settings, and a frozen org must still be able to finish provisioning. Do not guard it.
- `admin/update-cleaner` is the one route whose org id is **derived**: it looks the cleaner's `organization_id` up from the `cleanerId` in the body at lines 20-24, then calls `requireOrgAuth` at line 33 with that value, then runs a hand-rolled manager-flag block at lines 38-51. The `requireWritable` option goes on the `requireOrgAuth` call, which means the billing check runs before the manager-flag block. That ordering is correct and matches every other route.
- These eight are settings writes, not money movement. None of them is on a payment path, so guarding them cannot strand a charge.

- [ ] **Step 1: Add the option to all eight routes**

Each route already has a `requireOrgAuth` options object with `allowedRoles`. Add `requireWritable: true` and change nothing else. Preserve each route's existing `allowedRoles` exactly: `profile` is owner-only, the other five settings routes are owner and admin, `update-cleaner` is owner, admin, and manager, and `update-manager-permissions` is owner and admin.

- [ ] **Step 2: Write one integration test**

These eight are the same change eight times, so one route carries the regression test. Add to `src/app/api/organizations/[orgId]/branding/route.integration.test.ts` (or the settings suite that exists) a case asserting 402 when the flag is on and the trial has expired, and 200 when the flag is off, in the same shape as Task 7's.

- [ ] **Step 3: Run the suites**

```bash
npm run test:integration -- organizations
npm run test:integration -- update-cleaner
npm run test:integration -- update-manager-permissions
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/organizations src/app/api/admin/update-cleaner src/app/api/admin/update-manager-permissions
git commit -m "$(cat <<'MSG'
feat(billing): guard the organization settings and team-edit routes

The six organization settings PATCH routes plus update-cleaner and
update-manager-permissions refuse writes from a frozen organization.

The onboarding route is deliberately not guarded: checklist stamps are not
settings, and a frozen org must still be able to finish provisioning.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 10: the seat cap on invites

**Files:**
- Create: `src/lib/billing/seats.ts`
- Test: `src/lib/billing/seats.test.ts`
- Modify: `src/app/api/admin/send-invite/route.ts`
- Test: `src/app/api/admin/send-invite/route.integration.test.ts` (exists; add cap cases)

**Interfaces:**
- Consumes: `deriveBillingAccess`, `ORG_BILLING_COLUMNS` (Task 4); `assertOrgWritable` (Task 6); `PLANS`, `PLAN_TIERS` (Task 2).
- Produces: `countSeatsInUse(supabaseAdmin, organizationId)`, `seatCapDecision(...)`, and `nextTierFor(seatsInUse, currentTier)`. PR E's checkout route reuses `countSeatsInUse` to enforce `seat_count >= seatsInUse`.

**Context an implementer cannot infer:**
- `send-invite` does **not** use `requireOrgAuth`. It rolls its own membership and permission check inline, setting an `isAuthorized` flag and gating at lines 83-88. It therefore needs the standalone `assertOrgWritable`, called immediately after that gate at line 89, not the `requireWritable` option.
- **Only `status = 'pending'` invites reserve a seat** (ruling R2). `inv_status` is a seven-value enum (`pending`, `accepted`, `revoked`, `expired`, `creating`, `superseded`, `failed`) defined in `supabase/migrations/000_baseline.sql`. `creating` is transient with no mechanism to clear a stuck row, so counting it would let one failed send consume a seat forever.
- Seats in use = cleaner members + pending cleaner invites. A manager, admin, owner, or homeowner member does **not** consume a seat. Only `organization_members.role = 'cleaner'`.
- **Only a cleaner invite is capped.** An invite for a manager, admin, or homeowner is never refused for seats. Check the requested role first and skip the whole computation otherwise.
- A comped organization is **never** capped: `seatCap` is null, and null means unlimited, not zero.
- The 409 body is fixed by spec §9: `{ error: 'seat_cap_reached', cap, in_use, tier, next_tier }`. `next_tier` is the name of the cheapest tier whose `maxSeats` accommodates one more seat, or `null` if they are already on Pro.
- Spec §9 accepts the race where two simultaneous invites at cap-minus-one both pass. Do not add a constraint trigger or a transaction to close it.

- [ ] **Step 1: Write the failing unit test**

```ts
// src/lib/billing/seats.test.ts
import { describe, expect, it } from 'vitest';
import { nextTierFor, seatCapDecision } from './seats';

describe('seatCapDecision', () => {
  it('allows when under the cap', () => {
    expect(seatCapDecision({ seatCap: 5, seatsInUse: 4 })).toEqual({ allowed: true });
  });

  it('refuses at the cap', () => {
    expect(seatCapDecision({ seatCap: 5, seatsInUse: 5 })).toEqual({ allowed: false });
  });

  it('refuses above the cap, which happens after an un-comp', () => {
    expect(seatCapDecision({ seatCap: 15, seatsInUse: 22 })).toEqual({ allowed: false });
  });

  it('never caps a comped org, where the cap is null', () => {
    expect(seatCapDecision({ seatCap: null, seatsInUse: 400 })).toEqual({ allowed: true });
  });
});

describe('nextTierFor', () => {
  it('names the cheapest tier above the current one that fits another seat', () => {
    expect(nextTierFor(5, 'starter')).toBe('Growth');
    expect(nextTierFor(15, 'growth')).toBe('Pro');
  });

  it('returns null when the current tier already fits, because the fix is buying a seat', () => {
    // Starter's ceiling is 5, so at 3 in use they do not need a bigger plan.
    expect(nextTierFor(3, 'starter')).toBeNull();
  });

  it('returns null on Pro, which has no ceiling to outgrow', () => {
    expect(nextTierFor(40, 'pro')).toBeNull();
  });

  it('suggests the smallest tier that fits when there is no plan yet', () => {
    expect(nextTierFor(2, null)).toBe('Starter');
    expect(nextTierFor(9, null)).toBe('Growth');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:unit -- seats.test
```

Expected: FAIL, cannot resolve `./seats`.

- [ ] **Step 3: Write the seat helpers**

```ts
// src/lib/billing/seats.ts
//
// Seat accounting for the invite cap. Seats are PURCHASED, not metered: adding
// or removing a cleaner never changes the bill. This module only answers
// "may one more cleaner be invited right now".
//
// Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md §9.

import type { SupabaseClient } from '@supabase/supabase-js';
import { PLANS, PLAN_TIERS, type PlanTier } from './plans';

/**
 * Cleaner members plus pending cleaner invites.
 *
 * Only `pending` invites reserve a seat. `creating` is transient with no way to
 * clear a stuck row, so counting it would let one failed send consume a seat
 * permanently.
 */
export async function countSeatsInUse(
  supabaseAdmin: SupabaseClient,
  organizationId: string,
): Promise<number> {
  const [members, invites] = await Promise.all([
    supabaseAdmin
      .from('organization_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('role', 'cleaner'),
    supabaseAdmin
      .from('invites')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('role', 'cleaner')
      .eq('status', 'pending'),
  ]);

  if (members.error) throw new Error(members.error.message);
  if (invites.error) throw new Error(invites.error.message);

  return (members.count ?? 0) + (invites.count ?? 0);
}

/** A null cap means unlimited (comped), never zero. */
export function seatCapDecision(input: { seatCap: number | null; seatsInUse: number }): { allowed: boolean } {
  if (input.seatCap == null) return { allowed: true };
  return { allowed: input.seatsInUse < input.seatCap };
}

/**
 * The cheapest tier STRICTLY ABOVE `currentTier` whose seat ceiling admits one
 * more than `seatsInUse`, by name. Null when the current tier already admits it
 * (the fix is buying a seat, not changing plan) or when nothing higher exists.
 *
 * Pro's ceiling is null, so without the currentTier argument this would name Pro
 * for any number at all, including for an org already on Pro.
 */
export function nextTierFor(seatsInUse: number, currentTier: PlanTier | null): string | null {
  const needed = seatsInUse + 1;
  const fits = (tier: PlanTier) => {
    const max = PLANS[tier].maxSeats;
    return max == null || max >= needed;
  };

  // Already on a tier that could hold another seat: they need seats, not a plan.
  if (currentTier && fits(currentTier)) return null;

  const startAt = currentTier ? PLAN_TIERS.indexOf(currentTier) + 1 : 0;
  for (const tier of PLAN_TIERS.slice(startAt)) {
    if (fits(tier)) return PLANS[tier].name;
  }
  return null;
}
```

- [ ] **Step 4: Run the unit test**

```bash
npm run test:unit -- seats.test
```

Expected: PASS.

- [ ] **Step 5: Write the failing integration test**

Add to `src/app/api/admin/send-invite/route.integration.test.ts`:

```ts
describe('send-invite seat cap', () => {
  afterEach(() => { delete process.env.BILLING_ENFORCEMENT_ENABLED; });

  it('refuses a cleaner invite at the cap with 409 and the upgrade hint', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    const org = await withTestOrg();
    try {
      // Purchased Starter with 3 seats; the fixture already has one cleaner.
      await supabase.from('organizations').update({
        comped_at: null,
        subscription_status: 'active',
        plan_tier: 'starter',
        billing_period: 'monthly',
        seat_count: 1,
      }).eq('id', org.organizationId);

      const res = await sendInvite(org, { email: 'over@test.local', role: 'cleaner' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        error: 'seat_cap_reached',
        cap: 1,
        in_use: 1,
        tier: 'starter',
      });
    } finally {
      await org.cleanup();
    }
  });

  it('counts a pending invite as a reserved seat', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    const org = await withTestOrg();
    try {
      await supabase.from('organizations').update({
        comped_at: null, subscription_status: 'active',
        plan_tier: 'starter', billing_period: 'monthly', seat_count: 2,
      }).eq('id', org.organizationId);

      // One cleaner member + one pending invite = 2 = the cap.
      const first = await sendInvite(org, { email: 'first@test.local', role: 'cleaner' });
      expect(first.status).toBeLessThan(300);

      const second = await sendInvite(org, { email: 'second@test.local', role: 'cleaner' });
      expect(second.status).toBe(409);
      expect(second.body.in_use).toBe(2);
    } finally {
      await org.cleanup();
    }
  });

  it('never caps a comped org', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    const org = await withTestOrg();
    try {
      await supabase.from('organizations')
        .update({ comped_at: new Date().toISOString(), seat_count: 1 })
        .eq('id', org.organizationId);

      const res = await sendInvite(org, { email: 'comped@test.local', role: 'cleaner' });
      expect(res.status).toBeLessThan(300);
    } finally {
      await org.cleanup();
    }
  });

  it('does not cap a manager invite', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    const org = await withTestOrg();
    try {
      await supabase.from('organizations').update({
        comped_at: null, subscription_status: 'active',
        plan_tier: 'starter', billing_period: 'monthly', seat_count: 1,
      }).eq('id', org.organizationId);

      const res = await sendInvite(org, { email: 'mgr@test.local', role: 'manager' });
      expect(res.status).toBeLessThan(300);
    } finally {
      await org.cleanup();
    }
  });

  it('returns 402 before it considers seats when the org is frozen', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    const org = await withTestOrg();
    try {
      await supabase.from('organizations').update({
        comped_at: null,
        subscription_status: 'trialing',
        trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
      }).eq('id', org.organizationId);

      const res = await sendInvite(org, { email: 'frozen@test.local', role: 'cleaner' });
      expect(res.status).toBe(402);
      expect(res.body.error).toBe('billing_frozen');
    } finally {
      await org.cleanup();
    }
  });
});
```

Use the file's existing helper for posting an invite rather than inventing `sendInvite`; read the top of the file first and match it.

- [ ] **Step 6: Wire the route**

In `src/app/api/admin/send-invite/route.ts`, immediately after the existing authorization gate (the block ending around line 88 that returns 403 when `isAuthorized` is false), insert the billing check and then the seat check. Nothing above this point moves.

```ts
    const writable = await assertOrgWritable(supabaseAdmin, organizationId);
    if (!writable.ok) return writable.response;

    // Purchased seats: only cleaners consume one, and only pending invites reserve one.
    if (role === 'cleaner') {
      const { data: billingRow } = await supabaseAdmin
        .from('organizations')
        .select(ORG_BILLING_COLUMNS)
        .eq('id', organizationId)
        .maybeSingle();

      if (billingRow) {
        const access = deriveBillingAccess(billingRow as unknown as OrgBillingRow, new Date());
        const seatsInUse = await countSeatsInUse(supabaseAdmin, organizationId);

        if (!seatCapDecision({ seatCap: access.seatCap, seatsInUse }).allowed) {
          return NextResponse.json(
            {
              error: 'seat_cap_reached',
              cap: access.seatCap,
              in_use: seatsInUse,
              tier: billingRow.plan_tier ?? null,
              next_tier: nextTierFor(seatsInUse, (billingRow.plan_tier as PlanTier | null) ?? null),
            },
            { status: 409 },
          );
        }
      }
    }
```

The seat check runs only when `billingEnforcementEnabled()` is true, because `assertOrgWritable` already no-ops when the flag is off. Guard the whole `if (role === 'cleaner')` block with `billingEnforcementEnabled()` so the flag-off path does no extra queries at all.

- [ ] **Step 7: Run the suite**

```bash
npm run test:integration -- send-invite
npm run test:unit -- seats.test
npx tsc --noEmit
```

Expected: all pass, and the pre-existing send-invite cases are untouched because the flag defaults off.

- [ ] **Step 8: Commit**

```bash
git add src/lib/billing/seats.ts src/lib/billing/seats.test.ts src/app/api/admin/send-invite
git commit -m "$(cat <<'MSG'
feat(billing): seat cap on cleaner invites

Seats are purchased, not metered, so adding a cleaner never changes the bill.
This only refuses the invite that would exceed what the org bought, with 409
seat_cap_reached and the name of the tier that would fit.

Only cleaner invites are capped, only pending invites reserve a slot, and a
comped org is never capped. The simultaneous-invite race at cap-minus-one is
accepted per the spec: billing counts purchased seats, not used ones.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 11: stamp the trial at provisioning, and teach the test fixture about billing

**Files:**
- Modify: `src/app/api/platform/organizations/route.ts:119-130`
- Modify: `tests/helpers/fixtures.ts` (the `organizations` insert at lines 108-117, `WithTestOrgOptions`, `TestOrgFixture`)

**Interfaces:**
- Consumes: `TRIAL_DAYS` (Task 2).
- Produces: `WithTestOrgOptions.billing?: Partial<OrgBillingRow>`. Tasks 7 through 10 and every PR E test may use it.

**Context an implementer cannot infer:**
- `POST /api/platform/organizations` is the **only** place in `src/` that inserts an `organizations` row. It already sets `subscription_status: 'trialing'`; it just never had a clock. Adding `trial_ends_at` here is the whole production change.
- The test fixture is the only other inserter in the repo. It sets neither, so after Task 1's migration a fresh test org would carry `subscription_status` default `'none'`, which `deriveBillingAccess` treats as `trial_expired`, which is frozen. **Every integration test in the repo would start failing the moment the flag is on.** This is ruling R4 and it is the reason this task is not optional.
- Default the fixture to a live 14-day trial, matching real provisioning, rather than to comped. A comped default would make the guard tests pass for the wrong reason.
- `withTestOrg()`'s options interface is at `tests/helpers/fixtures.ts:61-91` and its returned `TestOrgFixture` at lines 15-21. Add to them, do not reshape them: every existing test depends on the current fields.

- [ ] **Step 1: Stamp the trial at provisioning**

In `src/app/api/platform/organizations/route.ts`, extend the insert. Compute the timestamp just above it so the value is readable in the log:

```ts
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString();

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .insert({
      name,
      billing_email: billingEmail,
      subscription_status: 'trialing',
      trial_ends_at: trialEndsAt,
      created_by: auth.userId,
    })
    .select(
      'id, name, billing_email, subscription_status, trial_ends_at, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, created_at',
    )
    .single();
```

Import `TRIAL_DAYS` from `@/lib/billing/plans`.

- [ ] **Step 2: Give the fixture a billing default and an override**

In `tests/helpers/fixtures.ts`, add to `WithTestOrgOptions`:

```ts
  /**
   * Billing columns for the new organization. Defaults to a live 14-day trial,
   * matching what POST /api/platform/organizations does, so a test org is never
   * accidentally frozen. Pass an override to exercise a specific billing state.
   */
  billing?: {
    subscription_status?: string;
    trial_ends_at?: string | null;
    trial_extended_at?: string | null;
    comped_at?: string | null;
    plan_tier?: string | null;
    billing_period?: string | null;
    seat_count?: number | null;
    billing_paused_at?: string | null;
  };
```

and extend the insert at lines 108-117:

```ts
  const billingDefaults = {
    subscription_status: 'trialing',
    trial_ends_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  };

  const { data: orgRow, error: orgError } = await supabase
    .from('organizations')
    .insert({
      name: /* keep the existing generated name expression */,
      ...billingDefaults,
      ...(opts.billing ?? {}),
      // keep every existing optional column exactly as it is
    })
    .select('id')
    .single();
```

- [ ] **Step 3: Assert the default explicitly**

Add a test to whichever suite covers the fixtures (or create `tests/helpers/fixtures.test.ts` if none exists) proving the default is a live trial rather than relying on it:

```ts
it('creates organizations in a live trial, never frozen', async () => {
  const org = await withTestOrg();
  try {
    const { data } = await supabase
      .from('organizations')
      .select('subscription_status, trial_ends_at, comped_at')
      .eq('id', org.organizationId)
      .single();

    expect(data?.subscription_status).toBe('trialing');
    expect(data?.comped_at).toBeNull();
    expect(new Date(data!.trial_ends_at!).getTime()).toBeGreaterThan(Date.now());
  } finally {
    await org.cleanup();
  }
});
```

- [ ] **Step 4: Run the full suite with enforcement forced on**

This is the check that matters. Every existing integration test must still pass with the flag on, because every test org is in a live trial.

```bash
BILLING_ENFORCEMENT_ENABLED=true npm run test:integration
```

Expected: PASS. If a suite fails, it is because that suite's org is not in a live trial; fix the fixture or that suite's setup, never by loosening the guard.

```bash
npm run test
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/platform/organizations/route.ts tests/helpers/fixtures.ts
git commit -m "$(cat <<'MSG'
feat(billing): stamp the trial clock at provisioning, and in the test fixture

Org provisioning already set subscription_status to trialing but never set a
clock. It now stamps trial_ends_at 14 days out.

withTestOrg() does the same and accepts a billing override. Without this every
integration test would start failing the moment enforcement is switched on,
because a fixture org would carry the `none` default that derives as an expired
trial. The default is a live trial, not a comp, so guard tests cannot pass for
the wrong reason.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 12: the self-serve trial extension

**Files:**
- Create: `src/app/api/billing/trial/extend/route.ts`
- Test: `src/app/api/billing/trial/extend/route.integration.test.ts`
- Modify: `src/lib/queryKeys.ts` (add the `billing` namespace)

**Interfaces:**
- Consumes: `requireOrgAuth` (Task 6), `deriveBillingAccess`, `ORG_BILLING_COLUMNS` (Task 4), `TRIAL_EXTENSION_DAYS` (Task 2).
- Produces: `POST /api/billing/trial/extend` and `keys.billing.org(orgId)`. PR F's paywall calls both.

**Context an implementer cannot infer:**
- This route must **never** be guarded by `requireWritable`. It exists to get a frozen organization unfrozen, so guarding it would deadlock the paywall.
- **Owner only.** Pass `allowedRoles: ['owner']`. An admin can open checkout but cannot extend a trial (spec §15).
- Allowed once ever: `trial_extended_at` must be null, and the state must be `trialing` or `trial_expired`. An active, comped, paused, unpaid, or canceled org has no trial to extend.
- The new end is `max(now, trial_ends_at) + 7 days`. Using `max` matters: extending a trial that ended a week ago must give seven days from today, not seven days from an already-past date.
- Writing the audit row is part of the spec's §16 contract. `tenant_subscription_events.stripe_event_id` is unique and not Stripe-validated, so app-initiated rows use `app:<uuid>`.
- `src/lib/queryKeys.ts` has no `billing` namespace. Add one following the file's existing factory style.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/billing/trial/extend/route.integration.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { POST } from './route';
import { withTestOrg } from '@/../tests/helpers/fixtures';
import { bearerHeader, callRoute } from '@/../tests/helpers/auth';
import { createTestSupabaseClient } from '@/../tests/helpers/supabase';

const supabase = createTestSupabaseClient();
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

async function extend(token: string, organizationId: string) {
  return callRoute(POST, { method: 'POST', headers: bearerHeader(token), body: { organization_id: organizationId } });
}

describe('POST /api/billing/trial/extend', () => {
  it('adds 7 days to a running trial and stamps the one-time flag', async () => {
    const org = await withTestOrg({ billing: { trial_ends_at: daysFromNow(2) } });
    try {
      const res = await extend(org.admin.accessToken, org.organizationId);
      expect(res.status).toBe(200);

      const { data } = await supabase
        .from('organizations')
        .select('trial_ends_at, trial_extended_at')
        .eq('id', org.organizationId).single();

      const expected = Date.now() + 9 * 86_400_000; // 2 remaining + 7
      expect(Math.abs(new Date(data!.trial_ends_at!).getTime() - expected)).toBeLessThan(60_000);
      expect(data!.trial_extended_at).not.toBeNull();
    } finally { await org.cleanup(); }
  });

  it('extends from today when the trial already expired', async () => {
    const org = await withTestOrg({ billing: { trial_ends_at: daysFromNow(-10) } });
    try {
      await extend(org.admin.accessToken, org.organizationId);
      const { data } = await supabase
        .from('organizations').select('trial_ends_at').eq('id', org.organizationId).single();

      const expected = Date.now() + 7 * 86_400_000;
      expect(Math.abs(new Date(data!.trial_ends_at!).getTime() - expected)).toBeLessThan(60_000);
    } finally { await org.cleanup(); }
  });

  it('allows it exactly once', async () => {
    const org = await withTestOrg({ billing: { trial_ends_at: daysFromNow(3) } });
    try {
      expect((await extend(org.admin.accessToken, org.organizationId)).status).toBe(200);

      const second = await extend(org.admin.accessToken, org.organizationId);
      expect(second.status).toBe(409);
      expect(second.body.error).toBe('This trial has already been extended.');
    } finally { await org.cleanup(); }
  });

  it('refuses when there is no trial to extend', async () => {
    const org = await withTestOrg({ billing: { subscription_status: 'active', trial_ends_at: null } });
    try {
      const res = await extend(org.admin.accessToken, org.organizationId);
      expect(res.status).toBe(409);
    } finally { await org.cleanup(); }
  });

  it('refuses a comped org, which has no trial clock', async () => {
    const org = await withTestOrg({ billing: { comped_at: new Date().toISOString() } });
    try {
      expect((await extend(org.admin.accessToken, org.organizationId)).status).toBe(409);
    } finally { await org.cleanup(); }
  });

  it('is owner only', async () => {
    const org = await withTestOrg({ billing: { trial_ends_at: daysFromNow(2) } });
    try {
      expect((await extend(org.cleaner.accessToken, org.organizationId)).status).toBe(403);
    } finally { await org.cleanup(); }
  });

  it('401s without a token and 400s without an organization id', async () => {
    expect((await callRoute(POST, { method: 'POST', body: { organization_id: crypto.randomUUID() } })).status).toBe(401);
    const org = await withTestOrg();
    try {
      expect((await callRoute(POST, {
        method: 'POST', headers: bearerHeader(org.admin.accessToken), body: {},
      })).status).toBe(400);
    } finally { await org.cleanup(); }
  });

  it('writes an audit row', async () => {
    const org = await withTestOrg({ billing: { trial_ends_at: daysFromNow(2) } });
    try {
      await extend(org.admin.accessToken, org.organizationId);
      const { data } = await supabase
        .from('tenant_subscription_events')
        .select('event_type')
        .eq('organization_id', org.organizationId);

      expect(data?.map((r) => r.event_type)).toContain('app.trial_extended');
    } finally { await org.cleanup(); }
  });
});
```

**Note on the fixture's admin:** `withTestOrg()` creates its staff member as an org `owner` or `admin`. Read `tests/helpers/fixtures.ts` and confirm which. If the fixture's `admin` is not an `owner`, either give the fixture an owner handle or have this test promote the member's `organization_members.role` to `owner` before calling. Do not weaken the route to `['owner','admin']` to make the test pass.

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:integration -- trial/extend
```

Expected: FAIL, the route does not exist.

- [ ] **Step 3: Write the route**

```ts
// src/app/api/billing/trial/extend/route.ts
//
// One-time self-serve 7-day trial extension, offered on the paywall and in the
// banner when 3 or fewer days remain.
//
// NEVER guarded by requireWritable: this route exists to get a frozen
// organization unfrozen, so guarding it would deadlock the paywall.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import {
  ORG_BILLING_COLUMNS,
  deriveBillingAccess,
  type OrgBillingRow,
} from '@/lib/billing/access';
import { TRIAL_EXTENSION_DAYS } from '@/lib/billing/plans';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const organizationId = (body as { organization_id?: unknown } | null)?.organization_id;
    if (typeof organizationId !== 'string' || !organizationId) {
      return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    }

    // Owner only. An admin may open checkout but may not move the trial clock.
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner'],
    });
    if (!auth.ok) return auth.response;

    const { data, error } = await supabaseAdmin
      .from('organizations')
      .select(ORG_BILLING_COLUMNS)
      .eq('id', organizationId)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

    const org = data as unknown as OrgBillingRow;
    const access = deriveBillingAccess(org, new Date());

    if (access.state !== 'trialing' && access.state !== 'trial_expired') {
      return NextResponse.json({ error: 'There is no trial to extend.' }, { status: 409 });
    }
    if (!access.canExtendTrial) {
      return NextResponse.json({ error: 'This trial has already been extended.' }, { status: 409 });
    }

    // Extend from today when the trial already lapsed, so a late extension is
    // still worth a full seven days.
    const now = Date.now();
    const from = Math.max(now, org.trial_ends_at ? new Date(org.trial_ends_at).getTime() : now);
    const trialEndsAt = new Date(from + TRIAL_EXTENSION_DAYS * 86_400_000).toISOString();
    const extendedAt = new Date(now).toISOString();

    const { error: updateError } = await supabaseAdmin
      .from('organizations')
      .update({ trial_ends_at: trialEndsAt, trial_extended_at: extendedAt })
      .eq('id', organizationId)
      // Belt and braces against a double click: only extend a trial that has
      // not been extended yet.
      .is('trial_extended_at', null);

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    await supabaseAdmin.from('tenant_subscription_events').insert({
      organization_id: organizationId,
      event_type: 'app.trial_extended',
      stripe_event_id: `app:${crypto.randomUUID()}`,
      payload: { trial_ends_at: trialEndsAt, extended_by: auth.userId },
    });

    return NextResponse.json({
      success: true,
      data: { trial_ends_at: trialEndsAt, trial_extended_at: extendedAt },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
```

Before writing the audit insert, open `supabase/migrations/065_stripe_restructure.sql` and confirm the exact column names on `tenant_subscription_events`. If the payload column is not called `payload`, use whatever it is called. Do not invent columns.

- [ ] **Step 4: Add the query-key namespace**

In `src/lib/queryKeys.ts`, add alongside the existing namespaces:

```ts
  billing: {
    all: ['billing'] as const,
    org: (orgId: string) => ['billing', 'org', orgId] as const,
  },
```

- [ ] **Step 5: Run the test**

```bash
npm run test:integration -- trial/extend
npx tsc --noEmit
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/billing/trial src/lib/queryKeys.ts
git commit -m "$(cat <<'MSG'
feat(billing): one-time self-serve trial extension

Owner only, allowed once, and never behind the paywall guard, because this
route exists to get a frozen organization unfrozen.

Extends from today rather than from the old end date, so a trial extended a
week after it lapsed is still worth a full seven days.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 12b: open PR D

- [ ] **Step 1: Run every gate**

```bash
npm run test
npx tsc --noEmit
npm run lint
BILLING_ENFORCEMENT_ENABLED=true npm run test:integration
```

The last one is the gate that matters: the whole integration suite must pass with enforcement on.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/phase1b-billing-core
gh pr create --base master --title "feat(billing): billing state, the 402 paywall, and seat caps (Phase 1b, PR D)" --body "<see below>"
```

The body should say: what the migration adds and that it comps every pre-existing organization so nothing can freeze on deploy; that every guard is a no-op while `BILLING_ENFORCEMENT_ENABLED` is off; that the whole integration suite was run with the flag forced on; the list of guarded routes and the deliberate exclusions (`onboarding`, every money and lifecycle route, every GET); and the seven plan-time rulings from this document.

---

# PR E — Stripe

Branch `feat/phase1b-stripe-billing`, stacked on `feat/phase1b-billing-core`.

### Task 13: `requireAppUrl`

**Files:**
- Create: `src/lib/billing/appUrl.ts`
- Test: `src/lib/billing/appUrl.test.ts`
- Modify: `src/app/api/stripe/billing/portal-link/route.ts:31`

**Interfaces:**
- Consumes: nothing.
- Produces: `requireAppUrl()`. Tasks 15 and 16 use it for Checkout return URLs.

**Context an implementer cannot infer:**
- There is no consistent pattern for this today, and one of the existing fallbacks is a bug. `src/app/api/stripe/billing/portal-link/route.ts:31` falls back to the hardcoded string `'https://app.nexxus'`, which is not a resolvable domain, so a portal return would land nowhere. Two other routes read bare `process.env.APP_URL` with no fallback and would build the literal string `"undefined/..."`.
- Stripe rejects a relative `success_url`, and a redirect built from the request `Host` header is attacker-controlled. Neither shortcut is acceptable here.
- Fixing the two bare readers in `platform/organizations` and `admin/send-invite` is **out of scope**. Note them as a follow-up; do not touch them in this PR.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/billing/appUrl.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { requireAppUrl } from './appUrl';

const clear = () => { delete process.env.APP_URL; delete process.env.NEXT_PUBLIC_APP_URL; };

describe('requireAppUrl', () => {
  afterEach(clear);

  it('prefers APP_URL', () => {
    process.env.APP_URL = 'https://app.example.com';
    process.env.NEXT_PUBLIC_APP_URL = 'https://other.example.com';
    expect(requireAppUrl()).toBe('https://app.example.com');
  });

  it('falls back to NEXT_PUBLIC_APP_URL', () => {
    clear();
    process.env.NEXT_PUBLIC_APP_URL = 'https://public.example.com';
    expect(requireAppUrl()).toBe('https://public.example.com');
  });

  it('strips a trailing slash so callers can concatenate a path', () => {
    process.env.APP_URL = 'https://app.example.com/';
    expect(requireAppUrl()).toBe('https://app.example.com');
  });

  it('throws a named error when neither is set', () => {
    clear();
    expect(() => requireAppUrl()).toThrow(/APP_URL/);
  });

  it('throws when the value is not an absolute http(s) URL', () => {
    process.env.APP_URL = '/dashboard';
    expect(() => requireAppUrl()).toThrow(/absolute/i);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:unit -- appUrl.test
```

Expected: FAIL, cannot resolve `./appUrl`.

- [ ] **Step 3: Write it**

```ts
// src/lib/billing/appUrl.ts
/**
 * The trusted absolute base URL for links we hand to Stripe.
 *
 * Never build these from the request Host header: it is attacker-controlled, and
 * a Checkout success_url is a redirect target. Throwing loudly when the variable
 * is missing is deliberate, because every silent fallback in this codebase today
 * produces either the literal string "undefined/..." or a dead hostname.
 */
export function requireAppUrl(): string {
  const raw = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) {
    throw new Error('APP_URL is not set. Stripe return URLs must be absolute.');
  }
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error(`APP_URL must be an absolute http(s) URL, got "${raw}".`);
  }
  return raw.replace(/\/+$/, '');
}
```

- [ ] **Step 4: Repoint portal-link**

Replace the hardcoded `'https://app.nexxus'` fallback at `src/app/api/stripe/billing/portal-link/route.ts:31` with a `requireAppUrl()` call. Keep the rest of the route as it is.

- [ ] **Step 5: Run the tests and commit**

```bash
npm run test:unit -- appUrl.test
npm run test:integration -- portal-link
npx tsc --noEmit
git add src/lib/billing/appUrl.ts src/lib/billing/appUrl.test.ts src/app/api/stripe/billing/portal-link/route.ts
git commit -m "$(cat <<'MSG'
fix(billing): one strict accessor for the app base URL

Stripe return URLs must be absolute and must never be built from the request
Host header. requireAppUrl throws a named error when APP_URL is unset instead
of silently producing a broken link.

Replaces the portal-link route's hardcoded https://app.nexxus fallback, which
is not a resolvable domain.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 14: price and portal resolution

**Files:**
- Modify: `src/lib/stripe/billing.ts`
- Test: `src/lib/stripe/billing.test.ts` (create if absent)

**Interfaces:**
- Consumes: `LOOKUP_KEYS`, `LookupKey` (PR D Task 2); `getStripe()` from `src/lib/stripe.ts`.
- Produces: `resolvePrices(): Promise<Record<LookupKey, string>>`, `resolvePortalConfiguration(): Promise<string>`, `__resetBillingCaches()` for tests. Tasks 15, 16, and 17 consume them.

**Context an implementer cannot infer:**
- No env vars and no config table for price ids. Prices are looked up by their lookup key, so test mode and live mode differ only in which account the SDK key points at. This is why the setup script in Task 21 sets lookup keys.
- All eight keys must be present or the call throws naming the missing ones. A half-configured account must fail loudly at the first checkout attempt, not silently create a subscription missing its seat item.
- Cache per process, and export a reset so tests are not order-dependent.
- `prices.list` returns at most 100 by default, which is ample for eight keys, but pass `active: true` so an archived price from a future price change is never picked up.
- `getStripe()` throws when `STRIPE_ENABLED !== 'true'`. The integration setup stubs it to throw, which is why every consumer of this module is mocked in integration tests.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/stripe/billing.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.fn();
const configurationsList = vi.fn();

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    prices: { list },
    billingPortal: { configurations: { list: configurationsList } },
  }),
}));

import { __resetBillingCaches, resolvePortalConfiguration, resolvePrices } from './billing';

const allEight = () => ({
  data: [
    'starter_monthly', 'starter_annual', 'growth_monthly', 'growth_annual',
    'pro_monthly', 'pro_annual', 'extra_seat_monthly', 'extra_seat_annual',
  ].map((lookup_key, i) => ({ id: `price_${i}`, lookup_key })),
});

describe('resolvePrices', () => {
  beforeEach(() => { __resetBillingCaches(); list.mockReset(); });

  it('maps every lookup key to its price id', async () => {
    list.mockResolvedValue(allEight());
    const prices = await resolvePrices();
    expect(prices.starter_monthly).toBe('price_0');
    expect(prices.extra_seat_annual).toBe('price_7');
  });

  it('asks Stripe once and caches', async () => {
    list.mockResolvedValue(allEight());
    await resolvePrices();
    await resolvePrices();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('throws naming the missing keys', async () => {
    list.mockResolvedValue({ data: [{ id: 'price_0', lookup_key: 'starter_monthly' }] });
    await expect(resolvePrices()).rejects.toThrow(/extra_seat_annual/);
    await expect(resolvePrices()).rejects.toThrow(/pro_monthly/);
  });

  it('does not cache a failure', async () => {
    list.mockResolvedValueOnce({ data: [] });
    await expect(resolvePrices()).rejects.toThrow();
    list.mockResolvedValueOnce(allEight());
    await expect(resolvePrices()).resolves.toBeTruthy();
  });

  it('requests only active prices', async () => {
    list.mockResolvedValue(allEight());
    await resolvePrices();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
  });
});

describe('resolvePortalConfiguration', () => {
  beforeEach(() => { __resetBillingCaches(); configurationsList.mockReset(); });

  it('picks the one tagged default', async () => {
    configurationsList.mockResolvedValue({
      data: [
        { id: 'bpc_other', metadata: {} },
        { id: 'bpc_ours', metadata: { nexxus_portal: 'default' } },
      ],
    });
    expect(await resolvePortalConfiguration()).toBe('bpc_ours');
  });

  it('throws when none is tagged', async () => {
    configurationsList.mockResolvedValue({ data: [{ id: 'bpc_other', metadata: {} }] });
    await expect(resolvePortalConfiguration()).rejects.toThrow(/stripe-billing-setup/);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:unit -- stripe/billing.test
```

Expected: FAIL, the exports do not exist.

- [ ] **Step 3: Add the resolvers to `src/lib/stripe/billing.ts`**

```ts
import { LOOKUP_KEYS, type LookupKey } from '@/lib/billing/plans';

let priceCache: Record<LookupKey, string> | null = null;
let portalConfigCache: string | null = null;

/** Test-only. Clears the per-process caches so specs are not order-dependent. */
export function __resetBillingCaches(): void {
  priceCache = null;
  portalConfigCache = null;
}

/**
 * Every plan Price, keyed by lookup key.
 *
 * No env vars and no config table: test mode and live mode differ only in which
 * account the SDK key points at. A half-configured account throws here rather
 * than silently creating a subscription that is missing its seat item.
 */
export async function resolvePrices(): Promise<Record<LookupKey, string>> {
  if (priceCache) return priceCache;

  const stripe = getStripe();
  const result = await stripe.prices.list({
    lookup_keys: [...LOOKUP_KEYS],
    active: true,
    limit: 100,
  });

  const found = {} as Record<LookupKey, string>;
  for (const price of result.data) {
    if (price.lookup_key && (LOOKUP_KEYS as readonly string[]).includes(price.lookup_key)) {
      found[price.lookup_key as LookupKey] = price.id;
    }
  }

  const missing = LOOKUP_KEYS.filter((key) => !found[key]);
  if (missing.length > 0) {
    throw new Error(
      `Stripe is missing ${missing.length} billing price(s): ${missing.join(', ')}. ` +
        'Run scripts/stripe-billing-setup.ts against this account.',
    );
  }

  priceCache = found;
  return found;
}

/** The Customer Portal configuration tagged `nexxus_portal = 'default'`. */
export async function resolvePortalConfiguration(): Promise<string> {
  if (portalConfigCache) return portalConfigCache;

  const stripe = getStripe();
  const result = await stripe.billingPortal.configurations.list({ limit: 100 });
  const mine = result.data.find((c) => c.metadata?.nexxus_portal === 'default');

  if (!mine) {
    throw new Error(
      'No Customer Portal configuration tagged nexxus_portal=default. ' +
        'Run scripts/stripe-billing-setup.ts against this account.',
    );
  }

  portalConfigCache = mine.id;
  return mine.id;
}
```

- [ ] **Step 4: Run and commit**

```bash
npm run test:unit -- stripe/billing.test
npx tsc --noEmit
git add src/lib/stripe/billing.ts src/lib/stripe/billing.test.ts
git commit -m "$(cat <<'MSG'
feat(billing): resolve Stripe prices and the portal configuration by lookup key

No env vars and no config table for price ids: test and live differ only in
which account the key points at. A half-configured account throws with the
missing lookup keys named rather than creating a subscription missing its seat
item.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 15: `diffSubscriptionItems`

**Files:**
- Create: `src/lib/billing/diffSubscriptionItems.ts`
- Test: `src/lib/billing/diffSubscriptionItems.test.ts`

**Interfaces:**
- Consumes: `PLANS`, `lookupKeyFor`, `seatLookupKeyFor` (PR D Task 2).
- Produces: `diffSubscriptionItems(current, target)` returning the `items` array for one `subscriptions.update`. Task 17 consumes it.

**Context an implementer cannot infer:**
- This is the whole reason a plan change is one API call rather than a Subscription Schedule. Keeping it pure is what makes tier, interval, and seat changes testable without touching Stripe.
- The four seat cases are the entire difficulty: extras above zero with a seat item present (update it), extras above zero with no seat item (add one), extras at zero with a seat item present (delete it), and extras at zero with no seat item (omit it entirely). Emitting `quantity: 0` instead of `deleted: true` leaves a zero-quantity line on the invoice.
- A monthly-to-annual switch changes **both** items' prices in the same call. Stripe requires every item on one subscription to share an interval, so they cannot be changed one at a time.
- The base item is identified by its price's lookup key matching a tier key, the seat item by matching a seat key. Do not assume array order.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/billing/diffSubscriptionItems.test.ts
import { describe, expect, it } from 'vitest';
import { diffSubscriptionItems, type CurrentSubscriptionItems } from './diffSubscriptionItems';

const prices = {
  starter_monthly: 'p_sm', starter_annual: 'p_sa',
  growth_monthly: 'p_gm', growth_annual: 'p_ga',
  pro_monthly: 'p_pm', pro_annual: 'p_pa',
  extra_seat_monthly: 'p_esm', extra_seat_annual: 'p_esa',
} as const;

const current = (over: Partial<CurrentSubscriptionItems> = {}): CurrentSubscriptionItems => ({
  baseItemId: 'si_base',
  basePriceLookupKey: 'starter_monthly',
  seatItemId: null,
  seatQuantity: 0,
  ...over,
});

describe('diffSubscriptionItems', () => {
  it('swaps the base price on a tier upgrade with no extra seats', () => {
    expect(diffSubscriptionItems(current(), { tier: 'growth', period: 'monthly', seatCount: 8 }, prices))
      .toEqual([{ id: 'si_base', price: 'p_gm' }]);
  });

  it('adds a seat item when extras appear for the first time', () => {
    expect(diffSubscriptionItems(current(), { tier: 'starter', period: 'monthly', seatCount: 5 }, prices))
      .toEqual([
        { id: 'si_base', price: 'p_sm' },
        { price: 'p_esm', quantity: 2 },
      ]);
  });

  it('updates an existing seat item', () => {
    const c = current({ seatItemId: 'si_seat', seatQuantity: 2 });
    expect(diffSubscriptionItems(c, { tier: 'starter', period: 'monthly', seatCount: 4 }, prices))
      .toEqual([
        { id: 'si_base', price: 'p_sm' },
        { id: 'si_seat', price: 'p_esm', quantity: 1 },
      ]);
  });

  it('deletes the seat item when extras fall to zero', () => {
    const c = current({ seatItemId: 'si_seat', seatQuantity: 2 });
    expect(diffSubscriptionItems(c, { tier: 'starter', period: 'monthly', seatCount: 3 }, prices))
      .toEqual([
        { id: 'si_base', price: 'p_sm' },
        { id: 'si_seat', deleted: true },
      ]);
  });

  it('omits the seat item entirely when there are no extras and none exists', () => {
    expect(diffSubscriptionItems(current(), { tier: 'starter', period: 'monthly', seatCount: 3 }, prices))
      .toEqual([{ id: 'si_base', price: 'p_sm' }]);
  });

  it('swaps both prices on a monthly to annual switch', () => {
    const c = current({ seatItemId: 'si_seat', seatQuantity: 2 });
    expect(diffSubscriptionItems(c, { tier: 'starter', period: 'annual', seatCount: 5 }, prices))
      .toEqual([
        { id: 'si_base', price: 'p_sa' },
        { id: 'si_seat', price: 'p_esa', quantity: 2 },
      ]);
  });

  it('handles a downgrade that both drops a tier and removes seats', () => {
    const c = current({ basePriceLookupKey: 'pro_annual', seatItemId: 'si_seat', seatQuantity: 10 });
    expect(diffSubscriptionItems(c, { tier: 'starter', period: 'monthly', seatCount: 3 }, prices))
      .toEqual([
        { id: 'si_base', price: 'p_sm' },
        { id: 'si_seat', deleted: true },
      ]);
  });

  it('never emits a zero quantity, which would leave an empty invoice line', () => {
    const c = current({ seatItemId: 'si_seat', seatQuantity: 4 });
    const items = diffSubscriptionItems(c, { tier: 'growth', period: 'monthly', seatCount: 8 }, prices);
    expect(items.some((i) => 'quantity' in i && i.quantity === 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:unit -- diffSubscriptionItems.test
```

Expected: FAIL.

- [ ] **Step 3: Write it**

```ts
// src/lib/billing/diffSubscriptionItems.ts
//
// Turns "what the subscription has now" plus "what they asked for" into the
// items array for ONE subscriptions.update. Pure, so tier, interval, and seat
// changes are testable without touching Stripe.
//
// Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md §10.4.

import { PLANS, lookupKeyFor, seatLookupKeyFor, type BillingPeriod, type LookupKey, type PlanTier } from './plans';

export interface CurrentSubscriptionItems {
  baseItemId: string;
  basePriceLookupKey: string;
  /** Null when the subscription has no extra-seat line. */
  seatItemId: string | null;
  seatQuantity: number;
}

export interface TargetPlan {
  tier: PlanTier;
  period: BillingPeriod;
  seatCount: number;
}

export type SubscriptionItemUpdate =
  | { id: string; price: string }
  | { id: string; price: string; quantity: number }
  | { price: string; quantity: number }
  | { id: string; deleted: true };

export function diffSubscriptionItems(
  current: CurrentSubscriptionItems,
  target: TargetPlan,
  prices: Record<LookupKey, string>,
): SubscriptionItemUpdate[] {
  const items: SubscriptionItemUpdate[] = [
    { id: current.baseItemId, price: prices[lookupKeyFor(target.tier, target.period)] },
  ];

  const extras = Math.max(0, target.seatCount - PLANS[target.tier].includedSeats);
  const seatPrice = prices[seatLookupKeyFor(target.period)];

  if (extras > 0) {
    // Update the existing seat line, or open one.
    items.push(
      current.seatItemId
        ? { id: current.seatItemId, price: seatPrice, quantity: extras }
        : { price: seatPrice, quantity: extras },
    );
  } else if (current.seatItemId) {
    // Delete rather than set quantity 0, which would leave an empty invoice line.
    items.push({ id: current.seatItemId, deleted: true });
  }

  return items;
}
```

- [ ] **Step 4: Run and commit**

```bash
npm run test:unit -- diffSubscriptionItems.test
git add src/lib/billing/diffSubscriptionItems.ts src/lib/billing/diffSubscriptionItems.test.ts
git commit -m "$(cat <<'MSG'
feat(billing): pure diff from a subscription to a target plan

One subscriptions.update handles every plan change: tier up, tier down, seats
up, seats down, and monthly to annual. Keeping the item arithmetic pure is what
makes it testable without touching Stripe, and what avoids Subscription
Schedules entirely.

Seats at zero delete the line rather than setting quantity 0, which would leave
an empty line on the invoice.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 16: the checkout route

**Files:**
- Create: `src/app/api/billing/checkout/route.ts`
- Test: `src/app/api/billing/checkout/route.integration.test.ts`
- Modify: `src/lib/stripe/billing.ts` (add `createBillingCheckoutSession`)
- Modify: `src/lib/payments/orgBilling.ts` (add `appendBillingEvent`)

**Interfaces:**
- Consumes: `resolvePrices` (Task 14), `requireAppUrl` (Task 13), `countSeatsInUse` (PR D Task 10), `PLANS`, `seatBounds`, `lookupKeyFor`, `seatLookupKeyFor` (PR D Task 2), `getOrCreateOrgCustomer` (existing in `orgBilling.ts`).
- Produces: `POST /api/billing/checkout` returning `{ checkout_url }`; `appendBillingEvent(supabase, orgId, eventType, payload)`. Task 17 reuses both.

**Context an implementer cannot infer:**
- **Never guarded by `requireWritable`.** A frozen organization must be able to pay. Guarding this route would make the paywall a dead end.
- Owner **or** admin may open checkout (spec §15). Only the owner may change an existing plan, which is Task 17's rule, not this one's.
- No `trial_period_days` on the session. The app manages the trial itself and it is over by the time anyone reaches checkout.
- **Never pass `payment_method_types`.** Stripe picks eligible methods from Dashboard settings; hardcoding `['card']` would lock out methods that improve conversion.
- `billing_address_collection: 'required'` from day one, so the address data exists when Stripe Tax is switched on later. `automatic_tax` is **not** passed until `billingTaxEnabled()` is true, because Stripe Tax silently collects nothing and returns no error until a registration exists.
- `allow_promotion_codes: true` so the launch offer is a Stripe coupon rather than code.
- `integration_identifier` is **deliberately omitted** (ruling R1): the installed SDK is `stripe@20.1.2` pinned to `apiVersion 2025-12-15.clover` and the parameter needs `2026-03-25.dahlia` or later.
- `seat_count` must be within `seatBounds(tier)` and must be at least `countSeatsInUse`. The second rule is what steers an over-cap formerly-comped org to a tier that fits.
- `getOrCreateOrgCustomer` already exists in `src/lib/payments/orgBilling.ts` and is the only way to get the customer id. Do not create a Customer directly.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/billing/checkout/route.integration.test.ts
import { describe, expect, it, vi } from 'vitest';

const createBillingCheckoutSession = vi.fn(async () => ({
  id: 'cs_test_123',
  url: 'https://checkout.stripe.test/session',
}));

vi.mock('@/lib/stripe/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe/billing')>()),
  createBillingCheckoutSession,
  resolvePrices: vi.fn(async () => ({
    starter_monthly: 'p_sm', starter_annual: 'p_sa',
    growth_monthly: 'p_gm', growth_annual: 'p_ga',
    pro_monthly: 'p_pm', pro_annual: 'p_pa',
    extra_seat_monthly: 'p_esm', extra_seat_annual: 'p_esa',
  })),
  createStripeBillingCustomer: vi.fn(async () => ({ id: `cus_${crypto.randomUUID()}` })),
}));

import { POST } from './route';
import { withTestOrg } from '@/../tests/helpers/fixtures';
import { bearerHeader, callRoute } from '@/../tests/helpers/auth';
import { createTestSupabaseClient } from '@/../tests/helpers/supabase';

const supabase = createTestSupabaseClient();
process.env.APP_URL ||= 'https://app.test.local';

const checkout = (token: string, body: Record<string, unknown>) =>
  callRoute(POST, { method: 'POST', headers: bearerHeader(token), body });

describe('POST /api/billing/checkout', () => {
  it('returns a checkout url for a valid purchase', async () => {
    const org = await withTestOrg();
    try {
      const res = await checkout(org.admin.accessToken, {
        organization_id: org.organizationId, tier: 'growth', period: 'annual', seat_count: 8,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.checkout_url).toBe('https://checkout.stripe.test/session');
    } finally { await org.cleanup(); }
  });

  it('builds line items with a seat line only when there are extras', async () => {
    const org = await withTestOrg();
    try {
      createBillingCheckoutSession.mockClear();
      await checkout(org.admin.accessToken, {
        organization_id: org.organizationId, tier: 'starter', period: 'monthly', seat_count: 3,
      });
      expect(createBillingCheckoutSession.mock.calls[0][0].lineItems).toEqual([
        { price: 'p_sm', quantity: 1 },
      ]);

      createBillingCheckoutSession.mockClear();
      await checkout(org.admin.accessToken, {
        organization_id: org.organizationId, tier: 'starter', period: 'monthly', seat_count: 5,
      });
      expect(createBillingCheckoutSession.mock.calls[0][0].lineItems).toEqual([
        { price: 'p_sm', quantity: 1 },
        { price: 'p_esm', quantity: 2 },
      ]);
    } finally { await org.cleanup(); }
  });

  it('works for a frozen org, because a frozen org must be able to pay', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    const org = await withTestOrg({
      billing: { trial_ends_at: new Date(Date.now() - 86_400_000).toISOString() },
    });
    try {
      const res = await checkout(org.admin.accessToken, {
        organization_id: org.organizationId, tier: 'starter', period: 'monthly', seat_count: 3,
      });
      expect(res.status).toBe(200);
    } finally {
      delete process.env.BILLING_ENFORCEMENT_ENABLED;
      await org.cleanup();
    }
  });

  it.each([
    [{ tier: 'starter', period: 'monthly', seat_count: 2 }, /at least 3/i],
    [{ tier: 'starter', period: 'monthly', seat_count: 6 }, /at most 5/i],
    [{ tier: 'enterprise', period: 'monthly', seat_count: 3 }, /tier/i],
    [{ tier: 'starter', period: 'weekly', seat_count: 3 }, /period/i],
  ])('rejects %j with 400', async (body, message) => {
    const org = await withTestOrg();
    try {
      const res = await checkout(org.admin.accessToken, { organization_id: org.organizationId, ...body });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
    } finally { await org.cleanup(); }
  });

  it('refuses to buy fewer seats than are in use', async () => {
    const org = await withTestOrg();   // fixture creates one cleaner
    try {
      // Pro's minimum is 15, so ask for Pro with fewer seats than in use is not
      // reachable; use a hand-built case instead: Starter min 3 with 4 cleaners.
      for (let i = 0; i < 3; i++) {
        await supabase.from('organization_members').insert({
          organization_id: org.organizationId, user_id: crypto.randomUUID(), role: 'cleaner',
        });
      }
      const res = await checkout(org.admin.accessToken, {
        organization_id: org.organizationId, tier: 'starter', period: 'monthly', seat_count: 3,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/4/);
    } finally { await org.cleanup(); }
  });

  it('is owner or admin only', async () => {
    const org = await withTestOrg();
    try {
      const res = await checkout(org.cleaner.accessToken, {
        organization_id: org.organizationId, tier: 'starter', period: 'monthly', seat_count: 3,
      });
      expect(res.status).toBe(403);
    } finally { await org.cleanup(); }
  });

  it('writes an app.checkout_started audit row', async () => {
    const org = await withTestOrg();
    try {
      await checkout(org.admin.accessToken, {
        organization_id: org.organizationId, tier: 'growth', period: 'monthly', seat_count: 8,
      });
      const { data } = await supabase.from('tenant_subscription_events')
        .select('event_type').eq('organization_id', org.organizationId);
      expect(data?.map((r) => r.event_type)).toContain('app.checkout_started');
    } finally { await org.cleanup(); }
  });
});
```

If inserting a bare `organization_members` row violates a foreign key on `user_id`, create real auth users with the fixture's `createAuthUser` helper instead. Read `tests/helpers/fixtures.ts` first.

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:integration -- billing/checkout
```

Expected: FAIL, the route does not exist.

- [ ] **Step 3: Add the Stripe wrapper**

In `src/lib/stripe/billing.ts`:

```ts
export interface BillingCheckoutInput {
  customerId: string;
  lineItems: Array<{ price: string; quantity: number }>;
  organizationId: string;
  successUrl: string;
  cancelUrl: string;
  automaticTax: boolean;
}

/**
 * Hosted Checkout for the first subscription purchase.
 *
 * No trial_period_days: the app manages the trial and it is over by the time
 * anyone reaches checkout. No payment_method_types: Stripe picks eligible
 * methods from Dashboard settings, and hardcoding card would cost conversion.
 */
export async function createBillingCheckoutSession(input: BillingCheckoutInput) {
  const stripe = getStripe();
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: input.customerId,
    customer_update: { address: 'auto', name: 'auto' },
    billing_address_collection: 'required',
    line_items: input.lineItems,
    subscription_data: { metadata: { organization_id: input.organizationId } },
    metadata: { organization_id: input.organizationId },
    allow_promotion_codes: true,
    ...(input.automaticTax ? { automatic_tax: { enabled: true } } : {}),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
}
```

- [ ] **Step 4: Add the audit helper**

In `src/lib/payments/orgBilling.ts`:

```ts
/**
 * Append an app-initiated row to the subscription timeline, so the back office
 * shows both what we did and what Stripe told us. stripe_event_id is unique and
 * not Stripe-validated, so app rows use an `app:` prefix.
 */
export async function appendBillingEvent(
  supabase: SupabaseClient,
  organizationId: string,
  eventType: `app.${string}`,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('tenant_subscription_events').insert({
    organization_id: organizationId,
    stripe_event_id: `app:${crypto.randomUUID()}`,
    event_type: eventType,
    payload,
  });
  // The timeline is forensic, not load-bearing: never fail a billing action
  // because its audit row did not land.
  if (error) console.error(`appendBillingEvent(${eventType}) failed:`, error.message);
}
```

- [ ] **Step 5: Write the route**

```ts
// src/app/api/billing/checkout/route.ts
//
// First subscription purchase. NEVER guarded by requireWritable: a frozen
// organization must be able to pay, or the paywall is a dead end.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { createBillingCheckoutSession, resolvePrices } from '@/lib/stripe/billing';
import { appendBillingEvent, getOrCreateOrgCustomer } from '@/lib/payments/orgBilling';
import { countSeatsInUse } from '@/lib/billing/seats';
import { requireAppUrl } from '@/lib/billing/appUrl';
import { billingTaxEnabled } from '@/lib/billing/flags';
import {
  PLANS, lookupKeyFor, seatBounds, seatLookupKeyFor,
  type BillingPeriod, type PlanTier,
} from '@/lib/billing/plans';

export const runtime = 'nodejs';

const TIERS: PlanTier[] = ['starter', 'growth', 'pro'];
const PERIODS: BillingPeriod[] = ['monthly', 'annual'];

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const organizationId = body?.organization_id;
    const tier = body?.tier;
    const period = body?.period;
    const seatCount = body?.seat_count;

    if (typeof organizationId !== 'string' || !organizationId) {
      return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    }
    if (typeof tier !== 'string' || !TIERS.includes(tier as PlanTier)) {
      return NextResponse.json({ error: 'Choose a plan tier of starter, growth, or pro.' }, { status: 400 });
    }
    if (typeof period !== 'string' || !PERIODS.includes(period as BillingPeriod)) {
      return NextResponse.json({ error: 'Choose a billing period of monthly or annual.' }, { status: 400 });
    }
    if (typeof seatCount !== 'number' || !Number.isInteger(seatCount)) {
      return NextResponse.json({ error: 'seat_count must be a whole number.' }, { status: 400 });
    }

    // Owner or admin. Only the owner may change an existing plan; that is the
    // plan route's rule, not this one's.
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin'],
    });
    if (!auth.ok) return auth.response;

    const planTier = tier as PlanTier;
    const planPeriod = period as BillingPeriod;
    const bounds = seatBounds(planTier);

    if (seatCount < bounds.min) {
      return NextResponse.json(
        { error: `${PLANS[planTier].name} includes ${bounds.min} seats, so buy at least ${bounds.min}.` },
        { status: 400 },
      );
    }
    if (bounds.max != null && seatCount > bounds.max) {
      return NextResponse.json(
        { error: `${PLANS[planTier].name} allows at most ${bounds.max} seats. Choose a larger plan.` },
        { status: 400 },
      );
    }

    const seatsInUse = await countSeatsInUse(supabaseAdmin, organizationId);
    if (seatCount < seatsInUse) {
      return NextResponse.json(
        { error: `You have ${seatsInUse} cleaners, so buy at least ${seatsInUse} seats.` },
        { status: 400 },
      );
    }

    const prices = await resolvePrices();
    const extras = Math.max(0, seatCount - PLANS[planTier].includedSeats);
    const lineItems = [
      { price: prices[lookupKeyFor(planTier, planPeriod)], quantity: 1 },
      ...(extras > 0 ? [{ price: prices[seatLookupKeyFor(planPeriod)], quantity: extras }] : []),
    ];

    const customerId = await getOrCreateOrgCustomer(supabaseAdmin, organizationId);
    const appUrl = requireAppUrl();

    const session = await createBillingCheckoutSession({
      customerId,
      lineItems,
      organizationId,
      automaticTax: billingTaxEnabled(),
      successUrl: `${appUrl}/admin/settings?section=billing&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/admin/settings?section=billing&checkout=canceled`,
    });

    await appendBillingEvent(supabaseAdmin, organizationId, 'app.checkout_started', {
      session_id: session.id, tier: planTier, period: planPeriod, seat_count: seatCount,
    });

    return NextResponse.json({ success: true, data: { checkout_url: session.url } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
```

Check `getOrCreateOrgCustomer`'s real signature in `src/lib/payments/orgBilling.ts` before calling it, and match it. It may take the org id alone or a row.

- [ ] **Step 6: Run and commit**

```bash
npm run test:integration -- billing/checkout
npx tsc --noEmit
npm run lint
git add src/app/api/billing/checkout src/lib/stripe/billing.ts src/lib/payments/orgBilling.ts
git commit -m "$(cat <<'MSG'
feat(billing): hosted Checkout for the first subscription purchase

Never behind the paywall guard: a frozen organization must be able to pay.
Validates the seat count against both the tier's bounds and the cleaners
actually in use, which is what steers an over-cap org to a plan that fits.

No payment_method_types (Stripe picks dynamically), no trial_period_days (the
app manages the trial), billing addresses collected from day one so the data
exists when Stripe Tax is switched on.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 17: the plan-change route

**Files:**
- Create: `src/app/api/billing/plan/route.ts`
- Test: `src/app/api/billing/plan/route.integration.test.ts`
- Modify: `src/lib/stripe/billing.ts` (add `retrieveSubscription`, `updateSubscriptionItems`)

**Interfaces:**
- Consumes: `diffSubscriptionItems` (Task 15), `resolvePrices` (Task 14), the checkout route's validation rules (Task 16).
- Produces: `POST /api/billing/plan` returning either `{ updated: true }` or `{ checkout_url }`.

**Context an implementer cannot infer:**
- **Owner only**, unlike checkout. An admin may start a subscription but may not change an existing one (spec §15).
- **Never guarded by `requireWritable`.** An `unpaid` org changing plan is a legitimate act.
- When the org has no live subscription (state `trialing`, `trial_expired`, or `canceled`, or `subscription_id` is null), this route does not error. It returns a `checkout_url` built exactly as Task 16 builds one, so the client has a single entry point. Factor the session-building into a small shared function rather than duplicating it.
- `proration_behavior: 'create_prorations'` makes both directions immediate and prorated. This is a deliberate, accepted deviation from the pricing doc's period-end downgrades (spec §18 item 1): it avoids Subscription Schedules entirely.
- The route mirrors `plan_tier`, `billing_period`, and `seat_count` on success, but the webhook is the real source of truth and will overwrite. Mirroring here only stops the UI from lagging by a second.
- Reading the current items requires the subscription's `items.data[].price.lookup_key`. Those are present on a retrieved subscription; no extra fetch is needed.
- For `past_due` and `unpaid`, a plan change does not fix a failed payment. The route still works; PR F's UI leads with "Update payment method" and offers Change plan second.

- [ ] **Step 1: Write the failing test**

Cover: an owner upgrading tier calls `updateSubscriptionItems` once with the diffed items and `create_prorations`; an admin gets 403; an org with no subscription gets a `checkout_url` instead of an update; seat bounds and seats-in-use validation match checkout's; a monthly-to-annual switch swaps both prices; and the success path mirrors the three columns. Mock `@/lib/stripe/billing` exactly as Task 16's test does, adding `retrieveSubscription` and `updateSubscriptionItems`.

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test:integration -- billing/plan
```

- [ ] **Step 3: Add the Stripe wrappers**

```ts
export async function retrieveSubscription(subscriptionId: string) {
  return getStripe().subscriptions.retrieve(subscriptionId);
}

/**
 * One call handles tier up, tier down, seats up, seats down, and the interval
 * switch. Prorated immediately in both directions, which is what lets us avoid
 * Subscription Schedules entirely.
 */
export async function updateSubscriptionItems(
  subscriptionId: string,
  items: unknown[],
  organizationId: string,
) {
  return getStripe().subscriptions.update(subscriptionId, {
    items: items as never,
    proration_behavior: 'create_prorations',
    metadata: { organization_id: organizationId },
  });
}
```

- [ ] **Step 4: Write the route**

Follow Task 16's validation block exactly (tier, period, seat integer, bounds, seats-in-use), then:

```ts
    // No live subscription: send them to checkout instead of erroring, so the
    // client has one entry point for "change my plan".
    const hasLiveSub = Boolean(org.subscription_id) &&
      ['active', 'past_due', 'unpaid'].includes(org.subscription_status);

    if (!hasLiveSub) {
      const checkoutUrl = await buildCheckoutUrl({ organizationId, tier: planTier, period: planPeriod, seatCount });
      return NextResponse.json({ success: true, data: { checkout_url: checkoutUrl } });
    }

    const sub = await retrieveSubscription(org.subscription_id!);
    const current = readCurrentItems(sub);      // base item, seat item, quantity
    const prices = await resolvePrices();
    const items = diffSubscriptionItems(current, { tier: planTier, period: planPeriod, seatCount }, prices);

    await updateSubscriptionItems(org.subscription_id!, items, organizationId);

    // Mirror immediately so the UI does not lag; the webhook is the truth and
    // will overwrite these within seconds.
    await supabaseAdmin.from('organizations').update({
      plan_tier: planTier, billing_period: planPeriod, seat_count: seatCount,
    }).eq('id', organizationId);

    await appendBillingEvent(supabaseAdmin, organizationId, 'app.plan_changed', {
      tier: planTier, period: planPeriod, seat_count: seatCount,
    });

    return NextResponse.json({ success: true, data: { updated: true } });
```

`readCurrentItems(sub)` is a small local function: walk `sub.items.data`, classify each by whether its `price.lookup_key` matches a tier key or a seat key via `tierFor`, and return `{ baseItemId, basePriceLookupKey, seatItemId, seatQuantity }`. Throw a clear error if no base item is found, because that means the subscription was not created by this system.

- [ ] **Step 5: Run and commit**

```bash
npm run test:integration -- billing/plan
npx tsc --noEmit
git add src/app/api/billing/plan src/lib/stripe/billing.ts
git commit -m "$(cat <<'MSG'
feat(billing): change plan in one prorated subscriptions.update

Owner only. Handles tier up, tier down, seats up, seats down, and the monthly
to annual switch in a single call, prorated immediately in both directions.
Immediate downgrades are an accepted deviation from the pricing doc; they avoid
Subscription Schedules entirely.

An org with no live subscription gets a checkout URL back rather than an error,
so the client has one entry point for changing a plan.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 18: pause, resume, and cancel in the billing library

**Files:**
- Modify: `src/lib/stripe/billing.ts`
- Modify: `src/lib/payments/orgBilling.ts`
- Test: `src/lib/payments/orgBilling.test.ts`

**Interfaces:**
- Consumes: `appendBillingEvent` (Task 16).
- Produces: `pauseOrgBilling(supabase, orgId, resumesAt)`, `resumeOrgBilling(supabase, orgId)`, `cancelOrgSubscription(supabase, orgId, when)`. PR G's platform route wires all three into the back office; this task only builds them.

**Context an implementer cannot infer:**
- `cancelOrgSubscription` already exists in `orgBilling.ts:121` and cancels immediately. It has **zero callers anywhere in `src/`**, so changing its signature to take a `when` argument breaks nothing. Add the argument rather than creating a second function.
- `pause_collection: { behavior: 'void' }` means no invoice records exist for the paused months, which is what makes a pause clean to reverse. Resuming is `pause_collection: ''`, an empty string, not `null` and not `undefined`.
- Do **not** write `billing_paused_at` from these functions. The webhook mirrors `pause_collection` onto the row (Task 19). Writing it here as well would create two sources of truth for the same fact.
- Pausing requires a live subscription. A trialing org gets a platform-side trial extension instead, which is PR G's concern.
- `cancel_at_period_end: true` for `when: 'period_end'`, and `subscriptions.cancel(id)` for `when: 'now'`.

- [ ] **Step 1: Write the failing test**

Add cases to `src/lib/payments/orgBilling.test.ts` asserting that `pauseOrgBilling` calls the Stripe wrapper with `behavior: 'void'` and the given `resumes_at`; that `resumeOrgBilling` passes the empty string; that `cancelOrgSubscription(..., 'period_end')` sets `cancel_at_period_end` while `'now'` calls cancel; that each writes its `app.*` audit row; and that none of them writes `billing_paused_at` directly.

- [ ] **Step 2: Add the Stripe wrappers**

```ts
/** behavior 'void' means no invoices exist for the paused months. */
export async function pauseSubscription(subscriptionId: string, resumesAt: number | null) {
  return getStripe().subscriptions.update(subscriptionId, {
    pause_collection: { behavior: 'void', ...(resumesAt ? { resumes_at: resumesAt } : {}) },
  });
}

/** Resuming is an empty string, not null and not undefined. */
export async function resumeSubscription(subscriptionId: string) {
  return getStripe().subscriptions.update(subscriptionId, { pause_collection: '' as never });
}

export async function cancelSubscriptionAtPeriodEnd(subscriptionId: string) {
  return getStripe().subscriptions.update(subscriptionId, { cancel_at_period_end: true });
}

export async function cancelSubscriptionNow(subscriptionId: string) {
  return getStripe().subscriptions.cancel(subscriptionId);
}
```

- [ ] **Step 3: Add the orchestration**

In `orgBilling.ts`, each function loads the org's `subscription_id` and `subscription_status`, refuses with a clear error when there is no live subscription, calls the wrapper, and appends its audit row (`app.platform_paused`, `app.platform_resumed`, `app.platform_canceled`). Change `cancelOrgSubscription`'s signature to accept `when: 'period_end' | 'now'` and require a status of `active`, `past_due`, or `unpaid`.

- [ ] **Step 4: Run and commit**

```bash
npm run test:unit -- orgBilling.test
npx tsc --noEmit
git add src/lib/stripe/billing.ts src/lib/payments/orgBilling.ts src/lib/payments/orgBilling.test.ts
git commit -m "$(cat <<'MSG'
feat(billing): pause, resume, and cancel-at-period-end

pause_collection with behavior void, so no invoices exist for paused months and
the pause is clean to reverse. cancelOrgSubscription gains a `when` argument
rather than growing a second function; it had no callers.

None of these writes billing_paused_at: the webhook mirrors pause_collection
onto the row, so there is one source of truth for that fact.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 19: webhook mirroring

**Files:**
- Modify: `src/lib/payments/dispatchStripeEvent.ts` (`handleSubscriptionUpsert` at line 1502, `handleSubscriptionDeleted` at 1529, and the event switch)
- Test: `src/app/api/stripe/webhook/route.integration.test.ts` (exists; subscription mirroring cases are around lines 1976-2063)

**Interfaces:**
- Consumes: `tierFor`, `PLANS` (PR D Task 2); `mapSubscriptionStatus` (PR D Task 5).
- Produces: mirrored `plan_tier`, `billing_period`, `seat_count`, `subscription_cancel_at`, `billing_paused_at`, `billing_pause_resumes_at`. A new `checkout.session.completed` handler.

**Context an implementer cannot infer:**
- Stripe is the source of truth for tier, period, and seat count. The routes mirror optimistically; this handler is what makes the row correct.
- The current handler is at `dispatchStripeEvent.ts:1502-1527`. It already resolves the org via `resolveOrgForSubscription` and reads `current_period_end` defensively because the field moved across API versions. Keep both behaviors.
- Everything needed is **already on the subscription payload**: `items.data[].price.lookup_key` gives the tier and period, `items.data[].quantity` on the seat item gives the extras, `cancel_at` gives the scheduled cancel, and `pause_collection` gives the pause. No extra Stripe fetch.
- `seat_count = PLANS[tier].includedSeats + (seat item quantity ?? 0)`. A subscription with no seat item means exactly the included seats.
- If the base item's lookup key does not parse as a tier, this subscription was not created by this system. Mirror the status and leave `plan_tier`, `billing_period`, and `seat_count` untouched rather than writing nulls over good data.
- `customer.subscription.deleted` clears `subscription_cancel_at` and both pause columns along with setting `canceled`.
- The new `checkout.session.completed` handler writes a `tenant_subscription_events` row only. **Fulfillment continues to key off `customer.subscription.created`**, which arrives in the same burst. It also refreshes `billing_email` from `customer_details.email` when the org has none.
- The webhook dispatcher's `default` case logs "Unhandled event type", so a new case must be added to the switch or the event is silently dropped.
- Mirror failures raise a `platform_alerts` row with `alert_type` `billing_mirror_failed`. `platform_alerts.alert_type` has **no CHECK constraint** (migrations 085 and 115), so no migration is needed for the new value.

- [ ] **Step 1: Write the failing tests**

Extend the webhook integration suite with cases asserting that a `customer.subscription.updated` payload carrying a `growth_annual` base item and a seat item of quantity 4 mirrors `plan_tier: 'growth'`, `billing_period: 'annual'`, and `seat_count: 12`; that a payload with no seat item yields exactly the included seats; that `unpaid` lands as `unpaid` rather than `past_due`; that `cancel_at` and `pause_collection` mirror; that `subscription.deleted` clears them; that an unrecognized base lookup key leaves the three plan columns alone; and that `checkout.session.completed` writes an audit row.

- [ ] **Step 2: Extend `handleSubscriptionUpsert`**

Keep the existing org resolution and defensive `current_period_end` read, and add the mirror:

```ts
  const update: Record<string, unknown> = {
    subscription_id: sub.id,
    subscription_status: mapSubscriptionStatus(sub.status),
    subscription_current_period_end: cpe ? new Date(cpe * 1000).toISOString() : null,
    subscription_cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
    billing_paused_at: sub.pause_collection ? new Date().toISOString() : null,
    billing_pause_resumes_at: sub.pause_collection?.resumes_at
      ? new Date(sub.pause_collection.resumes_at * 1000).toISOString()
      : null,
  };

  // Tier, period, and seats come off the items; Stripe is the truth for these.
  let baseTier: { tier: PlanTier; period: BillingPeriod } | null = null;
  let seatQuantity = 0;
  for (const item of sub.items?.data ?? []) {
    const key = item.price?.lookup_key ?? null;
    if (!key) continue;
    const parsed = tierFor(key);
    if (parsed) baseTier = parsed;
    else if (key.startsWith('extra_seat_')) seatQuantity = item.quantity ?? 0;
  }

  if (baseTier) {
    update.plan_tier = baseTier.tier;
    update.billing_period = baseTier.period;
    update.seat_count = PLANS[baseTier.tier].includedSeats + seatQuantity;
  }
  // No recognizable base item means this subscription was not created by this
  // system. Mirror the status and leave the plan columns alone rather than
  // writing nulls over good data.

  const { error } = await supabase.from('organizations').update(update).eq('id', orgId);
  if (error) {
    console.error(`${eventType}: billing mirror failed for org ${orgId}:`, error.message);
    await supabase.from('platform_alerts').insert({
      alert_type: 'billing_mirror_failed',
      organization_id: orgId,
      details: { subscription_id: sub.id, message: error.message },
    });
  }
```

Check `platform_alerts`' real column names in `supabase/migrations/085_platform_alerts.sql` before writing that insert, and match them.

- [ ] **Step 3: Add the `checkout.session.completed` handler**

Add a case to the dispatcher's switch and a handler that resolves the org from `session.metadata.organization_id` (falling back to the subscription's metadata), writes a `tenant_subscription_events` row carrying `session_id` and `amount_total`, and updates `billing_email` from `session.customer_details?.email` only when the org's `billing_email` is null.

- [ ] **Step 4: Run and commit**

```bash
npm run test:integration -- stripe/webhook
npx tsc --noEmit
git add src/lib/payments/dispatchStripeEvent.ts src/app/api/stripe/webhook/route.integration.test.ts
git commit -m "$(cat <<'MSG'
feat(billing): mirror tier, period, seats, cancel, and pause from Stripe

Stripe is the source of truth for what an organization bought. Everything the
mirror needs is already on the subscription payload, so there is no extra fetch.

An unrecognized base lookup key leaves the plan columns untouched rather than
writing nulls over good data, and a failed mirror raises a platform alert.

Adds checkout.session.completed for the audit trail; fulfillment still keys off
customer.subscription.created, which arrives in the same burst.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 20: the nightly mirror reconcile

**Files:**
- Modify: `src/lib/payments/reconcile.ts`
- Modify: `src/app/api/cron/reconcile-payments/route.ts`
- Test: `src/lib/payments/reconcile.test.ts` (or the co-located suite that exists)

**Interfaces:**
- Consumes: `retrieveSubscription` (Task 17), `tierFor`, `PLANS` (PR D Task 2).
- Produces: `reconcileBillingMirror(supabase)` returning a summary object.

**Context an implementer cannot infer:**
- Jobs here are **not** registered in a list. Each is imported by name and explicitly awaited in sequence in `src/app/api/cron/reconcile-payments/route.ts` around lines 62-76, and the results are merged into one JSON object. Add the new job the same way.
- `retryFailedPayouts` at `src/lib/payments/reconcile.ts:986-1019` is the closest template for shape: signature, error handling, and the summary it returns.
- This job must **never** import `src/lib/billing/guard.ts`. PR D's invariant test will fail the build if it does. Importing `plans.ts` and `access.ts` is fine; only the guard is forbidden.
- Only reconcile organizations with a `subscription_id` and a status of `active`, `past_due`, or `unpaid`. A trialing or comped org has nothing at Stripe to compare against.
- Repair drift by writing the Stripe values onto the row, and raise a `platform_alerts` row for every repair. A silent repair hides a webhook that is not working.
- Keep it cheap: this runs nightly over every paying tenant, so one `subscriptions.retrieve` per org and nothing else.

- [ ] **Step 1: Write the failing test**

Cover: an org whose row matches Stripe is left alone and counted as checked; an org whose `seat_count` differs is repaired and alerted; an org with no `subscription_id` is skipped; and a Stripe error for one org does not abort the sweep for the others.

- [ ] **Step 2: Write the job, following `retryFailedPayouts`' shape**

```ts
/**
 * Nightly: compare each paying organization's mirrored plan columns to Stripe
 * and repair drift. The webhook is the primary path; this is the backstop, so
 * DB state never depends on a single delivery. Every repair raises an alert,
 * because a silent repair hides a webhook that is not working.
 */
export async function reconcileBillingMirror(supabase: SupabaseClient) {
  // ... same structure as retryFailedPayouts: load candidates, loop with a
  // per-org try/catch so one failure cannot abort the sweep, return
  // { checked, repaired, failed, details }.
}
```

- [ ] **Step 3: Await it in the cron route**

Add it alongside the existing jobs in `src/app/api/cron/reconcile-payments/route.ts` and merge its summary into the response object under `billing_mirror`.

- [ ] **Step 4: Run and commit**

```bash
npm run test -- reconcile
npm run test:unit -- guard.test     # the import invariant must still pass
npx tsc --noEmit
git add src/lib/payments/reconcile.ts src/app/api/cron/reconcile-payments/route.ts
git commit -m "$(cat <<'MSG'
feat(billing): nightly reconcile of the plan mirror against Stripe

The webhook is the primary path; this is the backstop, so database state never
depends on a single delivery. Every repair raises a platform alert, because a
silent repair hides a webhook that is not working.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 21: the Stripe setup script

**Files:**
- Create: `scripts/stripe-billing-setup.ts`

**Interfaces:**
- Consumes: `PLANS`, `LOOKUP_KEYS`, `EXTRA_SEAT_MONTHLY_CENTS`, `EXTRA_SEAT_ANNUAL_CENTS` (PR D Task 2).
- Produces: four Products, eight Prices, one Portal configuration in whichever Stripe account the key points at.

**Context an implementer cannot infer:**
- **One Product per tier**, plus one for the seat. Checkout and invoices print the Product name on each line, so tiers sharing a Product would be indistinguishable on a customer's invoice. This is Stripe's own stated guidance.
- Annual Prices are `recurring: { interval: 'year' }` with `unit_amount` equal to **twelve times** the per-month display figure: $348, $948, $1,668. They are one upfront charge per year, not a monthly charge on a twelve-month commitment.
- The annual seat Price is $120/yr, which is `EXTRA_SEAT_ANNUAL_CENTS`.
- `tax_behavior: 'exclusive'` on every Price.
- **Idempotent and never destructive.** Look up by lookup key and by `metadata.nexxus_plan` before creating anything, print what was found and what was created, and never delete or archive.
- The Portal configuration is tagged `metadata.nexxus_portal = 'default'` and enables invoice history, payment method update, customer update (email, address, name), and cancel at period end with the built-in cancellation-reason survey. `subscription_update` is **disabled**, because plan changes happen in the app. Tax ID collection stays off until Stripe Tax is on.
- For a future price change, the script should note in its output that the new Price must be created with `transfer_lookup_key: true`, which moves the key and leaves existing subscribers on their old Price. That is how the pricing doc's 60-day-notice promise stays cheap.
- The script runs with `npx tsx scripts/stripe-billing-setup.ts` and needs `STRIPE_SECRET_KEY` and `STRIPE_ENABLED=true` in the environment.

- [ ] **Step 1: Write the script**

Structure it as: read the key and instantiate through `getStripe()`; `ensureProduct(tier)` for each of the four; `ensurePrice(lookupKey, productId, unitAmount, interval)` for each of the eight; `ensurePortalConfiguration()`; then print a summary table of every id with `created` or `found` beside it.

- [ ] **Step 2: Dry-run against a sandbox**

```bash
STRIPE_ENABLED=true STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe-billing-setup.ts
```

Expected: creates four Products, eight Prices, one configuration. Run it a second time: expected to create nothing and report all thirteen as found.

- [ ] **Step 3: Commit**

```bash
git add scripts/stripe-billing-setup.ts
git commit -m "$(cat <<'MSG'
feat(billing): idempotent Stripe product, price, and portal setup

Four Products, one per tier plus the seat, because Checkout and invoices print
the Product name per line and tiers sharing one would be indistinguishable.
Eight Prices keyed by lookup key, so test and live differ only in which account
the key points at.

Never deletes or archives. A future price change creates a new Price with
transfer_lookup_key so existing subscribers stay on their old one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 22: delete the old purchase path

**Files:**
- Delete: `src/app/api/stripe/billing/subscriptions/start/route.ts` and `route.integration.test.ts`
- Modify: `src/lib/payments/orgBilling.ts` (remove `startOrgSubscription`)
- Modify: `src/lib/stripe/billing.ts` (remove `createStripeSubscription` if it has no other caller)

**Context an implementer cannot infer:**
- Two purchase paths is one too many. The old route creates a subscription directly with a payment intent client secret and predates the Checkout design entirely.
- Before deleting `createStripeSubscription`, grep for every caller. If something outside the start route uses it, leave it and say so in the commit message.
- The start route has an existing integration test that mocks `@/lib/stripe/billing`; delete it with the route.
- After deleting, run the full suite: any import of a removed symbol becomes a type error.

- [ ] **Step 1: Confirm nothing else calls them**

```bash
grep -rn "startOrgSubscription\|createStripeSubscription\|billing/subscriptions/start" src/ tests/
```

- [ ] **Step 2: Delete and verify**

```bash
git rm -r src/app/api/stripe/billing/subscriptions/start
# then remove startOrgSubscription from orgBilling.ts and createStripeSubscription
# from stripe/billing.ts if the grep showed no other caller
npm run test
npx tsc --noEmit
npm run lint
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'MSG'
refactor(billing): delete the pre-Checkout subscription start path

Two purchase paths is one too many. POST /api/billing/checkout replaces it, and
the old route predates the Checkout design entirely.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
MSG
)"
```

---

### Task 23: stack, verify, and open PR E

- [ ] **Step 1: Run every gate**

```bash
npm run test
npx tsc --noEmit
npm run lint
BILLING_ENFORCEMENT_ENABLED=true npm run test:integration
```

- [ ] **Step 2: Push and stack**

```bash
git push -u origin feat/phase1b-stripe-billing
gh pr create --base feat/phase1b-billing-core --title "feat(billing): Stripe subscriptions, Checkout, and webhook mirroring (Phase 1b, PR E)" --body "<as below>"
gh stack init feat/phase1b-billing-core feat/phase1b-stripe-billing
gh stack submit
```

The body should record: the eight Prices and why there are eight rather than seven; that checkout and plan are deliberately never guarded; that `integration_identifier` is omitted and why (ruling R1); that immediate prorated downgrades are an accepted deviation (spec §18 item 1); and that the ops steps in spec §20 must run before the flag is flipped.

- [ ] **Step 3: Merge bottom-up**

Wait for PR D's four required checks, merge it with `gh stack merge --yes --squash <D>`, wait for PR E to be auto-rebased and re-checked (roughly fifteen minutes), then merge PR E the same way. Never use the atomic whole-stack merge: the two E2E checks attach via `deployment_status` and the collapse cannot map them.

- [ ] **Step 4: Clean up**

```bash
git worktree remove .claude/worktrees/phase1b
git branch -d feat/phase1b-billing-core feat/phase1b-stripe-billing
```

---

## What this plan deliberately does not build

- **The Billing UI** (plan picker, pill, banner, paywall, seats control). That is PR F, and it goes through the `ui-feature-workflow` skill.
- **The back office** (comp, un-comp with runway, platform extend, pause, resume, cancel, tenant notes, roster columns and filters). That is PR G. PR E builds the library functions it will call.
- **Per-tier feature gates.** Out of scope for Phase 1 by locked decision.
- **RLS hardening** of the Phase 1a tables. A follow-up once no client writes remain.
- **Self-serve pause.** Waits for the cancellation-flow work.

## Follow-ups this plan creates

1. **Stripe SDK upgrade.** `stripe@20.1.2` pinned to `apiVersion 2025-12-15.clover`. Bumping unlocks `integration_identifier` (ruling R1) but touches every charge, transfer, Connect, and payout call, so it needs its own PR with a full payments regression pass.
2. **The two remaining bare `APP_URL` readers** in `platform/organizations` and `admin/send-invite`, which would render the literal string `"undefined/..."`. Repoint them at `requireAppUrl()` (ruling R5).
3. **A shared `platform_audit_log` write helper.** Five routes inline the same insert independently. PR G should extract one.
4. **`src/lib/settings.ts` is dead code** with no importers outside its own test. Delete it, or delete the comment in `sections.ts` that points at it (ruling R3).

---

## Self-review

**Spec coverage.** §5 data model is Task 1. §6 catalog is Task 2. §7 state machine is Task 4. §8 trial is Tasks 11 and 12. §9 seats is Task 10. §10.1 setup script is Task 21, §10.2 resolvers Task 14, §10.3 checkout Task 16, §10.4 changePlan Tasks 15 and 17, §10.5 portal Task 13, §10.6 pause and cancel Task 18, §10.7 webhooks Task 19. §11.1 guard is Task 6, §11.2 guarded routes are Tasks 7 through 10, §11.3 the not-guarded invariant is Task 6's import test. §16 events and alerts are Tasks 16, 19, and 20. §5.2 `unpaid` is Task 5. §5.5 `platform_stats` is Task 1. §11.4 the client hook is PR F, not this plan, but `keys.billing` lands in Task 12 so PR F has its query key. §22 open items 2, 3, 4, and 6 are resolved as rulings R3, R2, R1, and R5.

**Not covered by any task, deliberately:** §12 (Phase 1a route design, already shipped), §13 UX, §14 back office, §15 permissions beyond what each route enforces, §20 ops steps (Bridger's, not code).

**Type consistency.** `BillingPeriod` and `PlanTier` are declared once in `plans.ts` and imported everywhere. `OrgSubscriptionStatus` and `OrgBillingRow` are declared once in `access.ts`; Task 5 deletes the duplicate in `orgBilling.ts` and re-exports. `ORG_BILLING_COLUMNS` is the single select list. `assertOrgWritable` returns `{ ok: true } | { ok: false; response }`, matching the existing `RequireOrgAuthResult` shape so route code reads the same either way.
