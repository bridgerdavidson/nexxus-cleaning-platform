# Payments audit v3 — charge-at-completion (2026-06-12)

**Supersedes `docs/payments-preview-sweep-v2.md` for this branch.** v2 audited the HOLD model
(authorize-then-capture); `feat/charge-at-completion` removed holds (card/bank SAVED at booking,
CHARGED at completion; cancellation fee = off-session charge at cancel time). This v3 is the full
re-audit of the current architecture across both flows (homeowner-pays, org self-pay) x both rails
(card, ACH): booking, completion charge, cancellation fee, webhooks, settlement, clawbacks,
refunds, reconcile, route security, and tests.

Status legend: **FIXED-PR1** = `fix/setup-intent-auth` (PR #65, master). **FIXED-A** = the Phase A
commit on this branch. **PHASE B/C/D** = specified follow-up PRs below, not yet implemented.

## Findings

### CRITICAL

| # | Finding | Evidence (pre-fix) | Status |
|---|---|---|---|
| C1 | `api/stripe/create-setup-intent` + `confirm-setup-intent` had NO auth: any caller could mint SetupIntents for any `homeowner_id` and overwrite any `user_profiles.stripe_customer_id` with an attacker-controlled Customer. Live in prod. | `confirm-setup-intent/route.ts:9-78` | **FIXED-PR1** (`requireSelfOrOrgStaff` + never repoint a non-null customer id) |
| C2 | Broken recovery loop (hold-removal regression): (a) the card-link re-queue excluded `status='completed'` appointments — exactly the rows that fail under charge-at-completion; (b) reconcile never retried failed/never-run completion charges; (c) a re-charge reused the stale declined `payment_method_id`. A decline/3DS at completion was a permanent manual dead-end. | `dispatchStripeEvent.ts:505-515`, `reconcile.ts:101-118` | **FIXED-A** (re-point includes completed + bumps `reauth_count` + charges inline; new `chargeUncollectedCompletions` sweep; detached-card substitution via customer default) |
| C3 | Cancel during an in-flight ACH debit: payer debited days later for a cancelled job, never refunded; funds stranded on the platform (tenant leg still paid out). | `cancel/route.ts:112-146`, `settleCleanerPayout.ts:100` | **FIXED-A** (refund-on-settle: `charge_kind` metadata + cancelled-appointment branch in `payment_intent.succeeded` and in `settleUnsettledCaptures`; cancel route flags `inflight_debit`) |
| C4 | No uniqueness on Stripe-backed `payments` revenue rows or `payouts` per appointment: concurrent completions/webhooks could double-insert; clawback/retry `.limit(1)` reads assumed one row. | `000_baseline.sql:1616,1628`, check-then-insert writers | **FIXED-A** (migration 088 partial unique indexes + dedupe of existing rows + 23505-aware writers + `duplicate_charge_detected` forensics) |

### HIGH

| # | Finding | Evidence | Status |
|---|---|---|---|
| H1 | `clawbackCleanerPayout` has no `bank_paid` guard (reversing after funds reached the cleaner's bank drives the connected balance negative) and reverses the full `payout.amount` without reading `transfer.amount_reversed` (over-ask after a partial-refund reversal = permanent `cleaner_clawback_failed` retry loop). | `clawback.ts:98-116` | **PHASE B** |
| H2 | `charge.refunded` processed before `payment_intent.succeeded`: reversal no-ops (no transfers yet), settlement then pays cleaner/tenant, never clawed back. Plus the succeeded handler clobbers a `refunded` row back to `paid`. | `dispatchStripeEvent.ts:136-144,614` | **PHASE B** |
| H3 | `refund.updated` -> `failed`/`canceled` updates the `refunds` row only; `payments.status` stays `refunded` forever (money went back to the merchant, UI says refunded). | `dispatchStripeEvent.ts:416-455` | **PHASE B** |
| H4 | `retryFailedPayouts` re-settles with key `cleaner-payout-{id}`; a legacy-path payout used `payout-{id}`, so a retry creates a second transfer (double-pay). | `reconcile.ts:246-272` | **PHASE B** |
| H5 | Silent money-loss states with no notification or ledger: homeowner completion-charge failure, `cancellation_fee_uncollectable`/`failed`, self-pay `no_org_card` (silent 409, no ledger event). | charge/fee orchestrations | **FIXED-A** (`charge_failed`, `cancellation_fee_failed`, `self_pay_no_card`, `cancelled_job_refunded` notification events, deduped via `notification_events.dedupe_key`) |
| H6 | Cancellation-fee idempotency key was fixed `cancelfee-{id}`: a same-day retry replayed the cached decline; a changed fee amount hit a Stripe `idempotency_error`. Thrown declines also wrote no payments row, so nothing marked the attempt spent. | `chargeCancellationFee.ts` | **FIXED-A** (attempt-suffixed key via shared `reauth_count`; failed row persisted on thrown declines) |
| H7 | Complete/cancel race: cancel didn't guard an already-completed/paid appointment, so a completion charge AND a cancellation fee could both land. | `cancel/route.ts:114-120` | **FIXED-A** (paid-completion 409; completed cancel = administrative undo with NO fee; DB trigger forbids `cancelled -> completed/in_progress`; charge-vs-cancel race resolves via the C3 auto-refund) |

### MEDIUM (Phases C-D)

- **M1** reconcile money-math uses `total_price` as gross: false `money_math_violation` for fee-passthrough/self-pay (`reconcile.ts` vs `settleCleanerPayout.ts:86-89`). **PHASE C**
- **M2** cleaner settled at `payout_percent=0` then onboarded later can never be paid; silent (split was conservation-correct; fix = visibility event). **PHASE C**
- **M3** `payout.paid` oldest-unattributed fallback can mark the wrong appointment `bank_paid` (`dispatchStripeEvent.ts` `markOldestUnattributedPayout`). **PHASE C**
- **M4** webhook-driven notifications duplicate on event reprocess. Column + unique index shipped in 088 and ALL new Phase A events use it; wiring the pre-existing call sites (`cleaner_paid`, `dispute_opened`, ...) is **PHASE D**.
- **M5** 100%-to-cleaner job never sets `transfer_amount`, so `settleUnsettledCaptures` re-matches it every sweep (`cleaner_paid` notification spam; no double-pay). **PHASE C**
- **M6** `charge.dispute.funds_reinstated` is a no-op: a cleaner clawed back on a lost dispute that is later won/reinstated is never re-paid. **PHASE C**
- **M7** disputes UI absent: `disputes` is written + bell-notified but nothing reads it; a disputed charge still renders "Paid" (v2's G10). **PHASE D**
- **M8** a `is_self_pay IS NULL` revenue row passes `settleUnsettledCaptures`' `.or()` filter and could be run through the tenant-split path. **PHASE C**
- **M9** saved bank PM + `STRIPE_ACH_ENABLED` off at completion falls through to the card path and throws a generic error instead of a clear `bank_disabled` outcome. **PHASE C**
- **M10** test gaps: the Stripe fake didn't model off-session `requires_action`/declines; no coverage for the cancellation fee, ACH cancel-during-processing, or concurrency. Phase A added per-file mocks + tests for its scope; broadening the shared fake is **PHASE D**.
- Carried over from v2, still deferred by design: G12 (microdeposit/manual bank entry dead-ends), G16/G17 (retryable declines made terminal; no structured decline code), G14-ops (prod webhook missing Connect events), NEW-19 (mandate text relies on Stripe's Payment Element default), NEW-28 (USD hard-coded).

### Verified clean (don't re-file)

- Migrations 086/087 are consistent: no code references the dropped columns; every `authorization_status` write (`captured`/`requires_action`/`failed`/NULL) is valid post-CHECK-drop.
- Bank PMs route correctly to `chargeAchAppointment` from the completion path (an earlier audit pass claimed otherwise; wrong).
- Refund route order (Stripe refund FIRST, reversals after) and the proportional cumulative reversal math in `reverseJobTransfersForRefund` are correct.
- Cleaner held-slice (un-onboarded at settlement) pays the snapshot, not a recompute.
- The webhook claim layer (insert-first idempotency) and the cancel-fee/completion `charge_kind` split survive event replays.

## Phase B-D implementation notes (for the follow-up PRs)

- **Phase B — `fix/clawback-settlement-hardening`** (H1-H4): `bank_paid` guard + `clawback_blocked_bank_paid` event (surface, don't auto-reverse: pulling funds after a bank payout creates unpredictable negative-balance recovery); cap reversals at `transfer.amount - amount_reversed` via `transfers.retrieve`; settle-time `charge.amount_refunded` check in both settle paths + don't clobber `refunded -> paid`; `refund.updated`-failed reverts `payments.status` + `refund_failed` notification; settle repairs (not re-transfers) any retryable payout row already carrying a `stripe_transfer_id` (key-agnostic, covers legacy `payout-{id}` rows) + `.is('stripe_transfer_id', null)` in `retryFailedPayouts`.
- **Phase C — money-correctness mediums** (M1, M2, M3, M5, M6, M8, M9): gross from the payments row (`amount*100 - processing_fee_cents`), self-pay rows validated against `computeSelfPayAmounts`; `cleaner_settled_zero_percent` visibility event; amount-aware payout attribution; stamp `transfer_amount: 0` when the tenant remainder is 0; `funds_reinstated` handler re-transfers the cleaner cut (key `cleaner-reinstate-{id}-{dispute.id}`); self-pay early-return in `settleCleanerPayout`; `bank_disabled` 409.
- **Phase D — observability/UX** (M4 remainder, M7, M10 remainder): `dedupe_key` on the pre-existing webhook notification call sites (keyed on Stripe event id); disputes UI (`useDisputes` hook, "Disputed" badge override, disputes block in PaymentsPage; reuse StatusBadge/section-card, verify with Playwright MCP); extend `tests/helpers/stripe.ts` with magic PM ids (`pm_decline`, `pm_3ds`, `pm_bank`).

## Cutover note

Migration 088 (uniqueness, `charge_kind`, notification dedupe, the status-transition guard) ships
with this branch and applies to dev on push, prod on merge. The cancelled-job auto-refund only
covers PaymentIntents created AFTER this deploy (older PIs lack `charge_kind` metadata; their rows
lack the column value, and `settleUnsettledCaptures` deliberately preserves legacy behavior for
them). The prod webhook event list still needs `refund.updated`, `charge.dispute.funds_reinstated`,
`transfer.reversed`, `payout.paid`, `payout.failed` before cutover (see `docs/stripe-architecture.md`).
