# Cleaner-Request Pay Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the flexible-contractor pay-mode umbrella from `docs/superpowers/specs/2026-07-26-cleaner-request-pay-model-design.md`: per-cleaner `payout_model` gains `flat` and `request`, request-mode cleaners name their pay at completion, an org min-margin threshold auto-approves or escalates to an approve/counter thread, and settlement transfers defer until approval.

**Architecture:** Four sequential PRs off `origin/master`: (1) schema + pure logic (inert), (2) request lifecycle backend + settlement integration (the money core), (3) org UI, (4) cleaner UI + E2E. New state lives in `pay_requests` (one per appointment) + `pay_request_offers` (history); settlement resolves the cleaner's cents per mode via a new pure resolver and a cents-based split function; the existing charge path is untouched except a self-pay precondition bail.

**Tech Stack:** Next.js 16 App Router routes, Supabase (Postgres migration 114+, RLS, realtime), Stripe via existing `settleCleanerPayout`/`chargeCompletedAppointment` orchestration, Vitest integration tests with `tests/helpers/`, TanStack Query v5 + `useSupabaseRealtimeSync` on the client.

## Global Constraints

- **Base:** build in a fresh worktree branched from `origin/master` (the landing-page worktree is 18 commits behind and missing T1-4/5/6/7/10 money code — do NOT build there). Cherry-pick the spec commit `6cf912a` onto the first PR branch.
- **Migration number:** expected `114`. T1-11 (parked) also plans to take 114 — run `ls supabase/migrations | sort | tail -3` at branch time and renumber to the next free slot if needed. Never renumber after pushing.
- **Money PRs (PR1, PR2) are NOT auto-merged.** Bridger merges, after the adversarial review workflow passes (PR1: 2-lens; PR2: 3-lens, Lane-B style).
- **Value-space rename is write-side only:** DB constraints stay permissive (`'percentage_contractor'` remains legal) so in-flight writes from the previous deploy can't violate; app code writes only `'percentage'`; no read site may branch on `=== 'percentage'` (only on `'hourly_external'`, `'flat'`, `'request'`, with percentage as the default branch) so residual old values behave identically.
- **No em dashes in any user-facing copy** (UI text, toasts, notifications, error messages).
- **Column/copy traps:** `appointments.total_price` is dollars `numeric(10,2)` → cents via `Math.round(Number(total_price) * 100)`; `payouts.amount` is dollars → write `cents / 100`. `cleaner_profiles.id` IS the auth user id.
- **Gates before every push:** `npm run test`, `npx tsc --noEmit` (no NEW errors), `npm run lint`; if the migration changed, `npx supabase db reset` first. Baseline flaky-suite caveat: compare failures against a detached `origin/master` run, CI arbitrates.
- **Transfer idempotency keys are sacred:** `cleaner-payout-${appointmentId}`, `tenant-payout-${appointmentId}`, `selfpay-cleaner-${appointmentId}` — never mint new key shapes for the same money movement.
- **UI PRs (PR3, PR4)** go through the `ui-feature-workflow` skill (ask Bridger about the browser companion + mobile/desktop at that phase) and `ui-ux-pro-max` at design AND implementation; build only from `src/components/ui/*` primitives + tokens.

---

## Phase 1 — PR1 `feat/pay-mode-schema`: migration + pure logic (inert)

### Task 1: Build worktree + branch + spec docs

**Files:** none modified (setup only)

- [ ] **Step 1: Create the worktree and branch**

```bash
cd /Users/bridgerdavidson/Builds/nexxus-cleaning-platform
git fetch origin master
git worktree add .claude/worktrees/pay-request-model -b feat/pay-mode-schema origin/master
cd .claude/worktrees/pay-request-model
git cherry-pick 6cf912a   # spec + brainstorming log commit from docs/cleaner-request-pay-model-spec
```

Expected: cherry-pick applies clean (docs-only commit).

- [ ] **Step 2: Verify migration numbering**

```bash
ls supabase/migrations | sort | tail -3
```

Expected: `113_...` is the highest. If `114_*` exists (T1-11 landed), use `115` everywhere this plan says `114`.

- [ ] **Step 3: Copy the plan into the worktree and commit**

```bash
cp <this file> docs/superpowers/plans/2026-07-26-cleaner-request-pay-model.md
git add docs/superpowers/plans/2026-07-26-cleaner-request-pay-model.md
git commit -m "docs: implementation plan for the cleaner-request pay model"
```

### Task 2: Migration 114

**Files:**
- Create: `supabase/migrations/114_pay_requests.sql`

**Interfaces:**
- Produces: tables `pay_requests`, `pay_request_offers`; columns `organizations.min_margin_bps`, `cleaner_profiles.flat_rate_cents`, `payouts.pay_request_id`, `payouts.payout_model_snapshot`; permissive payout-model constraints incl. `'percentage'|'flat'|'request'`.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 114: cleaner-request pay model (flexible contractor umbrella).
-- Spec: docs/superpowers/specs/2026-07-26-cleaner-request-pay-model-design.md
-- 1) Unify payout-model values: 'percentage' replaces 'percentage_contractor'.
--    Constraints stay PERMISSIVE (old spelling remains legal) so writes from the
--    previous deploy can't violate mid-rollout; app code writes new values only.
-- 2) organizations.min_margin_bps  - request-mode auto-approve threshold.
-- 3) cleaner_profiles.flat_rate_cents - flat-per-job mode parameter.
-- 4) pay_requests + pay_request_offers - negotiation thread. Writes are
--    service-role only (no INSERT/UPDATE policies); reads mirror payouts_select.
-- 5) payouts.pay_request_id + payout_model_snapshot.
-- Idempotent.

-- 1a. organizations.default_payout_model
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_default_payout_model_chk;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_default_payout_model_chk
  CHECK (default_payout_model IN ('percentage','flat','request','hourly_external','percentage_contractor'));
UPDATE public.organizations SET default_payout_model = 'percentage'
 WHERE default_payout_model = 'percentage_contractor';
ALTER TABLE public.organizations ALTER COLUMN default_payout_model SET DEFAULT 'percentage';

-- 1b. cleaner_profiles.payout_model
ALTER TABLE public.cleaner_profiles DROP CONSTRAINT IF EXISTS cleaner_profiles_payout_model_chk;
ALTER TABLE public.cleaner_profiles ADD CONSTRAINT cleaner_profiles_payout_model_chk
  CHECK (payout_model IN ('percentage','flat','request','hourly_external','percentage_contractor'));
UPDATE public.cleaner_profiles SET payout_model = 'percentage'
 WHERE payout_model = 'percentage_contractor';
ALTER TABLE public.cleaner_profiles ALTER COLUMN payout_model SET DEFAULT 'percentage';

-- 2. Auto-approve threshold: org must keep at least this share of job price.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS min_margin_bps integer NOT NULL DEFAULT 2000;
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_min_margin_bps_chk;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_min_margin_bps_chk
  CHECK (min_margin_bps >= 0 AND min_margin_bps <= 10000);

-- 3. Flat-per-job rate.
ALTER TABLE public.cleaner_profiles
  ADD COLUMN IF NOT EXISTS flat_rate_cents integer;
ALTER TABLE public.cleaner_profiles DROP CONSTRAINT IF EXISTS cleaner_profiles_flat_rate_cents_chk;
ALTER TABLE public.cleaner_profiles ADD CONSTRAINT cleaner_profiles_flat_rate_cents_chk
  CHECK (flat_rate_cents IS NULL OR flat_rate_cents >= 0);

-- 4a. pay_requests: one negotiation thread per appointment.
CREATE TABLE IF NOT EXISTS public.pay_requests (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES public.organizations(id),
  appointment_id            uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  cleaner_id                uuid NOT NULL,
  status                    text NOT NULL CHECK (status IN ('pending_org','pending_cleaner','approved')),
  job_price_cents_snapshot  integer NOT NULL CHECK (job_price_cents_snapshot >= 0),
  approved_amount_cents     integer CHECK (approved_amount_cents >= 0),
  approved_via              text CHECK (approved_via IN ('auto','org','cleaner_accept')),
  approved_by               uuid,
  approved_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pay_requests_appointment_uniq UNIQUE (appointment_id),
  CONSTRAINT pay_requests_approved_shape CHECK (
    (status = 'approved') = (approved_amount_cents IS NOT NULL AND approved_via IS NOT NULL AND approved_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_pay_requests_org_status ON public.pay_requests (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pay_requests_cleaner    ON public.pay_requests (cleaner_id, status);

ALTER TABLE public.pay_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pay_requests_select ON public.pay_requests;
CREATE POLICY pay_requests_select ON public.pay_requests
  FOR SELECT TO authenticated
  USING (
    cleaner_id = (select auth.uid())
    OR EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = pay_requests.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON om.user_id = mp.manager_id WHERE om.organization_id = pay_requests.organization_id AND om.user_id = (select auth.uid()) AND om.role = 'manager'::public.org_role AND mp.can_view_payments = true)
    OR public.is_platform_admin((select auth.uid()))
  );
-- No INSERT/UPDATE/DELETE policies: service-role routes only.

-- 4b. pay_request_offers: append-only offer history.
CREATE TABLE IF NOT EXISTS public.pay_request_offers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_request_id           uuid NOT NULL REFERENCES public.pay_requests(id) ON DELETE CASCADE,
  actor                    text NOT NULL CHECK (actor IN ('cleaner','org')),
  actor_user_id            uuid NOT NULL,
  amount_cents             integer NOT NULL CHECK (amount_cents >= 0),
  note                     text,
  min_margin_bps_snapshot  integer,
  auto_approved            boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pay_request_offers_request ON public.pay_request_offers (pay_request_id, created_at);

ALTER TABLE public.pay_request_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pay_request_offers_select ON public.pay_request_offers;
CREATE POLICY pay_request_offers_select ON public.pay_request_offers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pay_requests pr
       WHERE pr.id = pay_request_offers.pay_request_id
         AND (
           pr.cleaner_id = (select auth.uid())
           OR EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = pr.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
           OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON om.user_id = mp.manager_id WHERE om.organization_id = pr.organization_id AND om.user_id = (select auth.uid()) AND om.role = 'manager'::public.org_role AND mp.can_view_payments = true)
           OR public.is_platform_admin((select auth.uid()))
         )
    )
  );

-- 4c. Realtime (queue badges + thread views).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pay_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pay_requests;
  END IF;
END $$;
ALTER TABLE public.pay_requests REPLICA IDENTITY FULL;

-- 5. payouts provenance columns.
ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS pay_request_id uuid REFERENCES public.pay_requests(id),
  ADD COLUMN IF NOT EXISTS payout_model_snapshot text;
```

- [ ] **Step 2: Verify the schema rebuilds and is idempotent**

```bash
npx supabase db reset
```

Expected: completes with no errors. Then re-apply idempotency: `npx supabase db reset` again (or run the file twice in a BEGIN/ROLLBACK) — no errors.

- [ ] **Step 3: Run integration tests against the new schema**

```bash
npm run test:integration
```

Expected: same pass rate as detached `origin/master` baseline (no new failures).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/114_pay_requests.sql
git commit -m "feat(payments): migration 114 - pay_requests, pay mode value space, min_margin_bps"
```

### Task 3: Types + value-space write sweep + test-helper extension

**Files:**
- Modify: `src/types/index.ts` (PayoutModel union, PayRequest/PayRequestOffer interfaces, `CleanerProfile.payout_model`/`flat_rate_cents`, `Payout.pay_request_id`/`payout_model_snapshot`)
- Modify: every writer/validator of `'percentage_contractor'` (grep list below)
- Modify: `tests/helpers/fixtures.ts`
- Test: type-level (tsc) + existing suites stay green

**Interfaces:**
- Produces: `export type PayoutModel = 'percentage' | 'flat' | 'request' | 'hourly_external'` in `src/types/index.ts`; `WithTestOrgOptions` gains `cleanerPayoutModel?: PayoutModel`, `flatRateCents?: number`, `minMarginBps?: number`; `PayRequest`, `PayRequestOffer` interfaces matching migration columns exactly.

- [ ] **Step 1: Enumerate every touchpoint**

```bash
grep -rn "percentage_contractor" src tests --include="*.ts" --include="*.tsx" | grep -v migrations
```

Known list (verify against grep output; fix ALL): `src/types/index.ts:100`, `src/app/api/organizations/[orgId]/profile/route.ts` (validation set + error copy), `src/components/redesign/settings/sections/PayoutSettingsSection.tsx` (RadioGroup values + load fallback), `src/components/redesign/cleaner/today/today-types.ts` (`CleanerPayoutModel`), `src/components/redesign/cleaner/earnings/deriveEarnings.ts` + tests, `src/components/redesign/cleaner/profile/deriveProfile.ts` + tests, `tests/helpers/fixtures.ts` (`defaultPayoutModel` option type), `src/types/platform.ts`, plus any test fixtures.

- [ ] **Step 2: Apply the sweep**

Rules: writes/validators use `'percentage'`; UI `load()` functions normalize `'percentage_contractor'` → `'percentage'` for display (`const model = raw === 'percentage_contractor' ? 'percentage' : raw`); NO read site branches on `=== 'percentage'`. Add to `src/types/index.ts`:

```ts
export type PayoutModel = 'percentage' | 'flat' | 'request' | 'hourly_external';

export type PayRequestStatus = 'pending_org' | 'pending_cleaner' | 'approved';
export type PayRequestApprovedVia = 'auto' | 'org' | 'cleaner_accept';

export interface PayRequest {
  id: string;
  organization_id: string;
  appointment_id: string;
  cleaner_id: string; // References cleaner_profiles(id) = auth user id
  status: PayRequestStatus;
  job_price_cents_snapshot: number;
  approved_amount_cents: number | null;
  approved_via: PayRequestApprovedVia | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayRequestOffer {
  id: string;
  pay_request_id: string;
  actor: 'cleaner' | 'org';
  actor_user_id: string;
  amount_cents: number;
  note: string | null;
  min_margin_bps_snapshot: number | null;
  auto_approved: boolean;
  created_at: string;
}
```

Update `CleanerProfile` (add `payout_model: PayoutModel; flat_rate_cents: number | null;`), `Payout` (add `pay_request_id: string | null; payout_model_snapshot: PayoutModel | null;`), `Organization` (`default_payout_model?: PayoutModel; min_margin_bps: number;`).

- [ ] **Step 3: Extend `withTestOrg`**

In `tests/helpers/fixtures.ts`, extend the options and the seed writes:

```ts
export interface WithTestOrgOptions {
  payoutPercent?: number;
  stripeConnectOnboardingComplete?: boolean;
  stripeConnectAccountId?: string;
  defaultPayoutModel?: PayoutModel;
  platformFeeBps?: number;
  cleanerPayoutModel?: PayoutModel;   // cleaner_profiles.payout_model, default 'percentage'
  flatRateCents?: number;             // cleaner_profiles.flat_rate_cents
  minMarginBps?: number;              // organizations.min_margin_bps, default DB 2000
}
```

Seed `payout_model: opts.cleanerPayoutModel ?? 'percentage'` and `flat_rate_cents: opts.flatRateCents ?? null` in the `cleaner_profiles` insert; when `minMarginBps` is set, update the org row after creation (same pattern as `platformFeeBps`).

- [ ] **Step 4: Gates**

```bash
npx tsc --noEmit && npm run lint && npm run test:unit
```

Expected: zero NEW tsc errors, lint clean, unit suite at baseline.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(payments): unified PayoutModel value space + pay-request types + fixture options"
```

### Task 4: Threshold math (TDD)

**Files:**
- Create: `src/lib/payments/payRequests/threshold.ts`
- Test: `src/lib/payments/payRequests/threshold.test.ts`

**Interfaces:**
- Produces: `autoApproveMaxCents(jobPriceCents: number, minMarginBps: number): number`; `isAutoApproved(requestCents: number, jobPriceCents: number, minMarginBps: number): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { autoApproveMaxCents, isAutoApproved } from './threshold';

describe('autoApproveMaxCents', () => {
  it('floors: $350 job at 20% margin -> max $280.00', () => {
    expect(autoApproveMaxCents(35000, 2000)).toBe(28000);
  });
  it('floors fractional cents down', () => {
    // 333 * 0.8 = 266.4 -> 266
    expect(autoApproveMaxCents(333, 2000)).toBe(266);
  });
  it('bps 0 auto-approves up to full price', () => {
    expect(autoApproveMaxCents(35000, 0)).toBe(35000);
  });
  it('bps 10000 auto-approves only $0', () => {
    expect(autoApproveMaxCents(35000, 10000)).toBe(0);
  });
  it('rejects non-integer or out-of-range inputs', () => {
    expect(() => autoApproveMaxCents(100.5, 2000)).toThrow();
    expect(() => autoApproveMaxCents(-1, 2000)).toThrow();
    expect(() => autoApproveMaxCents(100, -1)).toThrow();
    expect(() => autoApproveMaxCents(100, 10001)).toThrow();
  });
});

describe('isAutoApproved', () => {
  it('inclusive boundary: exactly the max approves', () => {
    expect(isAutoApproved(28000, 35000, 2000)).toBe(true);
  });
  it('one cent over the max escalates', () => {
    expect(isAutoApproved(28001, 35000, 2000)).toBe(false);
  });
  it('$0 request always approves', () => {
    expect(isAutoApproved(0, 35000, 10000)).toBe(true);
  });
  it('over-price request escalates (never throws - price leak guard)', () => {
    expect(isAutoApproved(40000, 35000, 2000)).toBe(false);
  });
  it('rejects negative/non-integer request cents', () => {
    expect(() => isAutoApproved(-1, 35000, 2000)).toThrow();
    expect(() => isAutoApproved(10.5, 35000, 2000)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test:unit -- threshold` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
/**
 * Request-mode auto-approve threshold (spec §5).
 * autoApproveMaxCents = floor(price * (10000 - minMarginBps) / 10000).
 * A request auto-approves iff request <= max (inclusive). Over-price requests
 * are legal inputs and simply escalate - rejecting them would leak the hidden
 * price through the error message.
 */
export function autoApproveMaxCents(jobPriceCents: number, minMarginBps: number): number {
  if (!Number.isInteger(jobPriceCents) || jobPriceCents < 0) {
    throw new Error('autoApproveMaxCents: jobPriceCents must be a non-negative integer');
  }
  if (!Number.isInteger(minMarginBps) || minMarginBps < 0 || minMarginBps > 10000) {
    throw new Error('autoApproveMaxCents: minMarginBps must be an integer between 0 and 10000');
  }
  return Math.floor((jobPriceCents * (10000 - minMarginBps)) / 10000);
}

export function isAutoApproved(requestCents: number, jobPriceCents: number, minMarginBps: number): boolean {
  if (!Number.isInteger(requestCents) || requestCents < 0) {
    throw new Error('isAutoApproved: requestCents must be a non-negative integer');
  }
  return requestCents <= autoApproveMaxCents(jobPriceCents, minMarginBps);
}
```

- [ ] **Step 4: Run to verify pass** — `npm run test:unit -- threshold` → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/payments/payRequests && git commit -m "feat(payments): pay-request auto-approve threshold math"`

### Task 5: State machine transitions (TDD)

**Files:**
- Create: `src/lib/payments/payRequests/transitions.ts`
- Test: `src/lib/payments/payRequests/transitions.test.ts`

**Interfaces:**
- Produces: `type PayRequestAction = 'org_approve' | 'org_counter' | 'cleaner_accept' | 'cleaner_counter'`; `nextStatus(current: PayRequestStatus, action: PayRequestAction, opts?: { autoApproved?: boolean }): PayRequestStatus` (throws `PayRequestTransitionError` on illegal transitions); `initialStatus(actor: 'cleaner' | 'org', autoApproved: boolean): PayRequestStatus`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { initialStatus, nextStatus, PayRequestTransitionError } from './transitions';

describe('initialStatus', () => {
  it('cleaner submit within threshold -> approved', () => {
    expect(initialStatus('cleaner', true)).toBe('approved');
  });
  it('cleaner submit over threshold -> pending_org', () => {
    expect(initialStatus('cleaner', false)).toBe('pending_org');
  });
  it('org-authored amount always awaits the cleaner (consent symmetry)', () => {
    expect(initialStatus('org', true)).toBe('pending_cleaner');
    expect(initialStatus('org', false)).toBe('pending_cleaner');
  });
});

describe('nextStatus', () => {
  it('pending_org + org_approve -> approved', () => {
    expect(nextStatus('pending_org', 'org_approve')).toBe('approved');
  });
  it('pending_org + org_counter -> pending_cleaner', () => {
    expect(nextStatus('pending_org', 'org_counter')).toBe('pending_cleaner');
  });
  it('pending_cleaner + cleaner_accept -> approved', () => {
    expect(nextStatus('pending_cleaner', 'cleaner_accept')).toBe('approved');
  });
  it('pending_cleaner + cleaner_counter re-runs threshold', () => {
    expect(nextStatus('pending_cleaner', 'cleaner_counter', { autoApproved: true })).toBe('approved');
    expect(nextStatus('pending_cleaner', 'cleaner_counter', { autoApproved: false })).toBe('pending_org');
  });
  it('every other combination throws (incl. anything from approved)', () => {
    expect(() => nextStatus('approved', 'org_approve')).toThrow(PayRequestTransitionError);
    expect(() => nextStatus('pending_org', 'cleaner_accept')).toThrow(PayRequestTransitionError);
    expect(() => nextStatus('pending_org', 'cleaner_counter')).toThrow(PayRequestTransitionError);
    expect(() => nextStatus('pending_cleaner', 'org_approve')).toThrow(PayRequestTransitionError);
    expect(() => nextStatus('pending_cleaner', 'org_counter')).toThrow(PayRequestTransitionError);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import type { PayRequestStatus } from '@/types';

export type PayRequestAction = 'org_approve' | 'org_counter' | 'cleaner_accept' | 'cleaner_counter';

export class PayRequestTransitionError extends Error {
  constructor(current: PayRequestStatus, action: PayRequestAction) {
    super(`Illegal pay-request transition: ${action} from ${current}`);
    this.name = 'PayRequestTransitionError';
  }
}

/** Where a brand-new thread starts (spec §5 consent symmetry). */
export function initialStatus(actor: 'cleaner' | 'org', autoApproved: boolean): PayRequestStatus {
  if (actor === 'org') return 'pending_cleaner';
  return autoApproved ? 'approved' : 'pending_org';
}

export function nextStatus(
  current: PayRequestStatus,
  action: PayRequestAction,
  opts: { autoApproved?: boolean } = {},
): PayRequestStatus {
  if (current === 'pending_org' && action === 'org_approve') return 'approved';
  if (current === 'pending_org' && action === 'org_counter') return 'pending_cleaner';
  if (current === 'pending_cleaner' && action === 'cleaner_accept') return 'approved';
  if (current === 'pending_cleaner' && action === 'cleaner_counter') {
    return opts.autoApproved ? 'approved' : 'pending_org';
  }
  throw new PayRequestTransitionError(current, action);
}
```

- [ ] **Step 4: Run to verify pass**, **Step 5: Commit** — `feat(payments): pay-request state machine transitions`

### Task 6: Cents-based split + per-mode share resolver + payable predicate (TDD)

**Files:**
- Modify: `src/lib/stripe/charges/splits.ts` (add `computePaymentSplitFromCents`)
- Create: `src/lib/payments/payMode.ts`
- Modify: `src/lib/payments/isCleanerPayable.ts`
- Test: `src/lib/stripe/charges/splits.test.ts` (extend), `src/lib/payments/payMode.test.ts`, `src/lib/payments/isCleanerPayable.test.ts` (extend)

**Interfaces:**
- Produces:
  - `computePaymentSplitFromCents({ grossCents, cleanerCents, platformFeeBps }): PaymentSplit` — same fee-cap invariants as `computePaymentSplit` (`fee = min(platformFeeCentsFor(gross,bps), gross - cleaner)`, `remainder = gross - fee - cleaner`, all parts sum to gross); throws if `cleanerCents > grossCents`.
  - `resolveCleanerShareCents({ payoutModel, payoutPercent, flatRateCents, approvedRequestCents, grossCents }): { cents: number; capped: boolean; basis: 'percent' | 'flat' | 'request' | 'none' }` — percentage → `floor(gross*pct/100)` (identical to `computePaymentSplit`); flat → `min(flatRateCents, gross)` with `capped` flag; request → `min(approvedRequestCents, gross)` with `capped` flag (refund-shrunk base), **throws** if `approvedRequestCents == null`; `hourly_external` → `{ cents: 0, basis: 'none' }`.
  - `isCleanerPayable` becomes mode-aware: request → no amount precondition; flat → `flat_rate_cents > 0`; percentage (default branch, incl. legacy `'percentage_contractor'` residue) → `payout_percent > 0`; `hourly_external` → false. `CleanerPayoutFields` gains `flat_rate_cents?: number | null`.

- [ ] **Step 1: Write the failing tests** (key cases; mirror existing test style in each file)

```ts
// splits.test.ts additions
describe('computePaymentSplitFromCents', () => {
  it('matches computePaymentSplit for an equivalent percent', () => {
    const pct = computePaymentSplit({ grossCents: 10000, payoutPercent: 60, platformFeeBps: 100 });
    const cents = computePaymentSplitFromCents({ grossCents: 10000, cleanerCents: 6000, platformFeeBps: 100 });
    expect(cents).toEqual(pct);
  });
  it('caps the fee at the remainder when cleaner takes the whole gross', () => {
    const s = computePaymentSplitFromCents({ grossCents: 10000, cleanerCents: 10000, platformFeeBps: 100 });
    expect(s.platformFeeCents).toBe(0);
    expect(s.tenantRemainderCents).toBe(0);
  });
  it('always sums to gross', () => {
    const s = computePaymentSplitFromCents({ grossCents: 33333, cleanerCents: 29999, platformFeeBps: 100 });
    expect(s.platformFeeCents + s.cleanerCents + s.tenantRemainderCents).toBe(33333);
  });
  it('throws when cleanerCents exceeds gross', () => {
    expect(() => computePaymentSplitFromCents({ grossCents: 100, cleanerCents: 101, platformFeeBps: 0 })).toThrow();
  });
});

// payMode.test.ts (new file) - core cases
it('request mode uses the approved amount and flags refund-shrunk caps', () => {
  expect(resolveCleanerShareCents({ payoutModel: 'request', payoutPercent: 0, flatRateCents: null, approvedRequestCents: 28000, grossCents: 35000 }))
    .toEqual({ cents: 28000, capped: false, basis: 'request' });
  expect(resolveCleanerShareCents({ payoutModel: 'request', payoutPercent: 0, flatRateCents: null, approvedRequestCents: 28000, grossCents: 20000 }))
    .toEqual({ cents: 20000, capped: true, basis: 'request' });
});
it('request mode without an approved amount throws (settlement must gate first)', () => {
  expect(() => resolveCleanerShareCents({ payoutModel: 'request', payoutPercent: 0, flatRateCents: null, approvedRequestCents: null, grossCents: 20000 })).toThrow();
});
it('flat mode caps at gross', () => {
  expect(resolveCleanerShareCents({ payoutModel: 'flat', payoutPercent: 0, flatRateCents: 9500, approvedRequestCents: null, grossCents: 8000 }))
    .toEqual({ cents: 8000, capped: true, basis: 'flat' });
});
it('percentage (and legacy percentage_contractor) floors percent of gross', () => {
  for (const m of ['percentage', 'percentage_contractor']) {
    expect(resolveCleanerShareCents({ payoutModel: m, payoutPercent: 60, flatRateCents: null, approvedRequestCents: null, grossCents: 33333 }))
      .toEqual({ cents: 19999, capped: false, basis: 'percent' });
  }
});
it('hourly_external resolves to zero', () => {
  expect(resolveCleanerShareCents({ payoutModel: 'hourly_external', payoutPercent: 60, flatRateCents: null, approvedRequestCents: null, grossCents: 10000 }))
    .toEqual({ cents: 0, capped: false, basis: 'none' });
});

// isCleanerPayable.test.ts additions
it('request mode is payable once Connect-onboarded, regardless of percent', () => {
  expect(isCleanerPayable({ ...payable, payout_model: 'request', payout_percent: 0 })).toBe(true);
});
it('flat mode requires a positive flat rate', () => {
  expect(isCleanerPayable({ ...payable, payout_model: 'flat', payout_percent: 0, flat_rate_cents: 9500 })).toBe(true);
  expect(isCleanerPayable({ ...payable, payout_model: 'flat', payout_percent: 0, flat_rate_cents: 0 })).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** `computePaymentSplitFromCents` in `splits.ts` (validate integers, `cleanerCents <= grossCents`, then `platformFeeCents = Math.min(platformFeeCentsFor(grossCents, platformFeeBps), grossCents - cleanerCents)`, remainder = rest). `payMode.ts`:

```ts
export interface ResolveCleanerShareArgs {
  payoutModel: string | null | undefined;
  payoutPercent: number | string | null | undefined;
  flatRateCents: number | null | undefined;
  approvedRequestCents: number | null | undefined;
  grossCents: number;
}
export interface ResolvedCleanerShare {
  cents: number;
  capped: boolean;
  basis: 'percent' | 'flat' | 'request' | 'none';
}

/** One place that turns a cleaner's pay mode into cents-of-gross (spec §4/§6). */
export function resolveCleanerShareCents(args: ResolveCleanerShareArgs): ResolvedCleanerShare {
  const { payoutModel, grossCents } = args;
  if (!Number.isInteger(grossCents) || grossCents < 0) {
    throw new Error('resolveCleanerShareCents: grossCents must be a non-negative integer');
  }
  if (payoutModel === 'hourly_external') return { cents: 0, capped: false, basis: 'none' };
  if (payoutModel === 'request') {
    const approved = args.approvedRequestCents;
    if (approved == null || !Number.isInteger(approved) || approved < 0) {
      throw new Error('resolveCleanerShareCents: request mode requires an approved amount');
    }
    return { cents: Math.min(approved, grossCents), capped: approved > grossCents, basis: 'request' };
  }
  if (payoutModel === 'flat') {
    const flat = args.flatRateCents;
    if (flat == null || !Number.isInteger(flat) || flat < 0) {
      throw new Error('resolveCleanerShareCents: flat mode requires flat_rate_cents');
    }
    return { cents: Math.min(flat, grossCents), capped: flat > grossCents, basis: 'flat' };
  }
  // Default branch: percentage (covers legacy 'percentage_contractor' residue by design).
  const pct = Number(args.payoutPercent ?? 0);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new Error('resolveCleanerShareCents: payoutPercent must be between 0 and 100');
  }
  return { cents: Math.floor((grossCents * pct) / 100), capped: false, basis: 'percent' };
}
```

`isCleanerPayable.ts`:

```ts
export interface CleanerPayoutFields {
  payout_model?: string | null;
  stripe_connect_account_id?: string | null;
  stripe_connect_onboarding_complete?: boolean | null;
  payout_percent?: number | string | null;
  flat_rate_cents?: number | null;
}

export function isCleanerPayable(cleaner: CleanerPayoutFields | null | undefined): boolean {
  if (!cleaner) return false;
  if (cleaner.stripe_connect_onboarding_complete !== true) return false;
  if (!cleaner.stripe_connect_account_id) return false;
  const model = cleaner.payout_model;
  if (model === 'hourly_external') return false;
  if (model === 'request') return true; // amount arrives via the approved pay request
  if (model === 'flat') return Number(cleaner.flat_rate_cents) > 0;
  return Number(cleaner.payout_percent) > 0; // percentage (incl. legacy spelling)
}
```

- [ ] **Step 4: Run all three test files** → PASS. **Step 5: Commit** — `feat(payments): cents-based split, per-mode share resolver, mode-aware payability`

### Task 7: CHECKPOINT — PR1 gates, review, open PR

- [ ] **Step 1: Full local gates** — `npm run test && npx tsc --noEmit && npm run lint && npx supabase db reset` (all at baseline).
- [ ] **Step 2: 2-lens adversarial review workflow** (Workflow tool, ~4-6 agents): lens A "migration safety + rollout ordering" (permissive constraint reasoning, idempotency, RLS correctness vs payouts_select), lens B "value-space sweep completeness" (any missed `percentage_contractor` writer/reader that branches on it). Fix confirmed findings.
- [ ] **Step 3: Push, open PR** titled `feat(payments): pay-mode value space + pay_requests schema + pure logic (1/4)`, body links spec. **Bridger merges.** PR2 branches from this once merged (or stacks on it if he wants parallel review).

---

## Phase 2 — PR2 `feat/pay-request-lifecycle`: the money core

Branch from master after PR1 merges: `git checkout -b feat/pay-request-lifecycle origin/master`.

> **Added after the PR1 adversarial review:** PR1's migration 114 only WIDENS the payout-model
> constraints; it deliberately does not backfill data or flip column defaults (deploy-window
> safety: old equality-readers + old constraints). PR2 therefore ships **migration 115**:
> `UPDATE organizations/cleaner_profiles SET ... 'percentage' WHERE ... 'percentage_contractor'`,
> `ALTER COLUMN ... SET DEFAULT 'percentage'` on both tables, and in the same PR flips the
> profile route's transition write (`update.default_payout_model = m === 'percentage' ?
> 'percentage_contractor' : m` → `= m`). Safe by then: every reader deployed since PR1 treats
> both spellings identically.

### Task 8: Submit route (cleaner + org-authored)

**Files:**
- Create: `src/app/api/appointments/[appointmentId]/pay-request/route.ts`
- Create: `src/lib/payments/payRequests/createPayRequest.ts`
- Test: `src/app/api/appointments/[appointmentId]/pay-request/route.integration.test.ts`

**Interfaces:**
- Consumes: `isAutoApproved`, `initialStatus` (Tasks 4-5), `requireOrgAuth`, `recordPaymentEvent`, `recordNotificationEvent`.
- Produces: `POST` body `{ organization_id: string, amount_cents: number, note?: string }`; 200 → `{ payRequest: PayRequest, autoApproved: boolean }`; `createPayRequest(supabaseAdmin, { appointmentId, actorUserId, actorKind: 'cleaner' | 'org', amountCents, note }): Promise<{ payRequest, autoApproved }>` used by this route and (later) the org completion prompt.

- [ ] **Step 1: Write failing integration tests.** Use `withTestOrg({ cleanerPayoutModel: 'request', minMarginBps: 2000, stripeConnectOnboardingComplete: true, stripeConnectAccountId: 'acct_test' })` + `createTestAppointment`. Cases:
  1. cleaner submits within threshold → 200, `status='approved'`, `approved_via='auto'`, one offer row with `min_margin_bps_snapshot=2000`, `auto_approved=true`; `payment_events` has `pay_request_submitted` + `pay_request_auto_approved`.
  2. cleaner submits over threshold → `status='pending_org'`, offer `auto_approved=false`; `pay_request_escalated` payment event; `notification_events` row `pay_request_escalated` for org recipients excluding the cleaner.
  3. over-PRICE request (amount > job price) → 200 and escalates, response body contains NO price-cap error and NO job price when org is `payout_only`.
  4. duplicate submit for the same appointment → 409.
  5. cleaner of a different org / a homeowner token → 403; percentage-mode cleaner → 400 (`pay requests are not enabled for this cleaner`).
  6. org actor (admin token) → thread starts `pending_cleaner` with an org-authored offer.
  7. amount validation: negative or non-integer `amount_cents` → 400.

```ts
// exemplar for case 1 (follow this shape for the rest)
it('auto-approves a within-threshold cleaner request', async () => {
  const org = await withTestOrg({
    cleanerPayoutModel: 'request', minMarginBps: 2000,
    stripeConnectOnboardingComplete: true, stripeConnectAccountId: 'acct_test',
  });
  try {
    const appt = await createTestAppointment({ organizationId: org.organizationId, cleanerId: org.cleaner.id, totalPrice: 350, status: 'in_progress' });
    const res = await callRoute(POST, {
      method: 'POST',
      url: `http://test/api/appointments/${appt.id}/pay-request`,
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId, amount_cents: 25000 },
    });
    expect(res.status).toBe(200);
    const admin = createTestSupabaseClient();
    const { data: pr } = await admin.from('pay_requests').select('*').eq('appointment_id', appt.id).single();
    expect(pr.status).toBe('approved');
    expect(pr.approved_via).toBe('auto');
    expect(pr.approved_amount_cents).toBe(25000);
    expect(pr.job_price_cents_snapshot).toBe(35000);
  } finally { await org.cleanup(); }
});
```

(If `createTestAppointment` lacks a `totalPrice` arg, add one that writes `appointments.total_price` — check its current signature in `tests/helpers/fixtures.ts` first.)

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `createPayRequest.ts`** (service-role lib so the org completion prompt can reuse it):

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { isAutoApproved } from './threshold';
import { initialStatus } from './transitions';
import { recordPaymentEvent } from '@/lib/payments/events';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';

export interface CreatePayRequestArgs {
  appointmentId: string;
  actorUserId: string;
  actorKind: 'cleaner' | 'org';
  amountCents: number;
  note?: string | null;
}
export type CreatePayRequestResult =
  | { ok: true; payRequestId: string; status: string; autoApproved: boolean }
  | { ok: false; code: 'not_found' | 'wrong_mode' | 'duplicate' | 'invalid_amount'; message: string };

export async function createPayRequest(
  supabase: SupabaseClient,
  args: CreatePayRequestArgs,
): Promise<CreatePayRequestResult> {
  if (!Number.isInteger(args.amountCents) || args.amountCents < 0) {
    return { ok: false, code: 'invalid_amount', message: 'Enter a whole dollar-and-cents amount of 0 or more.' };
  }
  const { data: appt } = await supabase
    .from('appointments')
    .select('id, organization_id, cleaner_id, total_price')
    .eq('id', args.appointmentId)
    .maybeSingle();
  if (!appt?.cleaner_id) return { ok: false, code: 'not_found', message: 'Appointment not found.' };

  const { data: cleaner } = await supabase
    .from('cleaner_profiles')
    .select('payout_model')
    .eq('id', appt.cleaner_id)
    .maybeSingle();
  if (cleaner?.payout_model !== 'request') {
    return { ok: false, code: 'wrong_mode', message: 'Pay requests are not enabled for this cleaner.' };
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('min_margin_bps')
    .eq('id', appt.organization_id)
    .single();
  const minMarginBps = org?.min_margin_bps ?? 2000;
  const priceCents = Math.round(Number(appt.total_price) * 100);

  const auto = args.actorKind === 'cleaner' && isAutoApproved(args.amountCents, priceCents, minMarginBps);
  const status = initialStatus(args.actorKind, auto);

  const { data: pr, error: insertErr } = await supabase
    .from('pay_requests')
    .insert({
      organization_id: appt.organization_id,
      appointment_id: appt.id,
      cleaner_id: appt.cleaner_id,
      status,
      job_price_cents_snapshot: priceCents,
      ...(auto ? { approved_amount_cents: args.amountCents, approved_via: 'auto', approved_at: new Date().toISOString() } : {}),
    })
    .select('id')
    .single();
  if (insertErr) {
    if (insertErr.code === '23505') return { ok: false, code: 'duplicate', message: 'A pay request already exists for this job.' };
    throw insertErr;
  }

  await supabase.from('pay_request_offers').insert({
    pay_request_id: pr.id,
    actor: args.actorKind,
    actor_user_id: args.actorUserId,
    amount_cents: args.amountCents,
    note: args.note ?? null,
    min_margin_bps_snapshot: args.actorKind === 'cleaner' ? minMarginBps : null,
    auto_approved: auto,
  });

  await recordPaymentEvent(supabase, {
    appointmentId: appt.id, organizationId: appt.organization_id,
    eventType: 'pay_request_submitted', actor: `user:${args.actorUserId}`,
    amount: args.amountCents, payload: { actor_kind: args.actorKind, auto_approved: auto, status },
  });
  if (auto) {
    await recordPaymentEvent(supabase, {
      appointmentId: appt.id, organizationId: appt.organization_id,
      eventType: 'pay_request_auto_approved', actor: 'system', amount: args.amountCents, payload: { min_margin_bps: minMarginBps },
    });
  } else if (status === 'pending_org') {
    await recordPaymentEvent(supabase, {
      appointmentId: appt.id, organizationId: appt.organization_id,
      eventType: 'pay_request_escalated', actor: 'system', amount: args.amountCents, payload: { min_margin_bps: minMarginBps },
    });
    await recordNotificationEvent(supabase, {
      event_type: 'pay_request_escalated',
      appointment_id: appt.id, organization_id: appt.organization_id,
      dedupe_key: `pay_request_escalated:${pr.id}`,
      exclude_user_ids: [args.actorUserId],
      payload: { amount_cents: args.amountCents },
    });
  } else {
    // org-authored offer awaiting the cleaner
    await recordNotificationEvent(supabase, {
      event_type: 'pay_request_countered',
      appointment_id: appt.id, organization_id: appt.organization_id,
      recipient_user_id: appt.cleaner_id,
      dedupe_key: `pay_request_countered:${pr.id}:0`,
      payload: { amount_cents: args.amountCents },
    });
  }
  return { ok: true, payRequestId: pr.id, status, autoApproved: auto };
}
```

**Route handler** (`route.ts`): parse body; auth via `requireOrgAuth(request, organization_id, supabaseAdmin, { allowedRoles: ['owner','admin','manager','cleaner'] })`; if `auth.role === 'cleaner'`, verify the appointment's `cleaner_id === auth.userId` (404 on mismatch, don't leak) and `actorKind='cleaner'`; otherwise managers need `can_manage_payments` (use `requireOrgPaymentsAuth` for the org path) and `actorKind='org'`. Map `CreatePayRequestResult` codes → 404/400/409. Note in a comment: settlement is NOT triggered here; auto-approved threads settle via the normal completion charge webhook.

- [ ] **Step 4: Run integration tests** → PASS. **Step 5: Commit** — `feat(payments): pay-request submit route (cleaner + org-authored)`

### Task 9: Thread routes — approve / counter / respond

**Files:**
- Create: `src/app/api/pay-requests/[payRequestId]/approve/route.ts`
- Create: `src/app/api/pay-requests/[payRequestId]/counter/route.ts`
- Create: `src/app/api/pay-requests/[payRequestId]/respond/route.ts`
- Create: `src/lib/payments/payRequests/actOnPayRequest.ts` (shared load + state-guard + apply logic)
- Test: one `route.integration.test.ts` co-located per route

**Interfaces:**
- Consumes: `nextStatus`, `autoApproveMaxCents`/`isAutoApproved`, `requireOrgPaymentsAuth`, `requireOrgAuth`, `settleCleanerPayout`, `chargeCompletedAppointmentAuto`.
- Produces:
  - `POST /approve` body `{ organization_id }` — org approves the latest cleaner offer as-is. 200 `{ status: 'approved', settlement: 'settled' | 'deferred' }`.
  - `POST /counter` body `{ organization_id, amount_cents, note? }` — org counters; validation `amount_cents <= job_price_cents_snapshot` → else 400 with org-facing copy `"Counter cannot exceed the job price."`.
  - `POST /respond` body `{ organization_id, accept: true }` OR `{ organization_id, amount_cents, note? }` — cleaner accepts or counters (re-runs threshold).
  - All: 409 when the thread is not in the expected state (stale client), idempotent approve (second approve of an approved thread with the same amount → 200 no-op).

- [ ] **Step 1: Write failing integration tests.** Cases per route:
  - approve: happy path from `pending_org` (status flips, `approved_via='org'`, `approved_by` set); 409 from `pending_cleaner`; second call → 200 no-op; manager without `can_manage_payments` → 403; cross-org id → 404.
  - counter: happy path → `pending_cleaner` + offer row (actor `org`, no threshold snapshot); cap violation → 400; 409 from wrong state.
  - respond accept: `pending_cleaner` → `approved` (`approved_via='cleaner_accept'`, approved amount = the org's countered amount); respond counter under threshold → straight to `approved` with `approved_via='auto'`; respond counter over threshold → `pending_org` + `pay_request_escalated` notification; wrong cleaner → 404; 409 from `pending_org`.
  - settlement trigger: approve on a job whose completion charge already succeeded (seed a `paid` revenue `payments` row via `buildPaymentIntentSucceededEvent`/fixtures) → `payouts` row appears with `pay_request_id` set and `payout_model_snapshot='request'` (Stripe fake transfer). Approve when no charge exists yet → `settlement: 'deferred'`, no payout row.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** `actOnPayRequest.ts` loads the thread, then: **idempotency short-circuit first** — if the thread is already `approved` and the action is `org_approve` or `cleaner_accept`, return `{ ok: true, alreadyApproved: true }` (the route answers 200 with the current state and still runs the settlement trigger, which is itself idempotent). Only then the compare-and-swap UPDATE (guarded by `.eq('status', expectedCurrent)` so concurrent actions lose with 0 rows → 409), appends the offer row, stamps approval fields when terminal:

```ts
// The CAS write that makes every transition race-safe:
const { data: updated } = await supabase
  .from('pay_requests')
  .update({ status: newStatus, updated_at: new Date().toISOString(), ...(approvalFields ?? {}) })
  .eq('id', payRequestId)
  .eq('status', expectedCurrent)     // <- optimistic guard; 0 rows = someone else moved first
  .select('id')
  .maybeSingle();
if (!updated) return { ok: false, code: 'stale_state' };
```

After a transition lands in `approved`, the route triggers settlement inline (sweep remains the backstop), mirroring `payouts/[payoutId]/retry`:

```ts
const { data: appt } = await supabaseAdmin.from('appointments')
  .select('id, is_self_pay').eq('id', pr.appointment_id).single();
let settlement: 'settled' | 'deferred' = 'deferred';
if (appt?.is_self_pay) {
  // Self-pay: the CHARGE itself was waiting on approval (plan Task 11).
  const outcome = await chargeCompletedAppointmentAuto(supabaseAdmin, appt.id, `user:${auth.userId}`);
  settlement = outcome.ok ? 'settled' : 'deferred';
} else {
  const result = await settleCleanerPayout(supabaseAdmin, pr.appointment_id, null);
  settlement = result.settled ? 'settled' : 'deferred';
}
```

Notifications: approve/accept → `pay_request_approved` to `pr.cleaner_id` (dedupe `pay_request_approved:${pr.id}`) when the org approved, `pay_request_accepted` to org roles (exclude cleaner) when the cleaner accepted; counter → `pay_request_countered` to `pr.cleaner_id` (dedupe suffixed with offer count). Payment events: `pay_request_countered` / `pay_request_accepted` / `pay_request_approved` with `actor: 'user:' + auth.userId`.

Route auth: approve/counter → `requireOrgPaymentsAuth`; respond → `requireOrgAuth(..., { allowedRoles: ['cleaner'] })` + `pr.cleaner_id === auth.userId` (404 otherwise). All routes set `export const maxDuration = 60` (settlement latency headroom, same as retry route).

- [ ] **Step 4: Run tests** → PASS. **Step 5: Commit** — `feat(payments): pay-request approve/counter/respond routes with CAS state guards`

### Task 10: Settlement integration — homeowner path

**Files:**
- Modify: `src/lib/payments/settleCleanerPayout.ts`
- Modify: `src/lib/payments/paymentEventAlerts.ts` (add `settlement_blocked_dispute_open` as warning)
- Test: extend `src/app/api/stripe/webhook/route.integration.test.ts` (or the co-located settle tests, wherever the existing settle suite lives — follow the existing settle test file)

**Interfaces:**
- Consumes: `resolveCleanerShareCents`, `computePaymentSplitFromCents`, `pay_requests` rows.
- Produces: `settleCleanerPayout` returns `{ settled: false, reason: 'pay_request_pending' }` for unapproved request-mode jobs; payout rows carry `pay_request_id` + `payout_model_snapshot`; `payout_percent_snapshot` stays null for flat/request.

- [ ] **Step 1: Write failing integration tests:**
  1. request-mode + approved thread + `payment_intent.succeeded` → payout row `amount = approved/100`, `payout_model_snapshot='request'`, `pay_request_id` set, tenant remainder = gross − fee − approved.
  2. request-mode + `pending_org` thread + webhook → no transfers, `payments` row untouched by splits, `payment_events` contains `settlement_deferred_pay_request`, result reason `pay_request_pending`.
  3. flat-mode cleaner (`cleanerPayoutModel:'flat', flatRateCents: 9500`) on an $80 job → payout $80.00, `payout_flat_capped` event recorded.
  4. percentage regression: existing suite still green byte-for-byte (no assertion changes).
  5. dispute guard: seed an open `disputes` row for the payment → settle bails with reason `dispute_open`, `settlement_blocked_dispute_open` event recorded.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** In `settleCleanerPayout.ts`, after the cleaner row is loaded (the block that selects `payout_model, stripe_connect_account_id, stripe_connect_onboarding_complete, payout_percent` — extend the select with `flat_rate_cents`) and BEFORE the split computation:

```ts
// Request-mode gate: transfers fire only on an approved pay request (spec §6).
const payoutModel = cleaner?.payout_model ?? 'percentage';
let approvedRequestCents: number | null = null;
let payRequestId: string | null = null;
if (payoutModel === 'request') {
  const { data: pr } = await supabase
    .from('pay_requests')
    .select('id, status, approved_amount_cents')
    .eq('appointment_id', appointmentId)
    .maybeSingle();
  if (!pr || pr.status !== 'approved') {
    if (capturedCents != null) {
      // webhook path only - the sweep excludes these rows, so this writes once
      await recordPaymentEvent(supabase, {
        appointmentId, organizationId: appt.organization_id,
        eventType: 'settlement_deferred_pay_request', actor: 'webhook',
        payload: { thread_status: pr?.status ?? 'missing' },
      });
    }
    return { settled: false, reason: 'pay_request_pending' };
  }
  approvedRequestCents = pr.approved_amount_cents;
  payRequestId = pr.id;
}

// Dispute interlock: deferred approval opens a window where a dispute can
// arrive before transfers fire - never settle into an open dispute.
const { data: openDispute } = await supabase
  .from('disputes')
  .select('id, status')
  .eq('payment_id', payRow.id)
  .not('status', 'in', '(won,lost,warning_closed,charge_refunded)')
  .maybeSingle();
if (openDispute) {
  await recordPaymentEvent(supabase, {
    appointmentId, organizationId: appt.organization_id,
    eventType: 'settlement_blocked_dispute_open', actor: 'system',
    payload: { dispute_id: openDispute.id, dispute_status: openDispute.status },
  });
  return { settled: false, reason: 'dispute_open' };
}
```

(Verify the `disputes` table's column names + status vocabulary against the master file `src/lib/payments/dispatchStripeEvent.ts` `handleChargeDisputeCreated` before writing the filter — adjust the `.not(...)` list to the exact closed statuses used there.)

Then replace the single `computePaymentSplit` call with the mode-aware pair:

```ts
const share = resolveCleanerShareCents({
  payoutModel,
  payoutPercent,
  flatRateCents: cleaner?.flat_rate_cents ?? null,
  approvedRequestCents,
  grossCents: splitBaseCents,
});
if (share.capped) {
  await recordPaymentEvent(supabase, {
    appointmentId, organizationId: appt.organization_id,
    eventType: share.basis === 'flat' ? 'payout_flat_capped' : 'payout_request_capped',
    actor: 'system', amount: share.cents,
    payload: { basis: share.basis, uncapped_cents: share.basis === 'flat' ? cleaner?.flat_rate_cents : approvedRequestCents, split_base_cents: splitBaseCents },
  });
}
const split = computePaymentSplitFromCents({
  grossCents: splitBaseCents,
  cleanerCents: share.cents,
  platformFeeBps: org.platform_fee_bps ?? 0,
});
```

Every `upsertPayout(...)`/payout-insert call site in this file gains `pay_request_id: payRequestId, payout_model_snapshot: payoutModel === 'percentage_contractor' ? 'percentage' : payoutModel`, and sets `payout_percent_snapshot` to null when `share.basis !== 'percent'` (keep the existing value for percent).

- [ ] **Step 4: Run tests** → PASS (incl. the untouched percentage suite). **Step 5: Commit** — `feat(payments): request/flat-aware settlement with pay-request gate and dispute interlock`

### Task 11: Self-pay — charge gate + cents-based amounts

**Files:**
- Modify: `src/lib/payments/chargeCompletedAppointment.ts` (`chargeSelfPayNow`), `src/lib/payments/chargeSelfPayAchAppointment.ts`, `src/lib/payments/settleSelfPay.ts`, `src/lib/payments/selfPayMath.ts`
- Test: extend the existing self-pay integration suites co-located with those routes/libs + `selfPayMath` unit tests

**Interfaces:**
- Produces: `ChargeNowCode` gains `'pay_request_pending'` (non-stamping precondition bail: `authorization_status` stays NULL so the sweep retries after approval, exactly like `tenant_not_ready`); `SelfPayAchChargeCode` same; `computeSelfPayAmountsFromCents({ jobGrossCents, cleanerCutCents, platformFeeBps?, method? }): SelfPayAmounts` (shares gross-up + fee internals with `computeSelfPayAmounts`).

- [ ] **Step 1: Failing tests:** self-pay request-mode job, unapproved thread → charge bails `pay_request_pending`, `authorization_status` still NULL; after approval, `chargeCompletedAppointmentAuto` charges `approved + platformFee(notional gross) + gross-up`, `settleSelfPay` transfers exactly `approved`; flat-mode self-pay charges `min(flat, gross)` basis; unit tests pin `computeSelfPayAmountsFromCents` equals `computeSelfPayAmounts` for the equivalent percent.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** In `chargeSelfPayNow` (and the ACH twin), after the cleaner select (extend it with `flat_rate_cents`), insert the same request-gate as Task 10 (return `{ ok: false, code: 'pay_request_pending', message: 'Waiting on the pay request approval.' }` — do NOT stamp). Refactor `computeSelfPayAmounts` so both variants share one internal that takes `cleanerCutCents`; resolve the cut via `resolveCleanerShareCents` at all three self-pay call sites (charge card, charge ACH, settle) with `grossCents = jobGrossCents`. `settleSelfPay` payout writes gain `pay_request_id`/`payout_model_snapshot` identically to Task 10.

- [ ] **Step 4: Run tests** → PASS. **Step 5: Commit** — `feat(payments): self-pay defers the charge until the pay request approves`

### Task 12: Reconcile sweep + guards + regression pins

**Files:**
- Modify: `src/lib/payments/reconcile.ts` (`settleUnsettledCaptures`, `chargeUncollectedCompletions`, `retryFailedPayouts`, `checkMoneyMathInvariants`)
- Modify: `src/app/api/admin/delete-cleaner/route.ts`
- Test: reconcile integration suite + delete-cleaner suite + a cancellation-fee regression pin

- [ ] **Step 1: Failing tests:**
  1. `settleUnsettledCaptures` skips a paid-but-unapproved request-mode row (no `settlement_deferred_pay_request` spam from the sweep) and settles it once approved.
  2. `chargeUncollectedCompletions` skips a self-pay request-mode completion with a pending thread; picks it up after approval.
  3. `retryFailedPayouts` retries a failed `payout_model_snapshot='request'` payout (which has NULL percent snapshot).
  4. `checkMoneyMathInvariants` does not flag a request payout as a violation, and DOES flag a request payout whose amount disagrees with `approved_amount_cents`.
  5. delete-cleaner with an open (`!= approved`) thread → 400 `"Cannot delete a cleaner with an open pay request. Resolve it first."`; approved thread → deletion proceeds.
  6. cancellation-fee pin: request-mode cleaner assigned, fee charged → `computePaymentSplit` snapshot has `cleanerCents === 0` (pins decision 7; already true by construction).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** In both sweep scanners, after collecting candidate rows, one batch query filters out pending threads:

```ts
const apptIds = candidates.map((c) => c.appointment_id).filter(Boolean);
const { data: pendingThreads } = apptIds.length
  ? await supabase.from('pay_requests').select('appointment_id').in('appointment_id', apptIds).neq('status', 'approved')
  : { data: [] as { appointment_id: string }[] };
const waitingOnApproval = new Set((pendingThreads ?? []).map((t) => t.appointment_id));
// ...inside the loop:
if (waitingOnApproval.has(row.appointment_id)) continue; // normal business state, not stuck money
```

`retryFailedPayouts`: replace the `.not('payout_percent_snapshot', 'is', null)` filter with `.or('payout_percent_snapshot.not.is.null,payout_model_snapshot.in.(request,flat)')`. `checkMoneyMathInvariants`: when `payout_model_snapshot` is `'request'`/`'flat'`, skip the percent invariant and instead assert `Math.round(amount*100) === min(expectedCents, splitBase)` where expected comes from `approved_amount_cents`/`flat_rate_cents` (report `money_math_violation` with `basis` in the payload on mismatch). delete-cleaner guard (before the active-appointments check):

```ts
const { data: openThreads } = await supabaseAdmin
  .from('pay_requests')
  .select('id')
  .eq('cleaner_id', cleanerId)
  .neq('status', 'approved')
  .limit(1);
if (openThreads && openThreads.length > 0) {
  return NextResponse.json(
    { success: false, error: 'Cannot delete a cleaner with an open pay request. Resolve it first.' },
    { status: 400 },
  );
}
```

- [ ] **Step 4: Run tests** → PASS. **Step 5: Commit** — `feat(payments): sweep-aware pay-request deferral + offboarding guard + invariants`

### Task 13: Notification labels + hrefs

**Files:**
- Modify: `src/lib/notifications/eventTypes.ts` (add `pay_request_escalated | pay_request_countered | pay_request_approved | pay_request_accepted`)
- Modify: `src/lib/notifications/labels.ts`, `src/components/redesign/notifications/deriveNotifications.ts`
- Test: extend the labels/derive unit tests

- [ ] **Step 1: Failing tests:** each new type renders a label (no em dashes): escalated → `"Pay request needs your review"`, countered → `"New offer on your pay request"`, approved → `"Your pay request was approved"`, accepted → `"[Cleaner] accepted your offer"`; hrefs: operator types → payments page, cleaner types → earnings.
- [ ] **Step 2-4: Implement, run, PASS** (follow the exact switch-case shape in `labels.ts` and the `*NotificationHref` functions).
- [ ] **Step 5: Commit** — `feat(payments): pay-request notification labels + routing`

### Task 14: CHECKPOINT — PR2 gates, adversarial review, open PR

- [ ] **Step 1: Full gates** (`npm run test`, tsc, lint; no migration in PR2 so no reset needed).
- [ ] **Step 2: 3-lens adversarial review workflow** (Lane-B style, ~10-16 agents, Sonnet verify layer / Fable synthesis): lens 1 **double-pay/race** (CAS transitions, idempotent approve, approve+webhook concurrency, sweep+route concurrency, transfer idempotency keys untouched); lens 2 **stuck-money** (every defer has a resume: webhook→route-trigger→sweep; self-pay bail leaves `authorization_status` NULL; no path strands an approved thread); lens 3 **authorization/leak** (cleaner routes can't read price via error copy, RLS vs route guards, cross-org 404s, org counter cap only org-facing). Fix all CONFIRMED findings before opening the PR.
- [ ] **Step 3: Push + open PR** `feat(payments): pay-request lifecycle + deferred settlement (2/4)`. **Bridger merges.**

---

> **Amendments after the PR2 adversarial review (9 confirmed findings, all fixed in PR2):**
> 1. **Migration 116**: `pay_requests.current_offer_cents` carries the live offer so every
>    transition is one atomic UPDATE; the CAS guards `(status, updated_at)` (ABA-safe). Terminal
>    actions approve the row's own current offer, never a separately-loaded offer list.
> 2. **The cleaner has NO direct RLS read on pay_requests / pay_request_offers** (the row carries
>    `job_price_cents_snapshot`; a direct PostgREST read leaked the hidden price). **PR4 change:**
>    `useCleanerPayRequests` reads a new service-role GET route
>    (`GET /api/pay-requests/mine`, added in Task 19) that shapes a price-free payload
>    (`presentChargeProjection` pattern); cleaner realtime on pay_requests is gone - refresh on
>    notifications + focus instead.
> 3. `triggerPayRequestSettlement` is capture-gated (status='paid' + captured_at, the sweep's
>    filter) - approving a thread whose charge declined must never move pooled platform funds.
> 4. Settlement/self-pay gates key on thread EXISTENCE and an approved thread stays the basis
>    (mode flips mid-flight can't change the amount).
> 5. Org-authored submit amounts are price-capped; escalations/acceptances also notify
>    `can_manage_payments` managers; delete-cleaner blocks until threads are SETTLED
>    (paid/bank_paid/reversed), not just approved.
> 6. **Accepted + documented:** a lost `charge.dispute.closed` (won) leaves the dispute interlock
>    blocking settlement until the local disputes row updates; the recurring
>    `settlement_blocked_dispute_open` warning alert (6h dedupe) is the surface, manual dispute-row
>    fix is the remedy. Follow-up candidate: live dispute re-derivation in the sweep.

## Phase 3 — PR3 `feat/pay-request-org-ui`

> Gate: run the `ui-feature-workflow` skill FIRST (ask Bridger: browser companion? mobile or desktop?), then `ui-ux-pro-max` at design AND implementation. Final visual shaping happens in that workflow with Bridger; the tasks below fix the data plumbing, structure, and behavior contracts.

### Task 15: Settings — umbrella + threshold + per-cleaner mode

**Files:**
- Modify: `src/components/redesign/settings/sections/PayoutSettingsSection.tsx`
- Modify: `src/app/api/organizations/[orgId]/profile/route.ts` (accept unified values; validation error copy: `"default_payout_model must be percentage, flat, request, or hourly_external"`), plus the `cleaner-payouts` PATCH route gains `min_margin_bps` (integer 0..10000)
- Modify: `src/components/redesign/cleaners/CleanerDetailSheet.tsx`, `src/components/redesign/cleaners/OperatorCleaners.tsx`, `src/hooks/useAdminData.ts` (`UpdateCleanerPayload.cleaner` gains `payout_model`, `flat_rate_cents`), `src/app/api/admin/update-cleaner/route.ts` (validate + write them)
- Test: integration tests on both routes (invalid mode 400, min_margin bounds 400, happy paths); derive/unit tests where logic is pure

Behavior contract: settings shows the flexible-contractor umbrella — default pay mode picker (percentage / flat / request selectable, hourly still "coming soon"), threshold input labeled **"Auto-approve margin"** with helper copy `"Requests that leave you at least this share of the job price are approved automatically."` (percent in UI, bps in DB). CleanerDetailSheet edit mode gains a mode select; the parameter field swaps per mode (percent input / flat dollars input / static text `"This cleaner names their pay on each job."`). `load()` normalizes legacy `'percentage_contractor'` for display.

- [ ] Steps: failing route tests → implement routes → implement UI → `npx tsc --noEmit` + `npm run test` → commit `feat(settings): flexible contractor umbrella + per-cleaner pay mode + auto-approve margin`.

### Task 16: Payments page — Pay requests queue + org completion prompt

**Files:**
- Create: `src/components/redesign/payments/PayRequestsBand.tsx`, `src/components/redesign/payments/PayRequestDetailSheet.tsx`, `src/hooks/usePayRequests.ts`
- Modify: `src/lib/queryKeys.ts` (new group), `src/components/redesign/payments/OperatorPayments.tsx` (new slot next to `triage`), `src/components/redesign/bookings/OperatorBookingDetailHost.tsx` (request-mode completion prompt)
- Test: unit tests for the derive/presenter; the routes are already integration-tested (Task 8/9)

```ts
// queryKeys.ts addition
payRequests: {
  all: ['pay-requests'] as const,
  byOrg: (orgId: string) => ['pay-requests', 'org', orgId] as const,
  byCleaner: (cleanerId: string) => ['pay-requests', 'cleaner', cleanerId] as const,
  pendingCount: (orgId: string) => ['pay-requests', 'pending-count', orgId] as const,
},
```

`usePayRequests` = `useOrgQuery` over `pay_requests` joined to appointments (`total_price` hidden from cleaners is irrelevant here — org side sees margin in $ and %) + `useSupabaseRealtimeSync({ channelName: 'pay_requests:' + orgId, table: 'pay_requests', filter: 'organization_id=eq.' + orgId, onEvent: () => ({ type: 'invalidate', keys: [keys.payRequests.byOrg(orgId), keys.payRequests.pendingCount(orgId)] }) })`. `PayRequestsBand` follows `PaymentsTriageBand` exactly: owns its data, `if (isEmpty) return null`, sections with count `Badge`, rows show job / cleaner / price / requested / resulting margin ($ and %) / age, actions **Approve** and **Counter** (Counter opens `PayRequestDetailSheet` with the offer history + amount + note inputs; approve/counter/respond mutations POST the Task-9 routes and invalidate `keys.payRequests`). `OperatorBookingDetailHost.runStatus('completed')` on a request-mode cleaner job first opens an amount dialog → `POST /api/appointments/[id]/pay-request` (org-authored) → then the status write. Pending-count badge on the operator nav item modeled on `useUnreadMessageCount` (count query + realtime invalidate).

- [ ] Steps: derive tests → implement → verify live vs local Supabase (seed a request-mode org via SQL, walk approve + counter flows in the browser) → gates → commit `feat(payments): pay-requests queue + org completion prompt`.

### Task 17: CHECKPOINT — PR3 gates + review

- [ ] `ui-ux-pro-max` conformance pass (design-system, no raw hex, no em dashes) + full gates + open PR `feat(payments): org pay-request UI (3/4)`; Bridger reviews the flows in his browser before merge.

---

## Phase 4 — PR4 `feat/pay-request-cleaner-ui`

> Same `ui-feature-workflow` + `ui-ux-pro-max` gates as PR3.

### Task 18: Completion flow — request step

**Files:**
- Modify: `src/app/api/appointments/[appointmentId]/charge-projection/route.ts` + `src/lib/payments/presentChargeProjection.ts` (expose `payoutModel: PayoutModel`; for request mode omit `cleanerCutCents`)
- Modify: `src/components/redesign/cleaner/job/CleanerCompleteSheet.tsx`, `src/hooks/useCleanerData.ts` (`useCompleteJob`), `src/components/redesign/cleaner/job/active-job-presenters.ts` (`completeSuccessCopy`)
- Test: presenter unit tests + charge-projection integration test (request-mode cleaner gets `payoutModel:'request'`, no price when `payout_only`)

Behavior contract: for request-mode cleaners the sheet renders a required **"Request your pay"** amount input (anchored by the cleaner's own history — see Task 19's `keys.payRequests.byCleaner` query for "last time here you were paid $X") between the breakdown and the footer; **submit order: `POST pay-request` FIRST, then `updateAppointmentStatus(appointmentId, 'completed')`** — if the request POST fails the completion is blocked with a retry toast (invariant: no completed request-mode job without a thread; a thread on a not-yet-completed job is harmless if the status write fails and is retried). `completeSuccessCopy` gains two branches: auto-approved → `"You earned $X"`, escalated → `"Sent for approval. You'll get a notification when it's reviewed."`. A `409 duplicate` from the POST (retry after a mid-flight failure) is treated as success.

- [ ] Steps: failing presenter/integration tests → implement → live-verify both outcomes locally → commit `feat(cleaner): request-your-pay completion step`.

### Task 19: Earnings — thread states + accept/counter

**Files:**
- Modify: `src/components/redesign/cleaner/earnings/earnings-types.ts`, `deriveEarnings.ts` (+ its test), `CleanerEarningsView.tsx`, `CleanerEarnings.tsx`
- Create: `src/components/redesign/cleaner/earnings/PayRequestThreadSheet.tsx`, `src/hooks/useCleanerPayRequests.ts` (query `pay_requests` + `pay_request_offers` where `cleaner_id = userId`, statuses != approved, realtime invalidate on `pay_requests` filtered `cleaner_id=eq.${userId}`)
- Test: `deriveEarnings` unit tests for the two new row kinds

Behavior contract: two new sections following the T2-15 `PayoutBucketSection` pattern — **"Awaiting approval"** (static rows, amount + age) and **"Waiting on you"** (countered threads; tapping opens `PayRequestThreadSheet`: offer history with notes, Accept button, counter amount + note inputs → `POST /respond`). Row copy mirrors `heldReason()` tone. Price never appears (the query selects no price fields; `job_price_cents_snapshot` is NOT selected client-side for cleaners).

- [ ] Steps: failing derive tests → implement → live-verify accept + counter loops → commit `feat(cleaner): pay-request earnings states + thread sheet`.

### Task 20: E2E + final checkpoint

**Files:**
- Create: `tests/e2e/pay-requests.spec.ts`

- [ ] **Step 1: E2E specs** (follow existing `tests/e2e/` conventions for auth/fixtures): (a) auto-approve happy path — request-mode cleaner completes a job, enters an amount under the threshold, sees `"You earned $X"`, org payments page shows the settled payout; (b) escalation loop — over-threshold amount → org queue shows the request with margin, org counters, cleaner sees "Waiting on you", accepts, payout settles.
- [ ] **Step 2: Full gates + `ui-ux-pro-max` pass.**
- [ ] **Step 3: Open PR** `feat(payments): cleaner pay-request UI + e2e (4/4)`; after merge, flip the pilot: set Nexxus cleaners to `request` + confirm their `min_margin_bps` in settings with Bridger.

---

## Post-ship follow-ups (tracked, not in these PRs)

- Marketing `PayModelsSection` copy update (post-job requests, not pre-job rate naming).
- `settleSelfPay` lacks the T1-4 PI-authoritative defer guard (pre-existing inconsistency, noted during recon).
- Payout-analytics surfaces; comped-job cleaner pay; ad-hoc payouts (spec §17).
