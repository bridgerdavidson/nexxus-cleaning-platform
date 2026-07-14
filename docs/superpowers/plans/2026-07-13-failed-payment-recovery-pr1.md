# Failed-payment recovery (PR 1: core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators and homeowners an in-redesign way to recover a failed charge — an operator Payment section in `BookingDetailSheet` (Retry / Change card / Email card link) and a homeowner Payment section in `HomeownerCleaningDetail` (Update card / Pay now) — plus the collapsible sheet IA and the backend changes they need, without a double-charge race.

**Architecture:** Reuse the existing charge + change-card routes. Add (a) a scoped `homeowner` extension of the charge route, (b) a per-appointment atomic charge "claim" to serialize concurrent retries, (c) a `Collapsible` primitive + IA refactor of the sheet, and (d) pure state-machine presenters that both payment sections render from. Email is deferred to PR 2; "Email card link" ships with today's copy-link behavior.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3 (design tokens), Supabase (admin client + RLS), Stripe (via `getStripe`/lib submodules), TanStack Query v5, Vitest.

## Global Constraints

- **Design system only.** Implement from `src/components/ui/*` + tokens in `tailwind.config.js`/`src/app/globals.css` (brand `#0150FC`). No raw hex, no bespoke one-off classes, no copied mockup styling. Status uses `PaymentBadge`/`BookingStatusBadge` vocabulary.
- **No em dashes** (the `—` character) in any user-facing copy (labels, toasts, email, errors). Use periods/commas/parentheses.
- **Feature flag:** payment sections + charge/change actions render only when `stripeNewChargeFlowUiEnabled()` (client) is true; routes already require `stripeNewChargeFlowEnabled()` (server). When off, the sheet keeps its current display-only payment block.
- **No database migration** in PR 1. `authorization_status` is unconstrained `text`, so the `'charging'` claim sentinel needs none.
- **Permissions:** operator payment actions gated by `can_manage_payments` in UI (owner/admin bypass; manager needs the flag) and re-checked server-side. Homeowner charge extension is fail-closed (see Task 4).
- **Testing:** pure logic → co-located `*.test.ts` (vitest, node env, NO React Testing Library — test functions, not rendered components). Routes → co-located `*.integration.test.ts` using `tests/helpers/{supabase,auth,db,fixtures,stripe}`. Components verified via `npx tsc --noEmit` + lint + browser.
- **Commit trailer** on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- Gates before PR: `npm run test`, `npx tsc --noEmit` (no new errors over the 12-error baseline), `npm run lint`.

---

## File structure

**New:**
- `src/components/ui/collapsible.tsx` — lightweight independently-toggled collapsible section primitive.
- `src/lib/payments/paymentSectionState.ts` (+ `.test.ts`) — pure state machine (`derivePaymentSectionState`) + charge-response mapping (`mapChargeResponse`), shared by both payment sections.
- `src/components/redesign/bookings/payment/OperatorPaymentSection.tsx` — R6 UI.
- `src/components/redesign/bookings/payment/ChangeCardSheet.tsx` — operator change-card picker (homeowner's saved cards).
- `src/components/redesign/bookings/payment/useAppointmentCard.ts` — resolves the on-file card for an appointment via the staff saved-cards route.
- `src/components/redesign/homeowner/cleanings/HomeownerPaymentRecovery.tsx` — R7 UI.

**Modify:**
- `src/lib/payments/chargeCompletedAppointment.ts` — atomic charge claim + self-pay non-staff guard.
- `src/app/api/appointments/[appointmentId]/charge/route.ts` — homeowner allowlist branch + widened SELECT.
- `src/hooks/useAdminData.ts` — add `payment_method_id` to the admin appointments select + `AdminAppointment` type.
- `src/hooks/useHomeownerData.ts` — add `organization_id`, `authorization_status`, `payment_method_id` + card metadata to the homeowner appointments select + `Appointment` type.
- `src/components/redesign/bookings/BookingDetailSheet.tsx` — collapsible IA + mount `OperatorPaymentSection`.
- `src/components/redesign/homeowner/cleanings/HomeownerCleaningDetail.tsx` — mount `HomeownerPaymentRecovery`.
- `src/components/redesign/payments/usePaymentsTriage.ts` — delete the legacy `fixCard` `/admin-dashboard` escape (open `?booking=` in place).

**Tests:**
- `src/lib/payments/paymentSectionState.test.ts`
- `src/app/api/appointments/[appointmentId]/charge/route.integration.test.ts` (extend if it exists; else create)

---

## Task 1: `Collapsible` primitive

**Files:**
- Create: `src/components/ui/collapsible.tsx`

**Interfaces:**
- Produces: `Collapsible({ title, defaultOpen?, right?, children }: { title: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode; children: React.ReactNode })`

- [ ] **Step 1: Implement the primitive**

Reuse the accordion's grid-rows animation and a11y wiring, with light inline chrome that fits the sheet (no big bordered card). Independent local open state (NOT single-open).

```tsx
'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A single, independently-toggled collapsible section for the booking sheet.
 * Unlike ui/accordion (single-open, card chrome), each Collapsible owns its own
 * open state so several can be open at once. Smooth height via grid-template-rows.
 */
export function Collapsible({
  title,
  defaultOpen = false,
  right,
  children,
}: {
  title: React.ReactNode;
  defaultOpen?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  const panelId = `collapsible-${id}`;
  const triggerId = `collapsible-trigger-${id}`;
  return (
    <div>
      <button
        type="button"
        id={triggerId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-control py-1.5 text-left text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2">{title}</span>
        <span className="flex items-center gap-2">
          {right}
          <ChevronDown
            className={cn('size-4 shrink-0 transition-transform duration-base ease-out-soft', open && 'rotate-180')}
            aria-hidden
          />
        </span>
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        className={cn('grid transition-[grid-template-rows] duration-base ease-out-soft', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
      >
        <div className="overflow-hidden">
          <div className="pt-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep collapsible || echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/collapsible.tsx
git commit -m "feat(ui): lightweight independently-toggled Collapsible primitive"
```

---

## Task 2: Payment section state machine (pure logic)

**Files:**
- Create: `src/lib/payments/paymentSectionState.ts`
- Test: `src/lib/payments/paymentSectionState.test.ts`

**Interfaces:**
- Produces:
  - `type PaymentSectionState = 'failed' | 'requires_action' | 'processing' | 'before_charge' | 'paid' | 'no_card' | 'self_pay'`
  - `derivePaymentSectionState(input: { authorizationStatus: string | null; paymentStatus: string | null; isSelfPay: boolean; jobCompleted: boolean; hasCard: boolean }): PaymentSectionState`
  - `type ChargeOutcome = 'charged' | 'processing' | 'requires_action' | 'declined' | 'precondition'`
  - `mapChargeResponse(code: string | null, httpStatus: number): { outcome: ChargeOutcome; badgeTone: 'success' | 'info' | 'caution' | 'critical'; stayFailed: boolean }`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { derivePaymentSectionState, mapChargeResponse } from './paymentSectionState';

describe('derivePaymentSectionState', () => {
  const base = { authorizationStatus: null, paymentStatus: null, isSelfPay: false, jobCompleted: false, hasCard: true };
  it('self-pay wins over everything', () => {
    expect(derivePaymentSectionState({ ...base, isSelfPay: true, authorizationStatus: 'failed' })).toBe('self_pay');
  });
  it('failed', () => {
    expect(derivePaymentSectionState({ ...base, authorizationStatus: 'failed', jobCompleted: true })).toBe('failed');
  });
  it('requires_action', () => {
    expect(derivePaymentSectionState({ ...base, authorizationStatus: 'requires_action', jobCompleted: true })).toBe('requires_action');
  });
  it('paid', () => {
    expect(derivePaymentSectionState({ ...base, paymentStatus: 'paid', authorizationStatus: 'captured' })).toBe('paid');
  });
  it('processing', () => {
    expect(derivePaymentSectionState({ ...base, paymentStatus: 'processing' })).toBe('processing');
  });
  it('no card', () => {
    expect(derivePaymentSectionState({ ...base, hasCard: false })).toBe('no_card');
  });
  it('before charge (card on file, not completed)', () => {
    expect(derivePaymentSectionState({ ...base, hasCard: true, jobCompleted: false })).toBe('before_charge');
  });
});

describe('mapChargeResponse', () => {
  it('charged -> success/paid', () => {
    expect(mapChargeResponse('charged', 200)).toEqual({ outcome: 'charged', badgeTone: 'success', stayFailed: false });
  });
  it('processing -> info', () => {
    expect(mapChargeResponse('processing', 200)).toEqual({ outcome: 'processing', badgeTone: 'info', stayFailed: false });
  });
  it('requires_action -> caution, not paid', () => {
    expect(mapChargeResponse('requires_action', 402)).toEqual({ outcome: 'requires_action', badgeTone: 'caution', stayFailed: false });
  });
  it('declined -> stays failed', () => {
    expect(mapChargeResponse('declined', 402)).toEqual({ outcome: 'declined', badgeTone: 'critical', stayFailed: true });
  });
  it('precondition 409 -> stays failed', () => {
    expect(mapChargeResponse('no_card', 409)).toEqual({ outcome: 'precondition', badgeTone: 'critical', stayFailed: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- paymentSectionState`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
export type PaymentSectionState =
  | 'failed'
  | 'requires_action'
  | 'processing'
  | 'before_charge'
  | 'paid'
  | 'no_card'
  | 'self_pay';

/**
 * Which payment sub-state a booking is in, for both the operator and homeowner
 * payment sections. Order matters: self-pay short-circuits (company-funded),
 * then explicit authorization failures, then settled/processing, then the
 * pre-charge states.
 */
export function derivePaymentSectionState(input: {
  authorizationStatus: string | null;
  paymentStatus: string | null;
  isSelfPay: boolean;
  jobCompleted: boolean;
  hasCard: boolean;
}): PaymentSectionState {
  const { authorizationStatus, paymentStatus, isSelfPay, jobCompleted, hasCard } = input;
  if (isSelfPay) return 'self_pay';
  if (authorizationStatus === 'failed') return 'failed';
  if (authorizationStatus === 'requires_action') return 'requires_action';
  if (paymentStatus === 'paid' || authorizationStatus === 'captured') return 'paid';
  if (paymentStatus === 'processing') return 'processing';
  if (!hasCard) return 'no_card';
  void jobCompleted; // reserved for future "after completion, before charge" nuance
  return 'before_charge';
}

export type ChargeOutcome = 'charged' | 'processing' | 'requires_action' | 'declined' | 'precondition';

/**
 * Maps a charge route response (its `code` + HTTP status) to how the payment
 * section should present the outcome. Never optimistically shows Paid; the
 * badge is driven by the actual returned code.
 */
export function mapChargeResponse(
  code: string | null,
  httpStatus: number,
): { outcome: ChargeOutcome; badgeTone: 'success' | 'info' | 'caution' | 'critical'; stayFailed: boolean } {
  if (code === 'charged') return { outcome: 'charged', badgeTone: 'success', stayFailed: false };
  if (code === 'processing') return { outcome: 'processing', badgeTone: 'info', stayFailed: false };
  if (code === 'requires_action') return { outcome: 'requires_action', badgeTone: 'caution', stayFailed: false };
  if (code === 'declined') return { outcome: 'declined', badgeTone: 'critical', stayFailed: true };
  // tenant_not_ready / no_card / no_org_card / cleaner_not_payable / not_chargeable / charge_in_progress
  if (httpStatus === 409 || httpStatus >= 400) return { outcome: 'precondition', badgeTone: 'critical', stayFailed: true };
  return { outcome: 'declined', badgeTone: 'critical', stayFailed: true };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- paymentSectionState`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/paymentSectionState.ts src/lib/payments/paymentSectionState.test.ts
git commit -m "feat(payments): payment-section state machine + charge-response mapping"
```

---

## Task 3: Serialize concurrent charges (double-charge fix)

**Files:**
- Modify: `src/lib/payments/chargeCompletedAppointment.ts`
- Test: `src/app/api/appointments/[appointmentId]/charge/route.integration.test.ts`

**Context to read first:** open `chargeCompletedAppointment.ts` and locate `chargeCompletedAppointmentAuto`, `alreadySettled`, and `nextReauthAttempt`. The claim goes at the **top of the charge body**, after the settled-check and before the Stripe call, so every caller (operator route, homeowner route, webhook re-charge) funnels through it.

**Interfaces:**
- Produces: a new terminal outcome code `charge_in_progress` (HTTP 409) returned when the appointment is already being charged. Add it to the route's `HTTP_BY_CODE`/`ChargeNowCode` union used by Task 4's route.

- [ ] **Step 1: Add the atomic claim**

Insert an atomic claim that flips the appointment into a transient `'charging'` sentinel only if it is currently chargeable (null / failed / requires_action). Exactly one concurrent caller wins the row update; the loser gets 0 rows and returns `charge_in_progress`. Capture the prior status to restore on unexpected error.

```ts
// Inside chargeCompletedAppointmentAuto, after alreadySettled() passes and
// before creating the PaymentIntent. `supabase` is the admin client in scope.
const CHARGEABLE = ['failed', 'requires_action']; // plus NULL (initial charge)
const { data: claimRows, error: claimErr } = await supabase
  .from('appointments')
  .update({ authorization_status: 'charging' })
  .eq('id', appointmentId)
  .or('authorization_status.is.null,authorization_status.in.(failed,requires_action)')
  .select('id, authorization_status');
if (claimErr) throw claimErr;
if (!claimRows || claimRows.length === 0) {
  // Another retry (operator + homeowner, or a double click) holds the charge.
  return { ok: false, code: 'charge_in_progress' as const };
}
// Remember what to restore to if we crash before finishCharge writes the terminal status.
// The claim set it to 'charging'; the pre-claim value was one of null/failed/requires_action.
// We conservatively restore to NULL on unexpected error so the reconcile sweep re-attempts.
let terminalWritten = false;
try {
  // ... existing nextReauthAttempt + createDestinationCharge/createSelfPayCharge + finishCharge ...
  // finishCharge writes captured/failed/requires_action -> set terminalWritten = true right after it.
} finally {
  if (!terminalWritten) {
    await supabase.from('appointments').update({ authorization_status: null }).eq('id', appointmentId).eq('authorization_status', 'charging');
  }
}
```

Notes for the implementer:
- Set `terminalWritten = true` immediately after the existing `finishCharge(...)` call (both success and Stripe-decline paths run through `finishCharge`, which writes the real terminal status, overwriting `'charging'`).
- The `.eq('authorization_status', 'charging')` guard on the finally-restore ensures we only reset a still-claimed row (never clobber a terminal status a racing finish wrote).
- **Known residual (out of scope for PR 1, note in the PR):** a hard process crash between claim and `finishCharge` leaves the row in `'charging'` (the `finally` will not run). Follow-up: a `charge_claimed_at` column + reconcile-sweep recovery. This is rare and does not double-charge.

- [ ] **Step 2: Self-pay defense-in-depth**

In the self-pay charge path (`chargeSelfPayNow`/`createSelfPayCharge` entry), reject a non-staff `actor`. The homeowner route guard (Task 4) already blocks self-pay, this is a second layer so a future route regression cannot reach a company-card charge from a homeowner.

```ts
// At the start of the self-pay branch, where the actor/role is known:
if (actor?.role === 'homeowner') {
  return { ok: false, code: 'not_chargeable' as const };
}
```
(If `chargeCompletedAppointmentAuto` does not currently receive the actor role, thread it through from the route; Task 4 passes `auth.role`.)

- [ ] **Step 3: Write the concurrency integration test**

Add to the charge route integration test: fire two `POST` charges for the same failed, completed appointment "concurrently" (await `Promise.all`), assert the Stripe fake's `paymentIntentCalls` has length 1 and exactly one response is `charge_in_progress`.

```ts
it('serializes concurrent charges: only one PaymentIntent, other returns charge_in_progress', async () => {
  const { appointmentId, orgId } = await seedFailedCompletedAppointment(); // fixture helper
  const [a, b] = await Promise.all([
    callRoute(POST, { body: { organization_id: orgId }, params: { appointmentId }, actor: staff }),
    callRoute(POST, { body: { organization_id: orgId }, params: { appointmentId }, actor: staff }),
  ]);
  expect(stripeFake.paymentIntentCalls).toHaveLength(1);
  const codes = [a, b].map((r) => r.status);
  expect(codes).toContain(409); // one lost the claim
});
```
(Adapt `callRoute`/`seed` helpers to the file's existing patterns; the key assertions are the single PaymentIntent + one 409.)

- [ ] **Step 4: Run**

Run: `npm run test:integration -- charge` (needs `npx supabase start`)
Expected: PASS incl. the new concurrency test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/chargeCompletedAppointment.ts 'src/app/api/appointments/[appointmentId]/charge/route.integration.test.ts'
git commit -m "fix(payments): serialize concurrent charges with an atomic claim; self-pay non-staff guard"
```

---

## Task 4: Homeowner charge-route extension

**Files:**
- Modify: `src/app/api/appointments/[appointmentId]/charge/route.ts`
- Test: `src/app/api/appointments/[appointmentId]/charge/route.integration.test.ts`

**Interfaces:**
- Consumes: `charge_in_progress` code from Task 3.
- Produces: the route now accepts `homeowner` callers under a fail-closed guard.

- [ ] **Step 1: Widen the SELECT and add the allowlist branch**

Change the appointment select from `organization_id, is_self_pay, cleaner_id` to also include `homeowner_id, status, authorization_status`. Add `homeowner` to `allowedRoles`, then guard:

```ts
// allowedRoles: ['owner', 'admin', 'manager', 'cleaner', 'homeowner']
const appt = /* select organization_id, is_self_pay, cleaner_id, homeowner_id, status, authorization_status */;

if (auth.role === 'homeowner') {
  const ok =
    appt.homeowner_id === auth.userId &&
    appt.status === 'completed' &&
    appt.authorization_status === 'failed' && // NOT requires_action (off-session cannot clear 3DS)
    !appt.is_self_pay;
  if (!ok) {
    return NextResponse.json({ error: 'Insufficient role for this action' }, { status: 403 });
  }
}
// existing cleaner guard + manager can_manage_payments guard unchanged, below.
```

Thread `auth.role` into `chargeCompletedAppointmentAuto` (for Task 3's self-pay defense) if it is not already passed.

- [ ] **Step 2: Write the negative integration tests**

```ts
it('homeowner charges their OWN failed completed appt: ok', async () => { /* 200 charged */ });
it('homeowner charging someone else\'s appt: 403', async () => { /* homeowner_id mismatch */ });
it('homeowner charging own non-failed appt: 403', async () => { /* authorization_status null/captured */ });
it('homeowner charging own requires_action appt: 403 (no 3DS loop)', async () => { /* authorization_status requires_action */ });
it('homeowner charging own self-pay appt: 403', async () => { /* is_self_pay true */ });
```
Use the existing helpers to mint a homeowner actor and seed each appointment state.

- [ ] **Step 3: Run**

Run: `npm run test:integration -- charge`
Expected: PASS (5 new cases + Task 3's concurrency test).

- [ ] **Step 4: Commit**

```bash
git add 'src/app/api/appointments/[appointmentId]/charge/route.ts' 'src/app/api/appointments/[appointmentId]/charge/route.integration.test.ts'
git commit -m "feat(payments): scoped homeowner extension of the charge route (fail-closed)"
```

---

## Task 5: On-file card data source

**Files:**
- Modify: `src/hooks/useAdminData.ts`
- Create: `src/components/redesign/bookings/payment/useAppointmentCard.ts`

**Interfaces:**
- Produces:
  - `AdminAppointment.payment_method_id: string | null` (added to the type + the select).
  - `useAppointmentCard({ appointmentId, homeownerId, organizationId, paymentMethodId, enabled }): { card: SavedPaymentMethod | null; cards: SavedPaymentMethod[]; loading: boolean; error: boolean; refetch: () => Promise<unknown> }`

- [ ] **Step 1: Add `payment_method_id` to the admin appointments fetch**

In `useAdminData.ts`, add `payment_method_id` to the appointments `.select(...)` string and to the `AdminAppointment` interface (`payment_method_id: string | null`). Do not remove existing fields.

- [ ] **Step 2: Implement the card resolver hook**

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { keys } from '@/lib/queryKeys';
import { sortPaymentMethods, type SavedPaymentMethod } from '@/components/redesign/shared/payment-methods/derive-payment-methods';

/**
 * The homeowner's saved cards for an appointment, plus the specific card attached
 * to it (matched by payment_method_id). Uses the staff route (owner/admin/manager).
 * Powers both the "card on file" display and the Change-card picker.
 */
export function useAppointmentCard(args: {
  appointmentId: string;
  homeownerId: string | null;
  organizationId: string | null;
  paymentMethodId: string | null;
  enabled?: boolean;
}) {
  const { homeownerId, organizationId, paymentMethodId, enabled = true } = args;
  const query = useQuery({
    queryKey: [...keys.paymentMethods.byOrg(organizationId ?? 'none'), 'homeowner', homeownerId ?? 'none'],
    enabled: enabled && !!homeownerId && !!organizationId,
    queryFn: async (): Promise<SavedPaymentMethod[]> => {
      const token = await getAccessToken();
      const params = new URLSearchParams({ homeowner_id: homeownerId!, organization_id: organizationId! });
      const res = await fetch(`/api/stripe/saved-payment-methods?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load the card on file');
      return (data.cards ?? []) as SavedPaymentMethod[];
    },
  });
  const cards = sortPaymentMethods(query.data ?? []);
  const card = cards.find((c) => c.id === paymentMethodId) ?? null;
  return { card, cards, loading: query.isLoading, error: query.isError, refetch: query.refetch };
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep -E "useAdminData|useAppointmentCard" || echo OK` → `OK`

```bash
git add src/hooks/useAdminData.ts src/components/redesign/bookings/payment/useAppointmentCard.ts
git commit -m "feat(payments): resolve an appointment's on-file card via the staff route"
```

---

## Task 6: `BookingDetailSheet` collapsible IA refactor

**Files:**
- Modify: `src/components/redesign/bookings/BookingDetailSheet.tsx`

**Interfaces:**
- Consumes: `Collapsible` (Task 1).

- [ ] **Step 1: Wrap the heavy sections in `Collapsible`**

Import `Collapsible`. Wrap the existing `JobMessagesPanel` block (currently `~280-285`) in `<Collapsible title="Messages">...</Collapsible>` (collapsed by default). Wrap the Decline reason / Special requests / Notes block (`~400-406`) in `<Collapsible title="Requests & notes">...</Collapsible>` when any of those are present. Keep Date/Time, Customer, Cleaner, the Payment block, and the action grid exactly where they are (open). Preserve all existing conditionals and props. No behavior change beyond the collapse affordance.

- [ ] **Step 2: Verify in the browser**

Run the app; open a booking sheet; confirm Messages and Requests collapse/expand independently, other sections unchanged. (Local flags may hide payment actions; that is fine, this task is the IA only.)

- [ ] **Step 3: Typecheck + commit**

```bash
git add src/components/redesign/bookings/BookingDetailSheet.tsx
git commit -m "feat(operator): collapsible IA for the booking detail sheet"
```

---

## Task 7: R6 operator Payment section

**Files:**
- Create: `src/components/redesign/bookings/payment/OperatorPaymentSection.tsx`
- Create: `src/components/redesign/bookings/payment/ChangeCardSheet.tsx`
- Modify: `src/components/redesign/bookings/BookingDetailSheet.tsx`
- Modify: `src/components/redesign/payments/usePaymentsTriage.ts`

**Interfaces:**
- Consumes: `derivePaymentSectionState`, `mapChargeResponse` (Task 2); `useAppointmentCard` (Task 5); `AdminAppointment.payment_method_id` (Task 5); `PaymentBadge`, `Button`, shared `PaymentMethodRow`, `Drawer`.
- `OperatorPaymentSection({ appointment, canManagePayments, priceLabel }: { appointment: AdminAppointment; canManagePayments: boolean; priceLabel: string | null })`
- `ChangeCardSheet({ open, onOpenChange, appointmentId, homeownerId, organizationId, currentPaymentMethodId, onChanged }: ...)`

- [ ] **Step 1: Build `OperatorPaymentSection`**

Render from the design system. Derive the state via `derivePaymentSectionState({ authorizationStatus: appointment.authorization_status, paymentStatus: appointment.payment_status, isSelfPay: appointment.is_self_pay, jobCompleted: appointment.status === 'completed', hasCard: !!appointment.payment_method_id })`. Show total + `PaymentBadge` always; when `canManagePayments`, show the per-state actions per spec §4b:
- `failed` → **Retry charge** (primary), **Change card**, **Email card link**.
- `requires_action` → **Email card link** (primary), **Change card** (no Retry).
- `before_charge` → **Change card**, **Email card link**.
- `paid` / `processing` / `self_pay` → view only (self_pay adds "Managed in Settings, Payments").
- `no_card` → **Email card link**.

Retry: `POST /api/appointments/${id}/charge` with `{ organization_id }`; on response read `{ code }`, apply `mapChargeResponse`, toast + invalidate `keys.appointments.all`; never optimistically show Paid. Email card link: `POST /api/billing/card-links` with `{ organization_id, homeowner_id }`; copy `url` to clipboard + toast "Payment link copied" (PR 2 switches this to email). Use the on-file card from `useAppointmentCard` for display (`PaymentMethodRow` or a compact line).

- [ ] **Step 2: Build `ChangeCardSheet`**

A `Drawer` listing the homeowner's saved cards from `useAppointmentCard().cards` (mark the `currentPaymentMethodId` as "current"); selecting one calls `POST /api/appointments/${appointmentId}/payment-method` with the chosen `payment_method_id` + `{ organization_id }`; on success invalidate + `onChanged()`. If `cards.length <= 1` (only the failing card, or none), show an empty/hint state that routes to **Email card link** instead (operators cannot add a card inline).

- [ ] **Step 3: Mount in the sheet + delete the legacy escape**

Replace the display-only payment block (`BookingDetailSheet.tsx ~287-304`) with `<OperatorPaymentSection appointment={appointment} canManagePayments={canManagePayments} priceLabel={detail.priceLabel} />`, still gated by `canViewPayments` and behind `stripeNewChargeFlowUiEnabled()` (keep the old block as the flag-off fallback). In `usePaymentsTriage.ts`, change `fixCard` to open the redesign booking sheet in place (`?booking=<id>`, mirroring the other triage rows) instead of `router.push('/admin-dashboard?tab=bookings&appointment=...')`.

- [ ] **Step 4: Verify + gates**

`npx tsc --noEmit` (no new errors); `npm run lint`; browser: open a failed-charge booking, confirm the section + actions render and Retry/Change/Email behave.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/bookings/payment/ src/components/redesign/bookings/BookingDetailSheet.tsx src/components/redesign/payments/usePaymentsTriage.ts
git commit -m "feat(operator): payment section with retry/change/email in the booking sheet; drop legacy Fix card escape"
```

---

## Task 8: R7 homeowner Payment section

**Files:**
- Modify: `src/hooks/useHomeownerData.ts`
- Create: `src/components/redesign/homeowner/cleanings/HomeownerPaymentRecovery.tsx`
- Modify: `src/components/redesign/homeowner/cleanings/HomeownerCleaningDetail.tsx`

**Interfaces:**
- Consumes: `derivePaymentSectionState`, `mapChargeResponse` (Task 2); homeowner saved-cards infra (`useSavedPaymentMethods`, `CardPickerSheet`/`AddCardSheet`).
- `HomeownerPaymentRecovery({ appointment }: { appointment: Appointment })` (the homeowner `Appointment` type).

- [ ] **Step 1: Extend the homeowner data layer**

In `useHomeownerData.ts`, add to the appointments `.select(...)` and the `Appointment` interface: `organization_id: string`, `authorization_status: string | null`, `payment_method_id: string | null`, and card metadata (resolve brand/last4 by matching `payment_method_id` against the homeowner's `/api/stripe/my-payment-methods`, reusing `useSavedPaymentMethods`). Without `organization_id`, "Pay now" cannot call the charge route.

- [ ] **Step 2: Build `HomeownerPaymentRecovery`**

Consumer-toned, from the design system. Derive state via `derivePaymentSectionState`. Per spec §5b:
- `failed` → **Pay now $X** (primary) + **Update card**.
- `requires_action` → **Update card** only (no Pay now).
- `before_charge` → Update card; `paid`/`processing` → view only.
Pay now: `POST /api/appointments/${id}/charge` with `{ organization_id: appointment.organization_id }`; apply `mapChargeResponse`; on `charged` show "Paid $X" confirmation; invalidate `keys.appointments.byHomeowner` / homeowner queries. Update card: reuse `CardPickerSheet`/`AddCardSheet` → `POST /api/appointments/${id}/payment-method`.

- [ ] **Step 3: Mount in `HomeownerCleaningDetail`**

Render `<HomeownerPaymentRecovery appointment={appointment} />` in the detail, behind `stripeNewChargeFlowUiEnabled()`; calm/informational unless `failed`/`requires_action`.

- [ ] **Step 4: Verify + gates + commit**

`npx tsc --noEmit`; `npm run lint`; browser (homeowner view) if reachable.

```bash
git add src/hooks/useHomeownerData.ts src/components/redesign/homeowner/cleanings/
git commit -m "feat(homeowner): failed-payment recovery (update card + pay now) in cleaning detail"
```

---

## Task 9: Full gates, browser verification, PR

- [ ] **Step 1: Full gates**

Run: `npm run test` → all green (only the pre-existing `formDraft.test.ts` may fail). `npx tsc --noEmit` → no new errors over the 12-error baseline. `npm run lint` → clean on changed files.

- [ ] **Step 2: No em dashes / design-system conformance sweep**

Run: `grep -rn "—" src/components/redesign/bookings/payment/ src/components/redesign/homeowner/cleanings/HomeownerPaymentRecovery.tsx src/components/ui/collapsible.tsx || echo "no em dashes"`. Scan the new components for raw hex / bespoke classes.

- [ ] **Step 3: Browser verification**

Enable `NEXT_PUBLIC_STRIPE_NEW_CHARGE_FLOW_ENABLED` locally if needed; verify the operator sheet payment section states + the homeowner recovery section. Send screenshots (desktop links) for sign-off.

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin feat/failed-payment-recovery
gh pr create --base master --title "feat: failed-payment recovery in the redesign (R6 + R7)" --body "<summary + verification + notes: email is PR 2; charge-in-progress residual>"
```

- [ ] **Step 5: Watch CI; do not merge without Bridger's go-ahead.**

---

## Self-review

- **Spec coverage:** IA/Collapsible (T1, T6) ✓; R6 section + states + retry mapping + change card + email(copy) + legacy delete (T2, T5, T7) ✓; R7 + data layer + charge extension (T2, T4, T8) ✓; double-charge fix (T3) ✓; card-on-file source (T5) ✓; flags + no-migration + tests (all) ✓. Email delivery is intentionally PR 2 (not here).
- **Type consistency:** `derivePaymentSectionState`/`mapChargeResponse` signatures match across T2/T7/T8; `AdminAppointment.payment_method_id` (T5) consumed in T7; `Appointment` homeowner fields (T8) consumed in T8; `charge_in_progress` code produced in T3, consumed in T4/T7.
- **Placeholders:** none; the two genuinely file-dependent tasks (T3 claim placement, T4 SELECT) point the implementer at exact functions and give the exact code to insert.
