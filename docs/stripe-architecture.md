# Stripe Architecture (Multi-Tenant Marketplace + SaaS)

How payments work in the Nexxus Cleaning Platform after the multi-tenant restructure
(PR #27, Phases 0–5). This is the source-of-truth overview; the implementation lives under
`src/lib/stripe/**`, `src/lib/payments/**`, and `src/app/api/stripe/**`.

> **Rollout note:** the new flow is **flag-gated and not yet the production default**. The
> legacy platform-as-merchant path still runs when the flags are off. See
> [Feature flags & rollout](#feature-flags--rollout-state) and [Cutover](#cutover-still-pending).
>
> ⚠️ **State correction (2026-07-16):** the production Vercel env does NOT match this note —
> `STRIPE_NEW_CHARGE_FLOW_ENABLED` is already `true` in Production while the server
> `STRIPE_TENANT_CONNECT_ENABLED` row is missing there (split-flag state; completion charges
> would fail `tenant_not_ready` for un-onboarded orgs). Observed state, implications, and the
> ordered cutover plan live in `docs/redesign/cutover-runbook.md` — trust that over this note
> until cutover lands.

## Why it changed

The original integration treated the **platform** Stripe account as if it were the single
cleaning company: every homeowner Customer, PaymentIntent, and charge lived on the platform,
and cleaner payouts were platform-balance Transfers. That breaks with a second tenant — the
homeowner's statement reads "NEXXUS", all dispute liability and 1099-K revenue funnel to
Nexxus, and the tenant has no Stripe identity.

The restructure makes the **tenant cleaning company the merchant of record** via per-org Stripe
Express connected accounts, using **separate charges and transfers** (`on_behalf_of` the tenant,
no `transfer_data`) so Nexxus keeps the platform-level homeowner Customer relationship while the
statement descriptor and dispute liability sit with the tenant. Captured funds land on the
**platform** balance and are immediately transferred out to the tenant and cleaner. (A destination
charge can route to only one connected account, and Stripe forbids transfers *between* connected
accounts — so splitting one payment across two accounts must use separate transfers from the
platform, not a destination charge chained to a second transfer.)

## Stripe object model

```
PLATFORM (Nexxus Stripe account)
├── Customer (one per homeowner — reused across every tenant they book with)
│   └── PaymentMethod / SetupIntent / CustomerSession (saved cards; PAN never touches us)
├── Customer (one per ORGANIZATION — SaaS billing; organizations.stripe_customer_id)
│   └── Subscription (the org pays Nexxus — Scenario 3)
├── PaymentIntent (separate charges & transfers; created by platform, settles to the PLATFORM)
│   ├── on_behalf_of = tenant connected account        (merchant of record; statement descriptor)
│   ├── transfer_group = appt_<appointmentId>          (ties the charge to its transfers)
│   ├── (no transfer_data — charged funds stay on the platform until settlement)
│   └── (no capture_method — auto-captures; the charge is created when the job is completed)
├── Transfer × N (platform → connected, created after the charge succeeds) — tenant remainder + cleaner %,
│   each source_transaction = the charge, same transfer_group; platform keeps the fee (0 today)
└── Webhook endpoint (single, STRIPE_WEBHOOK_SECRET) — platform + Connect events

CONNECTED ACCOUNTS (type=express, under the platform)
├── Tenant org account (one per organization) — receives its remainder via a platform Transfer
└── Cleaner account (one per percentage_contractor cleaner) — receives its % via a platform Transfer
```

`organizations.stripe_customer_id` (paying Nexxus) is deliberately **distinct** from
`organizations.stripe_connect_account_id` (receiving homeowner money).

## Money flows

**Scenario 1 — percentage contractor ($100 job, cleaner 80%, fee 0):**
homeowner card → on completion, an auto-capturing PaymentIntent (`on_behalf_of` tenant, no
transfer_data) → **platform** balance +$100 → platform creates two Transfers from its balance (idempotency
`tenant-payout-${appointmentId}` and `cleaner-payout-${appointmentId}`, each `source_transaction`
= the charge): cleaner +$80, tenant +$20. Platform keeps the fee ($0 today).

**Scenario 2 — hourly_external cleaner:** same charge; settlement makes a single platform Transfer
of the whole $100 to the tenant; **no** cleaner Transfer (the tenant pays the cleaner outside the app).

**Scenario 3 — SaaS subscription:** the org's billing Customer is charged on a recurring
Subscription; revenue lands in the platform balance. Backend scaffolding only (no UI in v1).

Split math (`src/lib/stripe/charges/splits.ts`, decision #11): `platformFee = round(gross *
bps/10000)`, `cleaner = floor(gross * payoutPercent/100)`, `tenant = gross − fee − cleaner`.
Cleaner % is of **gross**; the platform fee comes out of the tenant remainder. Invariant:
`fee + cleaner + tenant === gross`. The reconciler re-checks this per paid payout.

## Payment lifecycle

A card is **saved, not held** at booking, and **charged when the job is completed** (there is no
upfront authorization). This avoids tying up the customer's funds before the work is done; the
trade-off (a card can decline after the service is delivered) is handled by the "Payments needing
attention" queue and the reconcile sweep.

1. **Card saved (off-session)** — admin sends a hosted card link, or the homeowner/admin uses the
   CustomerSession Payment Element (`mode: 'setup'`, `usage: 'off_session'`, no hold). Any 3-D
   Secure is completed on-session at save time so the later off-session charge inherits the mandate.
   `appointments.payment_method_id` is set; booking does nothing else to the card.
2. **Charge on completion** — when the job is marked completed, `POST /api/appointments/:id/charge`
   creates an **auto-capturing** PaymentIntent on the saved card (`on_behalf_of` tenant, no
   transfer_data). The assigned cleaner (who completes the job) or org staff may trigger it. The
   `payment_intent.succeeded` webhook marks the payment paid and `settleCleanerPayout` fans the
   charged amount out from the platform balance: the tenant remainder to the tenant account and
   (percentage_contractor only) the cleaner's % to the cleaner account. A bank (ACH) payer is
   debited the same way and sits in `processing` (~4 business days) until it settles.
3. **Charge failure** — a decline or off-session 3-D Secure writes a `failed` revenue row and
   surfaces the appointment in "Payments needing attention" (Fix card / Send card link). Putting a
   working card on charges it under a fresh idempotency key (`reauth_count` bump); the reconcile
   sweep is the backstop.
4. **Cancellation / no-show (decision #10)** — `POST /api/appointments/:id/cancel`. Cleaner /
   on-time cancel → charge $0. Homeowner late-cancel (inside the per-org window) or no-show →
   charge a configurable flat/percent fee to the saved card **off-session** at cancel time
   (idempotency key `cancelfee-{id}`, distinct from the completion charge). The appointment is
   marked cancelled **before** the fee charge so the resulting `payment_intent.succeeded` skips
   cleaner settlement (the fee goes to the tenant). Best-effort: no card on file, a bank-only
   payer, or a decline never blocks the cancellation; self-pay always charges $0.
5. **Refund (decision #7)** — `POST /api/payments/:id/refund`. Reverses every transfer in the
   job's `transfer_group` (tenant remainder + cleaner %) proportionally — clawing the funds back to
   the platform — then refunds the homeowner on the platform PaymentIntent. Only
   `pending`/`succeeded` prior refunds count toward the cap.
6. **Dispute (decision #12)** — `charge.dispute.created` records it against the tenant;
   `charge.dispute.closed` with status `lost` claws back the cleaner Transfer.

## Webhooks, idempotency & reconciliation

- **Single endpoint** `POST /api/stripe/webhook` verifies the signature, then `claimWebhookEvent`
  inserts into `webhook_events` (PK = Stripe event id) **before** acting. Only a `23505`
  unique-conflict on an already-`processed` row is a true duplicate; transient insert errors
  throw → 500 → Stripe retries (never process unclaimed). `dispatchStripeEvent` routes every
  event type to a focused, idempotent handler.
- **Append-only ledger** `payment_events` records every state transition (actor =
  system/webhook/reconciler/user:<id>).
- **Reconciliation sweep** `POST /api/cron/reconcile-payments` (migration 067, every 15 min) is
  the correctness backstop — DB state never depends on a single webhook delivery. Four jobs:
  dead-letter retry (re-dispatch stuck `webhook_events`), stuck-payment reconcile (replay the
  true Stripe PI status for pending payments past SLA), failed-payout retry, and the money-math
  invariant check.

## Feature flags & rollout state

`src/lib/stripe/flags.ts` (server flag + `NEXT_PUBLIC_*` client mirror, all default **off**):

| Flag | Gates |
|---|---|
| `STRIPE_ENABLED` | All server Stripe access (`getStripe()` throws when off). |
| `STRIPE_TENANT_CONNECT_ENABLED` | Tenant Connect onboarding + tenant-routed charges. |
| `STRIPE_NEW_CHARGE_FLOW_ENABLED` | New save-card-at-booking / charge-at-completion / cancel / refund routes. |

The new flow is **built, tested, and merged behind these flags** (migrations 065 + 067, with the
JIT-authorizer cron 066 retired by 086 and the now-dead hold columns retired by 087). With the flags
off, the **legacy** platform-as-merchant charge path still runs, so nothing changes in production
until the cutover.

## Cutover (still pending)

Phase 6 — the actual production cutover — is intentionally **not** automated. It is an ops
decision with prerequisites:

1. Onboard the real tenant(s) via embedded Connect onboarding; confirm `charges_enabled`.
2. Add the missing **production** webhook events: `transfer.reversed`, `payout.paid`,
   `payout.failed` (plus the subscription/dispute/refund events) in the live-mode Stripe
   Dashboard.
3. Flip `STRIPE_TENANT_CONNECT_ENABLED` and `STRIPE_NEW_CHARGE_FLOW_ENABLED` **on in prod**
   (Vercel env), draining any in-flight legacy appointments first.
4. Only then remove the legacy platform-only charge path in `create-payment-intent` (it is the
   current prod default — removing it before the flag flip would break production payments).

## Key files

- Charges: `src/lib/stripe/charges/{splits,charge,chargeSelfPay,chargeAch,chargeSelfPayAch,refund}.ts`
- Connect: `src/lib/stripe/connect/tenant.ts`; transfers: `src/lib/stripe/transfers.ts`
- Customers/billing: `src/lib/stripe/customers/homeowner.ts`, `src/lib/stripe/billing.ts`,
  `src/lib/payments/orgBilling.ts`
- Webhook: `src/app/api/stripe/webhook/route.ts` + `src/lib/payments/dispatchStripeEvent.ts`
  + `src/lib/payments/webhookIdempotency.ts`
- Reconciliation: `src/lib/payments/reconcile.ts`, `src/lib/stripe/reconcile.ts`,
  `src/lib/payments/moneyMath.ts`
- Charge orchestration: `src/lib/payments/chargeCompletedAppointment.ts`,
  `src/lib/payments/chargeCancellationFee.ts`, `src/lib/payments/cancellationFee.ts`
- Settlement: `src/lib/payments/settleCleanerPayout.ts`, `src/lib/payments/settleSelfPay.ts`
- Schema: `supabase/migrations/065_stripe_restructure.sql` (+ 067 reconcile cron; 086 drops the
  retired JIT cron, 087 retires the hold columns)
