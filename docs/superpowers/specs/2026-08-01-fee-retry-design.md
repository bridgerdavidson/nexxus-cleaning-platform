# Fee retry, end to end (T2-7 + L-7) — design

**Date:** 2026-08-01
**Source items:** MASTER-TODO block 3, item 3.1. Payments audit v4: T2-7 (operator retry, CONFIRMED) + L-7 (homeowner silent success + no retry surface).
**Decisions locked with Bridger:** full L-7 scope (honesty fix + homeowner Pay-now UI), operator retry in the detail sheet only (no triage-band row).

## Problem

A homeowner-fault cancellation/no-show fee is charged off-session at cancel time
(`chargeCancellationFee`, called by `/api/appointments/[appointmentId]/cancel`). When the card
declines or demands 3-D Secure, the helper writes a `payments` row (`status='failed'`,
`charge_kind='cancellation_fee'`) and fires the `cancellation_fee_failed` admin bell — and the
story stops:

- The appointment is already cancelled, so the fee is excluded from every triage surface, and the
  ledger detail sheet offers no action. The only code path that retries is re-POSTing the cancel
  route, which no UI exposes and which computes a $0 fee for staff callers (`party` defaults to
  `'org'`) and recomputes from current policy rather than what was assessed. The org's fee is
  uncollectable through the product (T2-7).
- The homeowner pressed a button labeled "Cancel and pay $X", their card declined, and the sheet
  closed as plain success — `useCancelMyCleaning` and `CancelCleaningSheet` discard the
  `fee_outcome` the route already returns. They believe they paid, and they have no way to pay
  even if they learn otherwise (L-7).

Declines are usually temporary (payday, new card). The missing piece is a human-triggered
"charge it again" anchored on the failed payment row.

## Scope

One PR on `feat/fee-retry`:

1. New retry endpoint keyed on the failed payment row.
2. Race hardening in `chargeCancellationFee` (conditional attempt bump).
3. Operator: "Retry fee charge" in the payment detail sheet.
4. Homeowner: honest post-cancel state + Pay now / Update card on the failed-fee receipt.
5. One-line hardening of the payment-method route so a card swap can't strand a fee row.
6. Chore rider: check off MASTER-TODO 3.4 (price seal, PR #226) and the block-8 org pay-model
   item (PR #232), both merged 2026-08-01 but still unchecked in the doc.

**Non-goals:**

- `uncollectable` fee outcomes (no card / ACH payer / tenant not ready / no customer). They write
  no payments row, so there is nothing to anchor a retry on; the card-link flow remains the answer.
- Triage-band rows for failed fees (decided against: a fee row can't be dismissed, and T2-9's
  dismiss work is payouts-only). Discovery is the existing bell + the ledger's Failed filter +
  "Cancellation fee" label.
- Fee dismissal / write-off.
- Automatic or scheduled retries (hammering a declined card is hostile; the retry moment is human).
- On-session 3DS clearing (no Stripe.js confirm flow; `requires_action` fees remain
  update-card-then-retry or card-link territory).

## 1. Endpoint: `POST /api/payments/[paymentId]/retry-fee`

New route at `src/app/api/payments/[paymentId]/retry-fee/route.ts` (sibling of `refund/`).
Body `{ organization_id }`. `maxDuration = 60`. Returns 404 unless `stripeEnabled() &&
stripeNewChargeFlowEnabled()` (matches siblings).

**Authorization** — `requireOrgAuth` with `allowedRoles: ['owner','admin','manager','homeowner']`:

- Owner/admin: any failed fee in their org.
- Manager: additionally needs `manager_permissions.can_manage_payments` (mirrors
  `/api/payouts/[payoutId]/retry`).
- Homeowner, fail closed: `appointment.homeowner_id === auth.userId` AND the row's
  `payment_intent_status !== 'requires_action'`. Ownership is checked FIRST (403 on failure) and
  only an owned row can produce the card-state response, so a caller can never probe another
  homeowner's card state. An off-session retry cannot clear 3DS (the same reasoning as the charge
  route's homeowner allowlist); a homeowner hitting a `requires_action` row on their own
  appointment gets **409 `requires_card_verification`** — it is a card-state problem, not a
  permissions problem — with copy telling them to update their card. Staff are NOT blocked on
  `requires_action`: a retry after a card swap is legitimate, and an unchanged card just fails
  again harmlessly (ledgered, re-belled).

**Validation order:**

1. Payment row loaded by id (`id, organization_id, appointment_id, amount, status, charge_kind,
   payment_intent_status`). Missing or org mismatch → 404 (no existence leak).
2. `charge_kind !== 'cancellation_fee'` → 409.
3. `status`: `'failed'` proceeds. `'paid'` / `'processing'` → **200 already-collected no-op**
   (`{ success: true, code: 'charged', already: true }`) so a double-click or stale sheet is
   friendly. Anything else (`pending`, `refunded`) → 409.
4. Appointment loaded (`id, organization_id, homeowner_id, payment_method_id, reauth_count,
   status`). Missing → 409. `status !== 'cancelled'` → 409 (fees only exist on cancelled
   appointments; defensive).

**Execution:**

- Fee amount = `Math.round(Number(row.amount) * 100)` — the fee actually assessed at cancel time,
  immune to later policy edits. Never recomputed from policy.
- `party` / `no_show` / `inside_window` recovered from the latest `payment_events` row for the
  appointment with `event_type IN ('cancellation_fee_failed', 'cancellation_fee_charged',
  'cancellation_fee_uncollectable')` (their payloads carry all three fields). Fallback when no
  event is found: `{ party: 'homeowner', no_show: false, inside_window: true }`. These drive
  notification copy and forensics only — never the amount.
- Breadcrumb first: `recordPaymentEvent` `'cancellation_fee_retry_requested'` with
  `actor: user:<id>`, the amount, and `{ payment_id, role }` payload (mirrors
  `payout_retry_requested`).
- Then `chargeCancellationFee(supabaseAdmin, appt, feeCents, actor, ctx)` — unchanged in its
  responsibilities: paid-row short-circuit, attempt bump + fresh idempotency key
  (`cancelfee-{appointmentId}-{attempt}`), same-row update, `payment_events` ledger, admin bell
  on failure, homeowner bell on success.

**Response mapping** (helper outcome → HTTP):

| outcome | HTTP | body |
|---|---|---|
| `charged` | 200 | `{ success: true, code: 'charged', fee_captured_cents }` |
| `failed` | 402 | `{ success: false, code: 'failed', error: <decline message> }` |
| `uncollectable` | 409 | `{ success: false, code: 'uncollectable', error: <copy prompting a card> }` (e.g. the card was removed since cancel) |
| `retry_in_progress` | 409 | `{ success: false, code: 'retry_in_progress', error: "Another retry for this fee is already running. Give it a moment, then refresh." }` |

## 2. Helper hardening: `chargeCancellationFee`

Today the attempt bump is read-then-write: two concurrent retries can both read
`reauth_count = N`; in the narrow window where the first has bumped and charged but not yet
written its outcome row, the second reads `N+1`, bumps to `N+2`, and charges a **second** PI under
a fresh key — a real double-charge window. (Both reading `N` simultaneously is safe: same key,
Stripe dedupes.)

Fix: make the bump a conditional claim.

- `UPDATE appointments SET reauth_count = <read>+1 WHERE id = <appt> AND reauth_count <is> <read>`
  — null-aware, since the column starts `NULL` (`.is('reauth_count', null)` when the read value
  was null, `.eq(...)` otherwise), with `.select('id')` to observe the claimed row count.
- Zero rows updated → another caller owns the retry window → return the new outcome code
  **`retry_in_progress`** (`CancellationFeeCode` gains it) with `feeCapturedCents: 0` and no
  charge attempted.

This also hardens the pre-existing concurrent double-cancel race for free. The cancel route needs
no logic change: it already passes `outcome.code` through as `fee_outcome`.

`CancellationFeeOutcome` also gains **`paymentId?: string`** — populated on the success path and
both failed paths (the row id is already in hand in all three). The cancel route returns it as
**`fee_payment_id`**, which is what lets the homeowner cancel sheet deep-link to the fee receipt.

No other behavior changes in the helper.

## 3. Operator UI

- `PAYMENTS_INFINITE_SELECT` (useAdminData) adds `payment_intent_status`; `AdminPayment` gains
  `payment_intent_status?: string | null`.
- `TransactionDetailVM` gains two data-only flags:
  - `feeRetryable`: `charge_kind === 'cancellation_fee' && status === 'failed'`
  - `feeNeedsCardVerification`: `payment_intent_status === 'requires_action'`
- `PaymentDetailSheet`, transactions branch: when `canManagePayments && txn.feeRetryable`, the
  footer action area shows a primary **"Retry fee charge"** button (`loading={busy}`, same pattern
  as the payouts-branch Retry) wired to a new `onRetryFee(txn.id)` prop. When
  `feeNeedsCardVerification`, a muted hint renders above it: "The bank needs the customer to
  verify this card. Sending a card link usually works better."
- `OperatorPayments` adds `handleRetryFee`: POST the endpoint with auth headers; on `charged`,
  `toast.success` quoting the captured amount and invalidate `keys.payments.infinite(orgId)` +
  `keys.payments.statsByOrg(orgId)`; otherwise `toast.error` with the server's `error` string.
  Shares the existing `busy` state.

Copy rule: no em dashes in any user-facing string (house rule).

## 4. Homeowner UI

**Cancel sheet honesty.** `useCancelMyCleaning` returns the full cancel payload
(`fee_outcome`, `fee_captured_cents`, `fee_message`, `fee_payment_id`) instead of discarding it.
`CancelCleaningSheet.submit`: when the cancel succeeds with `fee_outcome` of `'failed'` or
`'uncollectable'`, the sheet does NOT close as success; it switches to a post-cancel state:

- Title: "Cleaning cancelled".
- Body (failed): "We couldn't charge the $50.00 cancellation fee to your card."
  (uncollectable, no row to link): "We couldn't charge the $50.00 cancellation fee because there
  is no chargeable card on file."
- Actions: **View fee** (only when `fee_payment_id` is present; navigates to the fee receipt via
  the receipts deep-link mechanism `useOpenPayment` / `PaymentReceiptHost` already support) and
  **Done** (closes). `onCancelled()` invalidations fire in all cases, as today.
- `charged` and no-fee outcomes behave exactly as today (close as success).

**Receipt actions.** `PaymentReceipt` gains an action area when
`isCancellationFee(payment) && payment.status === 'failed'`:

- **Pay now** (primary): calls the retry endpoint through a small `useRetryFeeCharge` mutation
  hook (`src/hooks/`), which on `charged` invalidates the homeowner payments query (receipt and
  row flip to Paid) and toasts "Paid $X". A re-decline shows inline: "Your card was declined
  again. Update your card and try again." `retry_in_progress` shows its message inline.
- **Update card** (secondary): opens the existing `CardPickerSheet` for the fee's appointment
  (swap/add a card via the existing `/api/appointments/[appointmentId]/payment-method` route),
  same composition `HomeownerPaymentRecovery` uses.
- When the row's `payment_intent_status === 'requires_action'`: hide Pay now, show the
  verification copy ("Your bank needs to verify this card. Update your card to continue.") with
  Update card only — matching `HomeownerPaymentRecovery`'s `requires_action` stance and the
  server-side homeowner gate.
- The homeowner payments select (`useHomeownerData`) adds the fields this needs:
  `payment_intent_status` and the appointment id (+ current `payment_method_id` for the picker).
  `PaymentLike` extends accordingly.

**Payment-method route hardening.** In
`/api/appointments/[appointmentId]/payment-method/route.ts`, the `wasFailed` payments-row reset
gains `.neq('charge_kind', 'cancellation_fee')`. Without it, the edge case "completion charge
failed → appointment cancelled → fee reuses that row" lets a card swap flip the fee row to
`pending` with its PI detached — permanently unretryable (the retry endpoint only accepts
`failed`, and nothing else ever charges a fee row on a cancelled appointment). The
appointment-level part of the reset (clearing `authorization_status`, bumping `reauth_count`) is
harmless and stays.

## 5. Who can do what

| Caller | Can retry | Blocked when |
|---|---|---|
| Owner / admin | any failed fee in org | — |
| Manager | with `can_manage_payments` | without it (403) |
| Homeowner | own appointment's failed fee | someone else's row (403 via allowlist), `requires_action` row (409 `requires_card_verification`) |
| Cleaner | never (not in `allowedRoles`) | always |

## 6. Error handling summary

- **Declines again:** 402, row stays `failed`, ledger event written, admin bell re-fires (the
  `declined` dedupe key already includes the attempt number, so each attempt is a fresh bell).
- **Concurrent retries:** one wins; the loser gets 409 `retry_in_progress`. Same-instant clicks
  that both read the same counter share one idempotency key and Stripe dedupes to one PI.
- **Fee collected in the meantime:** 200 already-collected no-op (route status gate), or the
  helper's paid-row short-circuit if it lands mid-flight.
- **Card removed since cancel:** helper returns `uncollectable` → 409 with add-card guidance.
- **`payment_events` history missing:** fallback context; amount is still exact (from the row).
- **Policy edited since cancel:** irrelevant — the retry charges the row's amount, and the bumped
  idempotency key means Stripe never rejects on an amount mismatch with the original attempt.

## 7. Tests

**New integration suite** `src/app/api/payments/[paymentId]/retry-fee/route.integration.test.ts`
using `tests/helpers/` (`withTestOrg`, `callRoute`, Stripe fake):

- Owner retry on a failed fee row → 200, row flips to `paid`, `cancellation_fee_retry_requested`
  + `cancellation_fee_charged` events written, homeowner notification recorded.
- Homeowner retries their own failed fee → 200 paid.
- Homeowner on someone else's row → 403; manager without `can_manage_payments` → 403; cleaner →
  403.
- Homeowner on a `requires_action` row → 409 `requires_card_verification`; owner on the same row
  → allowed through (fake decline → 402).
- Non-fee row (`charge_kind='completion'`) → 409. Already-`paid` fee row → 200 no-op, no new PI.
- Org mismatch → 404. Flags off → 404. Non-cancelled appointment → 409.
- Decline path: Stripe fake declines → 402, row stays `failed`, attempt counter bumped.
- Conflict path: pre-bump `reauth_count` after the route's read (or unit-level on the helper) →
  409 `retry_in_progress`, no charge.

**Extended existing suites:**

- Cancel route: response includes `fee_payment_id` on a failed fee.
- Payment-method route: card swap on an appointment whose failed revenue row is a
  `cancellation_fee` leaves that row untouched (still `failed`, PI intact).

No migration ships, so no `db reset` gate. No new E2E: money correctness is asserted at the
integration layer, consistent with the rest of the audit work.

## 8. Rollout

No flags (the surfaces are already flag-gated by the new-charge-flow flags), no migration, no ops
step. Normal PR → CI → merge → prod deploy.
