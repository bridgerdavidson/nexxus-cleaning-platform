# Cleaner App Slice 3 — Active-Job Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cleaner job-detail takeover's `in_progress` "Continue job" legacy escape with an in-redesign active-job flow (Before/Checklist/After section cards + persistent Complete bar), a required-by-default photo gate with a skip-with-reason escape, persisted checklist completion, and a Complete sheet that shows the authoritative charge + cleaner cut.

**Architecture:** The `CleanerJobDetailOverlay` (mounted once in the cleaner layout via `CleanerJobDetailHost`, addressed by `?job=<id>`) gains a `mode === 'continue'` body that renders a new `CleanerActiveJob` container. The container owns a local sub-screen stack and the photo upload managers; sub-screens are local (not URL-addressed). All money/charge backend already exists and is reused unchanged. New surface: migration 095, one pure projection fn + read route + hook, thin mutation hooks, persisted checklist completions, and the redesign UI.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, TanStack Query v5, Supabase (Postgres + Storage + RLS), Stripe (charge-at-completion already wired), Vitest, Playwright.

## Global Constraints

- Flag-gating: whole flow lives in the `(redesign)` route group (404 in prod unless `NEXT_PUBLIC_REDESIGN_ENABLED` or preview/dev). The charge call is additionally gated by `STRIPE_NEW_CHARGE_FLOW_ENABLED` (server + client), already in place — reuse, do not re-gate.
- No em dashes (`—`) in any user-facing copy. Use periods, commas, parentheses, or "to".
- Money shown in dollars, never raw cents. Cents only in the data/compute layer.
- Touch targets ≥ 44px; phone-first at 375px; safe-area aware.
- Design-system only: primitives in `src/components/ui/*` + tokens in `tailwind.config.js` / `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, pillowy shadows). No raw hex, no bespoke one-off classes. Status/urgency via the badge/pill vocabulary, never decorative stripes.
- Convention per `<area>/`: `Container.tsx` (data) + `<Name>View.tsx` (pure) + `derive<Name>.ts` + `derive<Name>.test.ts` + presenters (`*.ts/.tsx` + tests) + `<name>-types.ts`. Pure logic TDD'd red-first. Reuse Slice 1/2 shared atoms in `src/components/redesign/cleaner/shared/`.
- Branch: `feat/redesign-cleaner-app-slice3` off `origin/master` (worktree already set up). Next free migration number is **095**.
- Cleaner cut is `floor(gross * payoutPercent / 100)` (% of gross, decision #11). Do not invent new money math; compose the existing pure helpers.
- Spec: `docs/superpowers/specs/2026-06-27-cleaner-app-slice-3-active-job.md`. Parent design §5.3: `docs/superpowers/specs/2026-06-26-redesign-cleaner-app-design.md`.

## File Structure (decomposition)

**New (logic/data):**
- `supabase/migrations/095_active_job_photos_and_checklist.sql` — schema.
- `src/lib/payments/projectCompletionCharge.ts` (+ `.test.ts`) — pure projection.
- `src/app/api/appointments/[appointmentId]/charge-projection/route.ts` (+ `.integration.test.ts`) — read route.
- `src/app/api/appointments/[appointmentId]/photo-skip/route.ts` (+ `.integration.test.ts`) — skip-write route.

**New (redesign UI, under `src/components/redesign/cleaner/job/`):**
- `deriveActiveJob.ts` (+ `.test.ts`) — gate + completion-eligibility.
- `active-job-presenters.ts` (+ `.test.ts`) — status/label strings.
- `active-job-types.ts` — shared types.
- `CleanerPhotoCapture.tsx` — before/after capture sub-screen.
- `CleanerChecklistView.tsx` — checklist sub-screen.
- `CleanerCompleteSheet.tsx` — complete confirmation sheet.
- `CleanerActiveJob.tsx` — container.
- `CleanerActiveJobView.tsx` — pure overview.

**Modified:**
- `src/types/index.ts` — `Organization`, `Appointment`, new `ChecklistItemCompletion`, `ChargeProjection`.
- `src/hooks/useCleanerData.ts` — thin hooks + charge-outcome return.
- `src/components/redesign/cleaner/job/CleanerJobDetailOverlay.tsx` — render `CleanerActiveJob` for `mode==='continue'`.
- `src/components/redesign/cleaner/job/CleanerJobDetailHost.tsx` — drop the legacy bridge.
- `src/components/redesign/cleaner/today/*` — Today active-job "Continue" opens the redesign overview (drop legacy `?appointment=` bridge for in_progress).
- `src/lib/queryKeys.ts` — keys for projection + checklist completions (if not already coverable by existing factories).
- `tests/e2e/` — one spec.

---

### Task 1: Migration 095 + domain types

**Files:**
- Create: `supabase/migrations/095_active_job_photos_and_checklist.sql`
- Modify: `src/types/index.ts` (Organization, Appointment, add ChecklistItemCompletion + ChargeProjection)

**Interfaces:**
- Produces: `organizations.require_job_photos boolean`, `appointments.photos_skipped boolean`, `appointments.photo_skip_reason text`, table `checklist_item_completions(id, appointment_id, checklist_line_item_id, organization_id, completed_at, created_at)` with RLS. TS: `Organization.require_job_photos: boolean`; `Appointment.photos_skipped: boolean`, `Appointment.photo_skip_reason: string | null`; `interface ChecklistItemCompletion`; `interface ChargeProjection` (consumed by Tasks 3, 4, 6, 9).

- [ ] **Step 1: Write the migration** (`095_active_job_photos_and_checklist.sql`). Use the exact SQL from the spec's "Data model — migration 095" section, including all four RLS policies. RLS policies (write them in full):

```sql
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS require_job_photos boolean NOT NULL DEFAULT true;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS photos_skipped boolean NOT NULL DEFAULT false;
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS photo_skip_reason text;

CREATE TABLE IF NOT EXISTS checklist_item_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  checklist_line_item_id uuid NOT NULL REFERENCES checklist_line_items(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, checklist_line_item_id)
);
CREATE INDEX IF NOT EXISTS idx_cic_appointment ON checklist_item_completions(appointment_id);

ALTER TABLE checklist_item_completions ENABLE ROW LEVEL SECURITY;

-- Assigned cleaner: full control of their own appointment's rows.
DROP POLICY IF EXISTS cic_cleaner_rw ON checklist_item_completions;
CREATE POLICY cic_cleaner_rw ON checklist_item_completions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM appointments a
                 WHERE a.id = checklist_item_completions.appointment_id
                   AND a.cleaner_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM appointments a
                 WHERE a.id = checklist_item_completions.appointment_id
                   AND a.cleaner_id = (select auth.uid())));

-- Org staff (owner/admin/manager): read for their org.
DROP POLICY IF EXISTS cic_org_read ON checklist_item_completions;
CREATE POLICY cic_org_read ON checklist_item_completions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM organization_members m
                 WHERE m.organization_id = checklist_item_completions.organization_id
                   AND m.user_id = (select auth.uid())
                   AND m.role IN ('owner','admin','manager')));
```

  Before writing, open `supabase/migrations/048_invites_realtime.sql` and one recent RLS migration (e.g. `074*`/`075*`) to confirm the exact `organization_members` column names (`user_id` vs `member_id`) and the `(select auth.uid())` wrapping convention. Use whatever those files use.

- [ ] **Step 2: Apply and verify the schema rebuilds cleanly**

Run: `npx supabase db reset`
Expected: completes without error; `checklist_item_completions` and the new columns exist. (If Docker/local Supabase is unavailable, instead validate by applying the SQL via the Supabase MCP `apply_migration` against the dev branch is NOT permitted from a feature branch — just confirm SQL parses by eye and rely on CI's `Migrate / migrate-dev`. Note this in the task report.)

- [ ] **Step 3: Update `src/types/index.ts`.** Add to `Organization`: `require_job_photos: boolean;`. Add to `Appointment`: `photos_skipped: boolean;` and `photo_skip_reason: string | null;`. Add:

```ts
export interface ChecklistItemCompletion {
  id: string;
  appointment_id: string;
  checklist_line_item_id: string;
  organization_id: string | null;
  completed_at: string;
  created_at: string;
}

export interface ChargeProjection {
  baseCents: number;
  method: 'card' | 'us_bank_account';
  chargeCents: number;
  feeCents: number;
  cleanerCutCents: number;
  isSelfPay: boolean;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from this change.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/095_active_job_photos_and_checklist.sql src/types/index.ts
git commit -m "feat(slice3): migration 095 (require_job_photos, photo skip, checklist completions) + types"
```

---

### Task 2: `deriveActiveJob` (pure gate logic, TDD)

**Files:**
- Create: `src/components/redesign/cleaner/job/active-job-types.ts`
- Create: `src/components/redesign/cleaner/job/deriveActiveJob.ts`
- Test: `src/components/redesign/cleaner/job/deriveActiveJob.test.ts`

**Interfaces:**
- Produces: `deriveActiveJob(input: ActiveJobGateInput): ActiveJobGate` (consumed by Task 10). Types `ActiveJobGateInput` / `ActiveJobGate` exactly as in the spec's "Photo gate + skip logic" section.

- [ ] **Step 1: Write the failing test** (`deriveActiveJob.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { deriveActiveJob } from './deriveActiveJob';

const base = { requireJobPhotos: true, photosSkipped: false, beforeSatisfied: false, afterSatisfied: false };

describe('deriveActiveJob', () => {
  it('blocks completion when photos required and none present', () => {
    const g = deriveActiveJob(base);
    expect(g.canComplete).toBe(false);
    expect(g.beforeNeeded).toBe(true);
    expect(g.afterNeeded).toBe(true);
    expect(g.remaining).toEqual(['Add a before photo', 'Add an after photo']);
  });
  it('allows completion when both photos satisfied (queued counts)', () => {
    const g = deriveActiveJob({ ...base, beforeSatisfied: true, afterSatisfied: true });
    expect(g.canComplete).toBe(true);
    expect(g.remaining).toEqual([]);
  });
  it('skip-with-reason unlocks completion regardless of photos', () => {
    const g = deriveActiveJob({ ...base, photosSkipped: true });
    expect(g.canComplete).toBe(true);
    expect(g.photoGateMet).toBe(true);
    expect(g.remaining).toEqual([]);
  });
  it('require_job_photos=false bypasses the gate', () => {
    const g = deriveActiveJob({ ...base, requireJobPhotos: false });
    expect(g.canComplete).toBe(true);
    expect(g.beforeNeeded).toBe(false);
  });
  it('reports only the missing photo when one is satisfied', () => {
    const g = deriveActiveJob({ ...base, beforeSatisfied: true });
    expect(g.canComplete).toBe(false);
    expect(g.remaining).toEqual(['Add an after photo']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- deriveActiveJob`
Expected: FAIL ("deriveActiveJob is not a function" / module not found).

- [ ] **Step 3: Write `active-job-types.ts`** with `ActiveJobGateInput` and `ActiveJobGate` (copy the interfaces verbatim from the spec). Also add the sub-screen stack type used later: `export type ActiveJobScreen = 'overview' | 'before' | 'checklist' | 'after' | 'complete';`

- [ ] **Step 4: Write `deriveActiveJob.ts`**:

```ts
import type { ActiveJobGateInput, ActiveJobGate } from './active-job-types';

export function deriveActiveJob(input: ActiveJobGateInput): ActiveJobGate {
  const { requireJobPhotos, photosSkipped, beforeSatisfied, afterSatisfied } = input;
  const beforeNeeded = requireJobPhotos && !photosSkipped && !beforeSatisfied;
  const afterNeeded = requireJobPhotos && !photosSkipped && !afterSatisfied;
  const photoGateMet = !requireJobPhotos || photosSkipped || (beforeSatisfied && afterSatisfied);
  const remaining: string[] = [];
  if (beforeNeeded) remaining.push('Add a before photo');
  if (afterNeeded) remaining.push('Add an after photo');
  return { photoGateMet, beforeNeeded, afterNeeded, canComplete: photoGateMet, remaining };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit -- deriveActiveJob`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/redesign/cleaner/job/active-job-types.ts src/components/redesign/cleaner/job/deriveActiveJob.ts src/components/redesign/cleaner/job/deriveActiveJob.test.ts
git commit -m "feat(slice3): deriveActiveJob photo-gate logic (TDD)"
```

---

### Task 3: `projectCompletionCharge` (pure money projection, TDD)

**Files:**
- Create: `src/lib/payments/projectCompletionCharge.ts`
- Test: `src/lib/payments/projectCompletionCharge.test.ts`

**Interfaces:**
- Consumes: `computePaymentSplit` (`src/lib/stripe/charges/splits.ts`), `computeChargeBreakdown` (`src/lib/payments/processingFee.ts`), `computeSelfPayAmounts` (`src/lib/payments/selfPayMath.ts`), `ChargeProjection` (Task 1).
- Produces: `projectCompletionCharge(input): ChargeProjection` (consumed by Tasks 4, 9).

- [ ] **Step 1: Read the three helper modules** (`splits.ts`, `processingFee.ts`, `selfPayMath.ts`) to confirm exact exported names, param shapes, and return fields before writing. Confirm `computeChargeBreakdown(method, baseCents)` returns `{ chargeCents, feeCents }` and `computePaymentSplit({ grossCents, payoutPercent, platformFeeBps })` returns `{ cleanerCents }`, and `computeSelfPayAmounts({ jobGrossCents, payoutPercent, method })` returns `{ cleanerCutCents, chargeCents, estimatedFeeCents }`.

- [ ] **Step 2: Write the failing test** (`projectCompletionCharge.test.ts`). Use round numbers and assert the composed result. Compute expected values from the real helpers in the test (import them) so the test pins composition, not magic constants:

```ts
import { describe, it, expect } from 'vitest';
import { projectCompletionCharge } from './projectCompletionCharge';
import { computeChargeBreakdown } from './processingFee';
import { computePaymentSplit } from '../stripe/charges/splits';
import { computeSelfPayAmounts } from './selfPayMath';

describe('projectCompletionCharge', () => {
  it('homeowner-paid card: charge grossed up, cleaner cut = % of gross (base)', () => {
    const base = 12000, pct = 40, bps = 0;
    const bd = computeChargeBreakdown('card', base);
    const split = computePaymentSplit({ grossCents: base, payoutPercent: pct, platformFeeBps: bps });
    const p = projectCompletionCharge({ baseCents: base, method: 'card', isSelfPay: false, payoutPercent: pct, platformFeeBps: bps });
    expect(p.chargeCents).toBe(bd.chargeCents);
    expect(p.feeCents).toBe(bd.feeCents);
    expect(p.cleanerCutCents).toBe(split.cleanerCents);
    expect(p.isSelfPay).toBe(false);
    expect(p.baseCents).toBe(base);
  });
  it('homeowner-paid ACH uses the bank fee breakdown', () => {
    const base = 12000, pct = 40, bps = 0;
    const bd = computeChargeBreakdown('us_bank_account', base);
    const p = projectCompletionCharge({ baseCents: base, method: 'us_bank_account', isSelfPay: false, payoutPercent: pct, platformFeeBps: bps });
    expect(p.chargeCents).toBe(bd.chargeCents);
    expect(p.method).toBe('us_bank_account');
  });
  it('self-pay delegates to computeSelfPayAmounts', () => {
    const base = 12000, pct = 40;
    const sp = computeSelfPayAmounts({ jobGrossCents: base, payoutPercent: pct, method: 'card' });
    const p = projectCompletionCharge({ baseCents: base, method: 'card', isSelfPay: true, payoutPercent: pct, platformFeeBps: 0 });
    expect(p.cleanerCutCents).toBe(sp.cleanerCutCents);
    expect(p.chargeCents).toBe(sp.chargeCents);
    expect(p.feeCents).toBe(sp.estimatedFeeCents);
    expect(p.isSelfPay).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit -- projectCompletionCharge`
Expected: FAIL (module not found).

- [ ] **Step 4: Write `projectCompletionCharge.ts`** (adjust import paths/param names to match what Step 1 confirmed):

```ts
import type { ChargeProjection } from '@/types';
import { computeChargeBreakdown } from './processingFee';
import { computePaymentSplit } from '@/lib/stripe/charges/splits';
import { computeSelfPayAmounts } from './selfPayMath';

export interface ProjectCompletionChargeInput {
  baseCents: number;
  method: 'card' | 'us_bank_account';
  isSelfPay: boolean;
  payoutPercent: number;   // 0..100, cleaner % of gross
  platformFeeBps: number;  // 0..10000
}

export function projectCompletionCharge(input: ProjectCompletionChargeInput): ChargeProjection {
  const { baseCents, method, isSelfPay, payoutPercent, platformFeeBps } = input;
  if (isSelfPay) {
    const sp = computeSelfPayAmounts({ jobGrossCents: baseCents, payoutPercent, method });
    return {
      baseCents,
      method,
      chargeCents: sp.chargeCents,
      feeCents: sp.estimatedFeeCents,
      cleanerCutCents: sp.cleanerCutCents,
      isSelfPay: true,
    };
  }
  const bd = computeChargeBreakdown(method, baseCents);
  const split = computePaymentSplit({ grossCents: baseCents, payoutPercent, platformFeeBps });
  return {
    baseCents,
    method,
    chargeCents: bd.chargeCents,
    feeCents: bd.feeCents,
    cleanerCutCents: split.cleanerCents,
    isSelfPay: false,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit -- projectCompletionCharge`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/payments/projectCompletionCharge.ts src/lib/payments/projectCompletionCharge.test.ts
git commit -m "feat(slice3): projectCompletionCharge pure projection (TDD)"
```

---

### Task 4: `charge-projection` read route (+ integration test)

**Files:**
- Create: `src/app/api/appointments/[appointmentId]/charge-projection/route.ts`
- Test: `src/app/api/appointments/[appointmentId]/charge-projection/route.integration.test.ts`

**Interfaces:**
- Consumes: `projectCompletionCharge` (Task 3), the auth guard used by the existing charge route, `tests/helpers/*`.
- Produces: `GET /api/appointments/[appointmentId]/charge-projection` → `200 { projection: ChargeProjection }`; `404` when the new charge flow is off; `401/403` on auth failure.

- [ ] **Step 1: Read the reference route** `src/app/api/appointments/[appointmentId]/charge/route.ts` end-to-end. Copy its `runtime`, flag-gating (`stripeEnabled()` + `stripeNewChargeFlowEnabled()` → 404), auth pattern (assigned cleaner or org staff), and how it reads the appointment + cleaner profile + org. Also read its co-located `*.integration.test.ts` and `tests/helpers/{auth,db,fixtures,supabase}.ts` for the `withTestOrg`/`callRoute` patterns.

- [ ] **Step 2: Write the failing integration test** mirroring the charge route's test. Cover: (a) assigned cleaner gets a projection with `cleanerCutCents`/`chargeCents` matching `projectCompletionCharge` for the seeded appointment (card); (b) a non-member is rejected; (c) when `STRIPE_NEW_CHARGE_FLOW_ENABLED` is off the route 404s. Seed `total_price`, `is_self_pay=false`, a cleaner with a known `payout_percent`, and org `platform_fee_bps` via the helpers. Assert the returned `projection` equals `projectCompletionCharge({...})` computed in the test.

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm run test:integration -- charge-projection`
Expected: FAIL (route not found / 404 import error). (Requires `npx supabase start` + `.env.test.local`.)

- [ ] **Step 4: Implement the route.** Structure (fill from the reference route's exact helpers):

```ts
export const runtime = 'nodejs';
// GET handler:
// 1. Same flag gate as charge route -> 404 if off.
// 2. Auth: resolve caller; load appointment by appointmentId (service role).
// 3. Authorize: caller is appointment.cleaner_id OR org staff of appointment.organization_id (reuse charge route's guard).
// 4. Read inputs: base = appointment.total_price (to cents), isSelfPay = appointment.is_self_pay,
//    method = inferred payment method (default 'card' if none on file),
//    payoutPercent = cleaner_profiles.payout_percent ?? organizations.default_cleaner_payout_percent ?? 0,
//    platformFeeBps = organizations.platform_fee_bps ?? 0.
// 5. const projection = projectCompletionCharge({ baseCents, method, isSelfPay, payoutPercent, platformFeeBps });
// 6. return NextResponse.json({ projection });
```

  Convert dollars↔cents the same way the charge route / payment helpers do (look for an existing `toCents`/`Math.round(x*100)` convention; reuse it). Default `method` to `'card'` unless the appointment clearly has a saved bank account (reuse whatever the charge route inspects).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:integration -- charge-projection`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/appointments/[appointmentId]/charge-projection/"
git commit -m "feat(slice3): charge-projection read route (+ integration test)"
```

---

### Task 5: `photo-skip` write route (+ integration test)

**Files:**
- Create: `src/app/api/appointments/[appointmentId]/photo-skip/route.ts`
- Test: `src/app/api/appointments/[appointmentId]/photo-skip/route.integration.test.ts`

**Interfaces:**
- Consumes: the same auth guard as the charge route; `tests/helpers/*`.
- Produces: `POST /api/appointments/[appointmentId]/photo-skip` body `{ reason: string }` → writes `appointments.photos_skipped = true`, `photo_skip_reason = reason`; `200 { ok: true }`. `400` on empty reason; `401/403` unauthorized.

- [ ] **Step 1: Write the failing integration test.** Cover: (a) assigned cleaner posts a reason → appointment row now has `photos_skipped=true` and `photo_skip_reason='no signal'`; (b) empty/missing reason → 400; (c) non-member → 403. Use the helpers to seed an org + appointment + assigned cleaner and to read the row back.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:integration -- photo-skip`
Expected: FAIL (route not found).

- [ ] **Step 3: Implement the route** (`runtime='nodejs'`): parse `{ reason }` (trim; 400 if empty); auth + authorize (assigned cleaner OR org staff of the appointment's org, same guard as charge route); update `appointments` via service role: `{ photos_skipped: true, photo_skip_reason: reason }` where `id = appointmentId`; return `{ ok: true }`. No notification (decision D2).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- photo-skip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/appointments/[appointmentId]/photo-skip/"
git commit -m "feat(slice3): photo-skip write route (+ integration test)"
```

---

### Task 6: Thin data hooks in `useCleanerData.ts`

**Files:**
- Modify: `src/hooks/useCleanerData.ts`
- Modify (if needed): `src/lib/queryKeys.ts`

**Interfaces:**
- Consumes: existing `updateAppointmentStatus`, `updateJobProgress`, `useChecklist`, `useJobPhotosForAppointment`, `getAccessToken`, `keys.appointments.*`, `ChecklistItemCompletion`/`ChargeProjection` (Task 1), the routes from Tasks 4-5.
- Produces (consumed by Tasks 8, 9, 10):
  - `useCompleteJob()` → mutation `(appointmentId) => Promise<{ chargeOutcome?: string }>` (wraps `updateAppointmentStatus(id,'completed')`; toast + invalidate `keys.appointments.byCleaner` + stats).
  - `useUpdateJobProgress()` → mutation `({ appointmentId, progress }) => Promise<void>`.
  - `useChecklistCompletions(appointmentId)` → `{ completed: Set<string>; isLoading; error }`.
  - `useToggleChecklistItem()` → mutation `({ appointmentId, lineItemId, done }) => Promise<void>` (optimistic).
  - `useChargeProjection(appointmentId, enabled)` → `{ projection: ChargeProjection | null; isLoading; error }`.
  - `useSkipPhotos()` → mutation `({ appointmentId, reason }) => Promise<void>` (POSTs the photo-skip route; invalidates the appointment).

- [ ] **Step 1: Surface the charge outcome.** Find `updateAppointmentStatus` (~`useCleanerData.ts:701-795`). It already calls `chargeCompletedAppointmentClient(...)` when completing. Capture that call's result (the outcome code) and return it from `updateAppointmentStatus` (e.g. `return { chargeOutcome }`), without altering the completion side effects or its non-fatal behavior (a charge error must still resolve the completion). If the function is `void` today, widen its return type and update existing callers to ignore the value.

- [ ] **Step 2: Add `useCompleteJob`** mirroring `useStartJob` (~`:969`): `useMutation` calling `updateAppointmentStatus(appointmentId, 'completed')`, returning the `{ chargeOutcome }`; `onSuccess` → success toast + `invalidateQueries(keys.appointments.byCleaner(...))` + stats key; `onError` → error toast. Keep the existing `useStartJob` shape.

- [ ] **Step 3: Add `useUpdateJobProgress`** wrapping `updateJobProgress(appointmentId, progress)` (~`:805-823`); no toast (silent step transitions); invalidate the appointment detail key.

- [ ] **Step 4: Add `useChecklistCompletions`** — `useOrgQuery`-style read of `checklist_item_completions` filtered by `appointment_id` (RLS client), mapping rows to `new Set(rows.map(r => r.checklist_line_item_id))`. Query key: extend `keys.appointments` with a `checklistCompletions(appointmentId)` entry in `queryKeys.ts` if no suitable key exists.

- [ ] **Step 5: Add `useToggleChecklistItem`** — mutation: when `done` true, `upsert` `{ appointment_id, checklist_line_item_id: lineItemId, organization_id }` (read `organization_id` from the appointment/auth context) on conflict `(appointment_id, checklist_line_item_id)`; when false, `delete` matching row. Optimistic update of the `completed` Set; invalidate on settle. Use the RLS (anon) Supabase client so the cleaner's policy authorizes the write.

- [ ] **Step 6: Add `useChargeProjection`** — `useQuery` (enabled flag) GET `/api/appointments/${appointmentId}/charge-projection` with the access token; return `projection`. Lazy: only fetch when `enabled` (sheet open).

- [ ] **Step 7: Add `useSkipPhotos`** — mutation POST `/api/appointments/${appointmentId}/photo-skip` `{ reason }`; `onSuccess` invalidate the appointment detail + byCleaner keys (so `photos_skipped` reflects).

- [ ] **Step 8: Type-check + run unit suite**

Run: `npx tsc --noEmit` then `npm run test:unit`
Expected: no new type errors; existing unit tests still pass (these hooks have no unit tests — they are integration-wired; their routes are integration-tested in Tasks 4-5).

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useCleanerData.ts src/lib/queryKeys.ts
git commit -m "feat(slice3): cleaner active-job data hooks (complete/progress/checklist/projection/skip)"
```

---

### Task 7: `CleanerPhotoCapture` sub-screen (+ presenter test)

**Files:**
- Create: `src/components/redesign/cleaner/job/CleanerPhotoCapture.tsx`
- Modify: `src/components/redesign/cleaner/job/active-job-presenters.ts` (+ `.test.ts`) — add `photoStatusLabel`.

**Interfaces:**
- Consumes: `useImageUpload` (`src/hooks/useImageUpload.ts`), `useJobPhotosForAppointment` (`useCleanerData.ts`), the `job_photos` upload lib (`src/lib/image-upload/uploadOne.ts` / `src/lib/upload.ts`), design-system primitives. Reference the existing `src/components/JobPhotoSection.tsx` for the upload wiring (reuse the hook, not the legacy styling).
- Produces: `<CleanerPhotoCapture phase="before"|"after" appointmentId uploader={UseImageUploadReturn} confirmedPhotos={JobPhoto[]} onBack onPhotosChange />`. `photoStatusLabel(confirmedCount, inFlightCount): string` (consumed by Task 10's view too).

- [ ] **Step 1: Read `useImageUpload.ts` + `JobPhotoSection.tsx`** to learn the exact `UseImageUploadReturn` shape (`items`, the add/retry/remove actions, how a finished upload writes a `job_photos` row with `photo_type`). The uploader instance is OWNED by the Task-10 container and passed in as a prop so in-flight uploads survive this sub-screen unmounting.

- [ ] **Step 2: Write the failing presenter test** (`active-job-presenters.test.ts`, add to it):

```ts
import { photoStatusLabel } from './active-job-presenters';
describe('photoStatusLabel', () => {
  it('no photos', () => expect(photoStatusLabel(0, 0)).toBe('No photos yet'));
  it('one confirmed', () => expect(photoStatusLabel(1, 0)).toBe('1 photo added'));
  it('multiple confirmed', () => expect(photoStatusLabel(3, 0)).toBe('3 photos added'));
  it('uploading', () => expect(photoStatusLabel(1, 2)).toBe('1 photo added, 2 uploading'));
});
```

- [ ] **Step 3: Run it (FAIL)** — `npm run test:unit -- active-job-presenters`. Then implement `photoStatusLabel`:

```ts
export function photoStatusLabel(confirmed: number, inFlight: number): string {
  const base = confirmed === 0 ? 'No photos yet'
    : `${confirmed} ${confirmed === 1 ? 'photo' : 'photos'} added`;
  return inFlight > 0 ? `${confirmed === 0 ? '0 photos added' : base}, ${inFlight} uploading` : base;
}
```

  Re-run → PASS. (Adjust the `0,inflight>0` branch so the "No photos yet" case with uploads reads naturally; the test pins the 4 cases above.)

- [ ] **Step 4: Build `CleanerPhotoCapture.tsx`** as a full-screen sub-screen body (rendered inside the takeover by Task 10, so no separate overlay chrome): a header with back chevron + title ("Before photos"/"After photos"), a large camera-first capture tile (44px+; `<input type="file" accept="image/*" capture="environment">` for camera, plus a library option), live per-file progress rows from `uploader.items` (queued/converting/compressing/uploading/done/failed with retry on failed), and a grid of `confirmedPhotos` with tap-x remove (confirm before delete). Use `ui/*` primitives + tokens; no raw hex. Call `onPhotosChange()` after an upload finishes so the container refetches `useJobPhotosForAppointment`. Reduced-motion safe.

- [ ] **Step 5: Type-check + lint the new file**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/redesign/cleaner/job/CleanerPhotoCapture.tsx src/components/redesign/cleaner/job/active-job-presenters.ts src/components/redesign/cleaner/job/active-job-presenters.test.ts
git commit -m "feat(slice3): CleanerPhotoCapture sub-screen + photoStatusLabel"
```

---

### Task 8: `CleanerChecklistView` sub-screen (+ presenter test)

**Files:**
- Create: `src/components/redesign/cleaner/job/CleanerChecklistView.tsx`
- Modify: `src/components/redesign/cleaner/job/active-job-presenters.ts` (+ test) — add `checklistProgressLabel`.

**Interfaces:**
- Consumes: `useChecklist` (returns `ChecklistWithItems` with `checklist_line_items: {id, task, position}[]`), `useChecklistCompletions` + `useToggleChecklistItem` (Task 6).
- Produces: `<CleanerChecklistView appointmentId checklistId onBack />`. `checklistProgressLabel(done, total): string`.

- [ ] **Step 1: Write the failing presenter test**:

```ts
import { checklistProgressLabel } from './active-job-presenters';
describe('checklistProgressLabel', () => {
  it('counts', () => expect(checklistProgressLabel(2, 5)).toBe('2 of 5 done'));
  it('all done', () => expect(checklistProgressLabel(5, 5)).toBe('All 5 done'));
  it('empty list', () => expect(checklistProgressLabel(0, 0)).toBe('No tasks'));
});
```

- [ ] **Step 2: Run (FAIL), then implement** `checklistProgressLabel`:

```ts
export function checklistProgressLabel(done: number, total: number): string {
  if (total === 0) return 'No tasks';
  if (done >= total) return `All ${total} done`;
  return `${done} of ${total} done`;
}
```

  Re-run → PASS.

- [ ] **Step 3: Build `CleanerChecklistView.tsx`**: header with back chevron + `checklistProgressLabel`; a list of 48px tappable rows (each task: a checkbox/check primitive + the task text), `done = completedSet.has(item.id)`, tapping calls `useToggleChecklistItem({ appointmentId, lineItemId: item.id, done: !done })` (optimistic). Order tasks by `position` (NULL last, then `created_at`/insertion). Empty state ("No checklist for this job") when no `checklist_line_items`. Design-system primitives only.

- [ ] **Step 4: Type-check + lint** (`npx tsc --noEmit`, `npm run lint`) → clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/cleaner/job/CleanerChecklistView.tsx src/components/redesign/cleaner/job/active-job-presenters.ts src/components/redesign/cleaner/job/active-job-presenters.test.ts
git commit -m "feat(slice3): CleanerChecklistView sub-screen + checklistProgressLabel"
```

---

### Task 9: `CleanerCompleteSheet` (+ presenter test)

**Files:**
- Create: `src/components/redesign/cleaner/job/CleanerCompleteSheet.tsx`
- Modify: `src/components/redesign/cleaner/job/active-job-presenters.ts` (+ test) — add `completeSuccessCopy` + `formatCents`.

**Interfaces:**
- Consumes: `useChargeProjection` (Task 6), `useCompleteJob` (Task 6), `ui/drawer.tsx` or `ui/sheet.tsx`, `ChargeProjection`.
- Produces: `<CleanerCompleteSheet open appointmentId onClose onCompleted />`. `completeSuccessCopy(outcome, cleanerCutCents): { title; body }`; `formatCents(cents): string` (e.g. `'$120.00'`).

- [ ] **Step 1: Write the failing presenter test** covering the outcome→copy map (and that copy contains NO em dash):

```ts
import { completeSuccessCopy, formatCents } from './active-job-presenters';
describe('formatCents', () => { it('dollars', () => expect(formatCents(12000)).toBe('$120.00')); });
describe('completeSuccessCopy', () => {
  it('charged', () => {
    const c = completeSuccessCopy('charged', 4800);
    expect(c.title).toBe('Job complete');
    expect(c.body).toContain('$48.00');
    expect(c.body).not.toContain('—');
  });
  it('processing (ACH)', () => expect(completeSuccessCopy('processing', 4800).body.toLowerCase()).toContain('processing'));
  it('declined surfaces calmly, no blame', () => {
    const c = completeSuccessCopy('declined', 4800);
    expect(c.title).toBe('Job complete');
    expect(c.body.toLowerCase()).toContain('operator');
  });
  it('unknown outcome still completes', () => expect(completeSuccessCopy(undefined, 4800).title).toBe('Job complete'));
});
```

- [ ] **Step 2: Run (FAIL), then implement** `formatCents` + `completeSuccessCopy` (map `charged`/`processing`/`requires_action`/`declined`/`no_card`/`failed`/`undefined` per the spec's "Complete flow" copy; never blame the cleaner; no em dashes). Re-run → PASS.

- [ ] **Step 3: Build `CleanerCompleteSheet.tsx`** using `ui/drawer.tsx` (bottom sheet): on open, call `useChargeProjection(appointmentId, true)`; show a small breakdown — "Customer is charged `formatCents(projection.chargeCents)`" and "Your cut `formatCents(projection.cleanerCutCents)`" (loading skeleton while fetching). Primary button "Complete job" → `useCompleteJob().mutateAsync(appointmentId)` → on resolve, swap to a green-check success state using `completeSuccessCopy(chargeOutcome, projection.cleanerCutCents)`; a "Done" button calls `onCompleted()` (Task 10 closes the takeover → back to Today). Secondary "Not yet" closes the sheet. Disable the primary while completing; never im-ply settled money for ACH.

- [ ] **Step 4: Type-check + lint** → clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/cleaner/job/CleanerCompleteSheet.tsx src/components/redesign/cleaner/job/active-job-presenters.ts src/components/redesign/cleaner/job/active-job-presenters.test.ts
git commit -m "feat(slice3): CleanerCompleteSheet + complete copy presenters"
```

---

### Task 10: `CleanerActiveJob` container + `CleanerActiveJobView` overview

**Files:**
- Create: `src/components/redesign/cleaner/job/CleanerActiveJob.tsx` (container)
- Create: `src/components/redesign/cleaner/job/CleanerActiveJobView.tsx` (pure overview)

**Interfaces:**
- Consumes: `deriveActiveJob` (Task 2), `useImageUpload` (×2: before/after), `useJobPhotosForAppointment`, `useChecklist`, `useChecklistCompletions`, `useUpdateJobProgress`, `useSkipPhotos` (Task 6), the appointment detail (reuse Slice 2's `deriveJobDetail`/presenters), `CleanerPhotoCapture` (7), `CleanerChecklistView` (8), `CleanerCompleteSheet` (9), `active-job-types.ts` `ActiveJobScreen`.
- Produces: `<CleanerActiveJob appointmentId onClose />` (consumed by Task 11). `onClose` returns to Today (clears `?job=`).

- [ ] **Step 1: Build `CleanerActiveJob.tsx` (container).** Holds: `const [screen, setScreen] = useState<ActiveJobScreen>('overview')`; two `useImageUpload` managers (`beforeUploader`, `afterUploader`) so in-flight uploads persist across sub-screen navigation; `useJobPhotosForAppointment(appointmentId)` (confirmed before/after); `useChecklist` + `useChecklistCompletions`; the appointment via the existing detail hook. Compute:

```ts
const beforeInFlight = beforeUploader.items.filter(i => i.status !== 'failed').length;
const afterInFlight  = afterUploader.items.filter(i => i.status !== 'failed').length;
const beforeSatisfied = beforePhotos.length > 0 || beforeInFlight > 0;
const afterSatisfied  = afterPhotos.length > 0 || afterInFlight > 0;
const gate = deriveActiveJob({ requireJobPhotos: org.require_job_photos, photosSkipped: appointment.photos_skipped, beforeSatisfied, afterSatisfied });
```

  Render `CleanerActiveJobView` for `screen==='overview'`; `CleanerPhotoCapture` for `'before'|'after'` (pass the matching uploader + confirmed photos + `onBack={() => setScreen('overview')}`); `CleanerChecklistView` for `'checklist'`; mount `CleanerCompleteSheet` with `open={screen==='complete'}`. When the cleaner first opens a section, call `useUpdateJobProgress` to advance `job_progress` (best-effort; loose order). Wire the skip flow: a "Can't add photos" action opens a reason capture (radio customer declined / no signal / other + freetext) → `useSkipPhotos.mutate({ appointmentId, reason })` → gate recomputes from the refreshed `photos_skipped`.

- [ ] **Step 2: Build `CleanerActiveJobView.tsx` (pure overview).** Props: job context fields (reuse Slice 2 presenters: `propertyTitle`, `customerLabel`, `propertyAddress`, `mapsUrl`, time/date), the three section summaries (`photoStatusLabel`/`checklistProgressLabel` results + a done/needed badge per the `CleanerJobBadge` vocabulary), `gate`, and callbacks `onOpen(screen)`, `onComplete`, `onSkipPhotos`. Layout: context block at top (with Directions link + disabled "Message operator" placeholder), three tappable section cards (Before / Checklist / After) each showing status + a pill, and a **persistent bottom Complete bar**: primary "Complete job" enabled only when `gate.canComplete` (else show `gate.remaining.join(', ')` as a hint and surface the low-emphasis "Can't add photos" action). Design-system primitives only; status via pills/badges.

- [ ] **Step 3: Type-check + lint** → clean. (No new unit test file here beyond the presenters already covered; the gate logic is tested in Task 2. Optionally add a tiny render smoke test if the area has a precedent — check `today/` for a `*View.test.tsx`; if none exists, skip per YAGNI.)

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/cleaner/job/CleanerActiveJob.tsx src/components/redesign/cleaner/job/CleanerActiveJobView.tsx
git commit -m "feat(slice3): CleanerActiveJob container + overview (gate, sub-screen stack, skip)"
```

---

### Task 11: Wire `mode==='continue'` + remove the legacy bridge

**Files:**
- Modify: `src/components/redesign/cleaner/job/CleanerJobDetailOverlay.tsx`
- Modify: `src/components/redesign/cleaner/job/CleanerJobDetailHost.tsx`
- Modify: the Today active-job "Continue" path (`src/components/redesign/cleaner/today/*` — find the in_progress continue handler)

**Interfaces:**
- Consumes: `CleanerActiveJob` (Task 10), the existing `deriveJobActionMode`/`?job=` plumbing.
- Produces: tapping "Continue job" on an `in_progress` job opens the in-redesign active-job flow (no navigation to `/cleaner-dashboard?appointment=`).

- [ ] **Step 1: In `CleanerJobDetailOverlay.tsx`,** when the derived action mode is `'continue'`, render `<CleanerActiveJob appointmentId={appointment.id} onClose={onClose} />` as the overlay body instead of the read-only detail; keep the read-only detail for offer/start/done modes. Preserve the existing Escape/`defaultPrevented` guard and safe-area chrome.

- [ ] **Step 2: In `CleanerJobDetailHost.tsx`,** delete the `onContinue = router.push('/cleaner-dashboard?appointment=' + id)` bridge; "Continue" now just ensures the takeover is open on that `?job=` (the overlay body handles the rest). Grep for other `?appointment=` bridges in the redesign cleaner tree and repoint any `in_progress` continue path to the redesign overlay (leave non-redesign legacy untouched).

- [ ] **Step 3: In `today/`,** make the active-job card's "Continue" open the redesign job overlay (`useOpenJob`) rather than the legacy bridge. Confirm Today still renders the pinned active job (Slice 1 behavior) and only the continue target changed.

- [ ] **Step 4: Type-check + lint + unit suite**

Run: `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`
Expected: clean; all unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/cleaner/job/CleanerJobDetailOverlay.tsx src/components/redesign/cleaner/job/CleanerJobDetailHost.tsx src/components/redesign/cleaner/today/
git commit -m "feat(slice3): wire continue mode to redesign active-job, drop legacy bridge"
```

---

### Task 12: E2E + full gates + conformance + PR

**Files:**
- Create: `tests/e2e/cleaner-active-job.spec.ts`

- [ ] **Step 1: Write the E2E spec** (375px, redesign flag on, dev login roster): sign in as a cleaner with an `in_progress` (or start a confirmed) job → open the job → tap into Before photos and attach a fixture image → back → tick a checklist item → After photos attach → Complete bar enabled → open Complete sheet → see charge + cut → Complete → green check → back to Today. Add a second path: a job where photos are skipped via "Can't add photos" → reason → Complete enabled. Reuse existing e2e auth/fixtures helpers. Mock/stub uploads if the harness lacks storage (follow any existing photo e2e precedent; if none, gate the upload assertions behind a `test.skip` with a logged reason rather than flaking).

- [ ] **Step 2: Run the full local gates**

Run (in order):
```bash
npx supabase db reset      # migration 095 rebuilds cleanly
npm run test               # unit + integration (needs supabase start)
npx tsc --noEmit
npm run lint
```
Expected: green (note any pre-existing type errors not introduced here). If `npm run test` flakes on GoTrue (`Database error checking email`), re-run the specific touched files in isolation (see memory `reference_integration_test_gotrue_flakiness`).

- [ ] **Step 3: ui-ux-pro-max conformance pass** against the REAL components (run the CLI with the full Python 3.11 exe per `reference_ui_ux_pro_max`): verify touch targets, no raw hex / off-system styling leaked, badge-vocabulary for status, reduced-motion. Fix any leak.

- [ ] **Step 4: Visual capture (Bridger is on mobile).** With `npm run dev` running, use the Playwright MCP at 375px to screenshot the overview, a photo sub-screen, the checklist, and the Complete sheet (built screens, not mockups). VIEW each screenshot before sending; clear `.next` if a route 404s (Turbopack cold-compile flake).

- [ ] **Step 5: Codex review + apply valid findings**

```bash
node "<codex-plugin>/scripts/codex-companion.mjs" review --scope branch --base master
```
Resolve the plugin path at runtime (glob `codex-companion.mjs`). Apply valid findings as a `fix: address Codex review` follow-up commit.

- [ ] **Step 6: Push + open PR to master**

```bash
git push -u origin feat/redesign-cleaner-app-slice3
gh pr create --base master --title "feat(redesign): cleaner active-job flow (Slice 3, flag-gated)" --body "<summary + test evidence>"
```
Four checks must go green (CI typecheck+lint, CI unit+integration, E2E ×2). Merge when green.

---

## Self-Review (completed)

- **Spec coverage:** migration 095 (T1) ✓; exact-cut projection + read + hook (T3/T4/T6) ✓; skip route + appointment columns, no notification (T1/T5/T6/T10) ✓; persisted checklist (T1/T6/T8) ✓; photo gate queued-or-confirmed + container-owned uploaders (T2/T7/T10) ✓; overview + 3 cards + Complete bar (T10) ✓; Complete sheet + charge wiring + ACH/non-fatal copy (T6/T9) ✓; legacy-bridge removal (T11) ✓; flag-gating + dollars + no-em-dash threaded through Global Constraints + per-task ✓; E2E + gates + conformance (T12) ✓.
- **Placeholder scan:** logic/migration/route/presenter tasks carry full code; UI tasks (7-10) carry exact props/interfaces + design-system instructions + reference files to mirror (acceptable: a React component body cannot be fully literal in a plan, but every interface, prop, and acceptance criterion is concrete).
- **Type consistency:** `ChargeProjection`/`ProjectCompletionChargeInput` fields, `ActiveJobGateInput`/`ActiveJobGate`, `ActiveJobScreen`, the hook signatures, and the presenter names (`photoStatusLabel`, `checklistProgressLabel`, `completeSuccessCopy`, `formatCents`) are used consistently across tasks.
