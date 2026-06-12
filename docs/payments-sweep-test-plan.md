# Payments edge-case sweep: behavior map, weak spots, and manual test plan

> **OBSOLETE for the card flow (charge-at-completion update).** Written when cards were HELD at
> booking (JIT-authorize) and captured on completion. That hold flow was removed: a card is now SAVED
> at booking and CHARGED when the job is completed (no authorize / capture / `requires_capture`). The
> hold/authorize/capture/cancel-authorization scenarios below (A6-A10, A22-A24, etc.) no longer apply.
> See `docs/stripe-architecture.md` for the current model.

Audience: you, running a manual sweep against the **preview / `dev`** deployment in Stripe **test mode**.
Scope: both flows (homeowner-pays destination-charge, org self-pay) across both rails (card, ACH/`us_bank_account`), every success / failure / async outcome.

You said the immediate-success card and bank already work. This doc therefore focuses on **everything else**: declines, 3DS/SCA, ACH returns, disputes, capture/cancel/refund failures, payout failures, and the async edge cases. Every claim is backed by a `file:line` reference so you can confirm.

**This is analysis only. No code was changed.** Items marked **GAP** are unhandled or weakly-handled paths I recommend you confirm during the sweep and then decide whether to fix before go-live.

---

## 0. TL;DR (the weak spots, ranked)

| # | Severity | Weak spot | Where | Effect |
|---|----------|-----------|-------|--------|
| G1 | 🔴 CRITICAL | **Off-session 3DS/SCA hold is a dead-end and the UI reports it as success.** No client `handleNextAction`/`confirmCardPayment` exists anywhere. | `authorizeAppointment.ts:210-272`, `authorizeSelfPayAppointment.ts:195-228`, UI `AddAppointmentModal.tsx:1245` | Card needing authentication is never charged; booker sees a success toast; row stuck `pending`+`requires_action`; reconcile can't fix it. |
| G2 | 🔴 CRITICAL | **No clawback when an ACH debit returns after it already settled.** Settlement already paid the cleaner (and tenant); nothing reverses it. `charge.failed` isn't even in the dispatcher. | `dispatchStripeEvent.ts:263-306`; `charge.failed` absent from switch `:27-84` | Platform goes negative by the cleaner's cut on every late ACH return (R01/R02/R03/R29). |
| G3 | 🔴 HIGH | **`/api/payouts/approve` is an unauthenticated MOCK still wired to the admin "Approve" button.** Writes a fake `tr_mock_...` id, no real transfer, no auth check. | `api/payouts/approve/route.ts:50-67`, `PaymentsPage.tsx:674` | Anyone who can POST flips a payout to "approved" with no money moving. Mostly legacy/`record`-created pending rows in the new flow, but it's a live unauthenticated money-state endpoint. |
| G4 | 🔴 HIGH | **ACH stuck in `processing` has no reconcile backstop.** The sweep only scans `status='pending'`, never `'processing'`. | `reconcile.ts:91-101` (`.eq('status','pending')`) | If the terminal ACH webhook is lost, the charge sits `processing` forever; cleaner never paid, homeowner never confirmed. |
| G5 | 🔴 HIGH | **Refund reverses the cleaner/tenant transfers BEFORE creating the refund, with no rollback if the refund then fails.** | `payments/[paymentId]/refund/route.ts:119-166` | On a refund failure (502), cleaner/tenant are clawed back but the homeowner is not refunded → inconsistent money state. |
| G6 | 🔴 HIGH | **Plain refund after the cleaner was paid does NOT claw back the payout.** Only a *lost dispute* claws back. | `dispatchStripeEvent.ts:484-517` (no reversal) | Refund a settled job → cleaner keeps their cut → platform/tenant eats it. |
| G7 | 🟠 HIGH | **`charge.dispute.created` for a charge with no matching `payments` row is silently dropped forever** (no insert, no notification, no retry sweep). | `dispatchStripeEvent.ts:533-536` | A dispute we can't map is never recorded or surfaced. |
| G8 | 🟠 HIGH (UX) | **`processing` (ACH in-flight) renders as "Unpaid" to admin & homeowner.** Status is unmapped in the card/badge renderers. | `AppointmentCard.tsx:187-221`, `PaymentStatusBadge.tsx`, `PaymentsPage.tsx:462` | Admin sees a just-booked ACH job as "Unpaid" with no "clearing" signal. Only the cleaner Earnings tab handles it. |
| G9 | 🟠 MEDIUM | **No card-hold indicator on any appointment card. `AuthHoldBadge` + `PaymentStatusBadge` are built but rendered nowhere (dead code).** | `AuthHoldBadge.tsx` (0 imports), `AppointmentCard.tsx:37-45` (field unused) | No at-a-glance "Card held / Authorizing / Action needed / Auth failed" anywhere; only the "Needs attention" panel shows failed/requires_action. |
| G10 | 🟠 MEDIUM | **Disputes/chargebacks have no UI surface at all** (only a notification). Disputed payments keep showing "paid". | `useAdminData.ts:594-598` subscribes but nothing renders | Ops can't see a disputed payment in the payments UI. |
| G11 | 🟠 MEDIUM | **Un-onboarded cleaner's share silently folds into the tenant remainder** (homeowner flow). No held/queued payout for the cleaner. | `settleCleanerPayout.ts:108-114`, `splits.ts:52-53` | If a cleaner isn't Connect-ready at settlement, their cut goes to the tenant, not held for them. (Self-pay is safer: pays no one, logs `cleaner_not_payable_at_settlement`.) |
| G12 | 🟠 MEDIUM | **Microdeposit / manual bank-entry verification is unfinished.** Only Financial Connections *instant* verification can complete in-app; `confirm-setup-intent` hard-rejects any non-`succeeded` SetupIntent. | `confirm-setup-intent/route.ts:45`; no `microdeposit`/`verify_with_microdeposits` code anywhere | A bank that needs the two-deposit verification can't be saved in-app. |
| G13 | 🟠 MEDIUM | **`setup_intent.setup_failed` is not handled** → a failed card-collection link stays `pending` forever with no failure signal. | dispatcher handles only `setup_intent.succeeded` `:40-42` | Admin UI shows perpetual "waiting for card." |
| G14 | 🟠 MEDIUM (ops) | **Prod is missing 3 Connect webhook events** (`payout.paid`, `payout.failed`, `transfer.reversed`) AND `reconcile-payouts` has no cron (user-triggered only). | CLAUDE.md; `dispatchStripeEvent.ts:760/866/699` need `event.account`; `connect/reconcile-payouts/route.ts:19-30` | In prod, `bank_paid` only flips when a cleaner opens their Earnings page. Verify the **preview** endpoint subscribes to Connect events. |
| G15 | 🟡 MEDIUM | **Missing idempotency keys** on refund, cancel, SetupIntent-create, and legacy PaymentIntent-create. Refund route has no in-flight DB lock either. | `charges/refund.ts:21-28`, `charges/cancel.ts:9-14`, `stripe.ts:103-127`/`:130-158` | Concurrent double-submit refund can double-refund up to the cap. |
| G16 | 🟡 LOW | **Transient `processing_error` declines are made terminal `failed`** with no retry/backoff. | `authorizeAppointment.ts:142-207` | A retryable decline is treated like a hard decline. |
| G17 | 🟡 LOW | **Decline reason (`decline_code`) not surfaced in the new flow** (only generic message). Legacy route surfaced it. | `authorizeAppointment.ts:207` vs `create-payment-intent/route.ts:133-143` | Admin can't tell `insufficient_funds` (retry) from `lost_card` (new card needed). |
| G18 | 🟡 LOW | **`payout.canceled` not handled** (only `payout.failed` reverts `bank_paid`). | dispatcher | A Stripe-canceled (not failed) payout leaves a row falsely `bank_paid`. |
| G19 | 🟡 LOW | **No `radar.early_fraud_warning` / `review.opened` handling.** | dispatcher default no-op | No early signal before a chargeback + fee hits the tenant. |

**Good news / corrections to prior assumptions:**
- ✅ The old **"Cannot create transfers between connected accounts"** bug is **FIXED**, not latent. All current paths use separate-charges-and-transfers: the charge lands on the **platform** balance (with `on_behalf_of: tenant`), then `createPlatformTransfer` fans out platform→connected with **no** `stripeAccount` header (`transfers.ts:1-51`). (Project memory `connected_transfer_constraint` is now stale.)
- ✅ Card declines, capture failures, hold release, partial-capture cancellation fee, full/partial refund, refund-status webhooks, dispute-*lost* clawback, authorization expiry re-auth, and webhook idempotency/out-of-order are all **handled well**.
- ✅ The cleaner "Awaiting customer payment / Clearing" ACH section **does exist** (`cleaner-dashboard/page.tsx:1641-1681`) despite memory calling it a follow-up.
- ✅ Stripe decline reasons **are** surfaced on add-card and on the hard-decline authorize path (not swallowed), and the 504-timeout-vs-decline handling in `AddAppointmentModal.tsx:1218-1286` is well done.

---

## 1. Preview environment prerequisites (do this first or the sweep is meaningless)

These are **Vercel Preview env vars** and **Stripe Dashboard / dev-Supabase state** that cannot be read from the repo. Confirm each before testing.

### 1a. Flags (Vercel → Project → Settings → Environment Variables → **Preview**)
All must be the string `"true"`. Each `NEXT_PUBLIC_*` must match its server twin or the UI offers actions the server 404s.

| Server | Client mirror | Needed for |
|--------|---------------|-----------|
| `STRIPE_ENABLED` | `NEXT_PUBLIC_STRIPE_ENABLED` | everything (master switch; `getStripe()` throws without it) |
| `STRIPE_TENANT_CONNECT_ENABLED` | `NEXT_PUBLIC_STRIPE_TENANT_CONNECT_ENABLED` | tenant onboarding; **without an onboarded `charges_enabled` org every charge returns `tenant_not_ready`** |
| `STRIPE_NEW_CHARGE_FLOW_ENABLED` | `NEXT_PUBLIC_STRIPE_NEW_CHARGE_FLOW_ENABLED` | authorize/capture/cancel/refund routes (all 404 without it) |
| `STRIPE_SELF_PAY_ENABLED` | `NEXT_PUBLIC_STRIPE_SELF_PAY_ENABLED` | self-pay (depends on new-charge-flow) |
| `STRIPE_ACH_ENABLED` | `NEXT_PUBLIC_STRIPE_ACH_ENABLED` | bank/ACH (depends on new-charge-flow + fee-passthrough) |
| `STRIPE_FEE_PASSTHROUGH_ENABLED` | `NEXT_PUBLIC_STRIPE_FEE_PASSTHROUGH_ENABLED` | payer-funded processing fee + grossed-up amounts (without it the platform absorbs the fee) |

Dangerous combinations to avoid (each produces a half-broken state): new-charge-flow ON + tenant-connect OFF (no onboarded merchant → `tenant_not_ready`); self-pay ON + new-charge-flow OFF (self-pay UI shows, routes 404); ACH ON + new-charge-flow OFF (bank option shows, never charges); any `NEXT_PUBLIC_*` ON while its server twin is OFF.

### 1b. Keys / secrets (test mode)
`STRIPE_SECRET_KEY=sk_test_...`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_...` (the dev-branch test webhook), `CRON_SECRET` (+ Postgres `app.cron_secret` / `app.api_base_url`). `STRIPE_CONNECT_WEBHOOK_SECRET` only if Connect events come from a **separate** Dashboard endpoint (`webhook/route.ts:26-31` accepts a second secret; verification loops both).

### 1c. Stripe Dashboard webhook subscription (test mode)
The preview endpoint must subscribe to, at minimum:
`payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.processing` (**ACH `processing` transition breaks without it**), `payment_intent.canceled`, `setup_intent.succeeded`, `charge.refunded`, `refund.updated`, `charge.dispute.created`, `charge.dispute.closed`, and the **Connect** events `account.updated`, `payout.paid`, `payout.failed`, `transfer.reversed`.
Also verify the endpoint's **API version** matches the SDK pin `2025-12-15.clover` (`stripe.ts:23`) — an older endpoint sends the legacy `charge.refund.updated` (unhandled) instead of `refund.updated`.

### 1d. Data (dev Supabase, ref `suaezjtspglgulunkyip`)
- Test org must have `stripe_connect_account_id` + `stripe_connect_charges_enabled=true` (both flows require it; self-pay also needs `stripe_self_pay_customer_id` + a saved company card).
- Assigned cleaner must be Connect-onboarded (`stripe_connect_onboarding_complete=true`) with `payout_percent > 0` (the self-pay charge amount derives from it).
- Memory note: dev "Default Organization" is already onboarded with live charges, but reverify.

### 1e. Local Stripe CLI (for the events test mode can't produce on its own)
Some gaps (post-settlement ACH return, lost webhooks, dispute-with-no-payment) are easiest to exercise by replaying/crafting events. Have `stripe listen --forward-to <preview-url>/api/stripe/webhook` and `stripe trigger ...` ready, or use Dashboard → Webhooks → "Resend".

---

## 2. The model in one screen (so the expected states are unambiguous)

**Flow selection** is an explicit booking choice persisted as `appointments.is_self_pay` (not derived). Runtime fork: `authorizeDispatch.ts:25-33`. Settlement fork (webhook): `metadata.self_pay==='true'` → `settleSelfPay`; else `on_behalf_of` present → `settleCleanerPayout`; else legacy.

**Rail selection** is by the saved PaymentMethod's type (`getPaymentMethodType`). Card → authorize-then-capture (manual-capture hold). ACH → **no hold**; `authorize` returns `deferred_ach`; the debit is created at job completion (`capture` route) and goes `processing` → `paid`/`failed`.

**`payments.status` enum** = `pending | processing | paid | failed | refunded` (migration 082). There is **no** `authorizing`/`requires_action`/`canceled`/`disputed`/`bank_paid` on `payments.status` — those live on `appointments.authorization_status`, `payments.payment_intent_status` (free text), the `disputes` table, and `payouts.status`.

```
CARD (homeowner):  book → authorize → payments.pending (PI requires_capture, appt authorization_status=authorized)
                   → complete → capture → payments.PAID (authorization_status=captured)
                   → payment_intent.succeeded → settleCleanerPayout → payouts paid → (payout.paid) → bank_paid
ACH  (homeowner):  book → authorize returns deferred_ach (no hold, no row)
                   → complete → chargeAch → payments.PROCESSING → succeeded → payments.PAID + settle
FAILURE BRANCHES:  authorize decline → payments.FAILED + authorization_status=failed → JIT cron re-auths
                   capture fail → payments.FAILED + authorization_status=failed
                   cancel (no fee) → release hold → payment_intent_status=canceled, authorization_status=canceled
                   cancel (late/no-show) → partial capture of fee → payments.PAID (amount=feeCents)
                   full refund → payments.REFUNDED ; partial → stays PAID + refunds row
                   ACH return → payment_intent.payment_failed → payments.FAILED (self-pay also notifies)
```
`appointments.authorization_status` CHECK = `none | scheduled | authorizing | requires_action | authorized | captured | canceled | failed`.

---

## 3. Manual sweep test matrix

Legend: **Status** = expected handling. ✅ works · ⚠️ partial/confirm · ❌ **GAP** (confirm the bad behavior; it's a known weak spot).
Run each for **both** flows where noted. Watch three places: the **app UI**, the **Stripe Dashboard** (Payments / Connect / Events), and (optionally) the **`payments`/`payouts`/`payment_events` rows** in dev Supabase.

### Part A — Card edge cases (homeowner + self-pay)

> Self-pay differences: amount is the cleaner cut grossed-up; no `on_behalf_of`; `metadata.self_pay='true'`; settlement is a single platform→cleaner transfer; on failure it also fires an `authorization_failed` admin notification. Otherwise the paths mirror each other.

| ID | Scenario | Test trigger | Steps | Expect (UI) | Expect (Stripe/DB) | Status |
|----|----------|-------------|-------|-------------|--------------------|--------|
| A1 | Generic decline at authorize | card `4000000000000002` | Save card, book a job (or accept → JIT auth) | Red inline "card hold didn't go through: …", modal stays open | PI fails; `payments.status='failed'`, `authorization_status='failed'`; `payment_events: authorize_failed`; notif `authorization_failed` | ✅ |
| A2 | Insufficient funds | `4000000000009995` | as A1 | Same red error | `failed`; **decline_code not shown in UI** (G17) | ✅ / ⚠️ G17 |
| A3 | Lost / stolen / expired / incorrect-CVC | `4000000000009987` / `…9979` / `4000000000000069` / `4000000000000127` (send any CVC) | as A1 | Same red error | `failed` (treated as generic) | ✅ |
| A4 | Processing error (retryable) | `4000000000000119` | as A1 | Same red error | `failed` — **made terminal, no auto-retry** | ⚠️ **G16** |
| A5 | Radar-blocked / fraudulent | `4100000000000019` | as A1 | Same red error | `failed` | ✅ |
| A6 | **3DS/SCA required on the HOLD (off-session)** | card `4000002760003184` ("always authenticate") | Save it, then book/accept so the JIT authorize runs off-session | **Booker sees a SUCCESS toast** (bug) | PI → `requires_action`; `payments.status='pending'`, `payment_intent_status='requires_action'`, `authorization_status='requires_action'`; **no customer auth prompt; never captures; reconcile can't fix; "Re-authorize" loops back to requires_action** | ❌ **G1 (CRITICAL)** |
| A7 | 3DS/SCA on SAVE-CARD (not the hold) | card `4000002500003155` | Add a card via the add-card panel | Stripe 3DS modal pops (`confirmSetup redirect:if_required`), card saves | SetupIntent `succeeded`, PM attached | ✅ |
| A8 | Capture after the hold expired/canceled | authorize, then cancel the PI in Stripe (or wait), then complete the job | Complete job to trigger capture | Cleaner sees `paymentStatus:'failed'` but **job still completes** | `payments.status='failed'`, `authorization_status='failed'`; 502 to caller | ✅ (non-fatal) |
| A9 | Cancel / release hold (on-time) | authorize a job, then cancel it on-time | Cancel appointment | Hold released | `paymentIntents.cancel`; `authorization_status='canceled'`, `payment_intent_status='canceled'`, `payments.status` stays `pending`; `payment_events: authorization_canceled` | ✅ |
| A10 | Cancel with late/no-show **fee** (partial capture) | authorize, then cancel as late/no-show | Cancel with fee | Fee charged, rest released | partial `capture` of feeCents; `payments.status='paid'` (amount=fee), `authorization_status='captured'` | ✅ |
| A11 | Full refund | a captured/paid card job | Payments → Refund (full) | "Refunded" | transfers reversed proportionally **first**, then refund; `payments.status='refunded'`; `refunds` row pending→succeeded (webhook) | ✅ but see A13/A14 |
| A12 | Partial refund | paid card job | Refund a partial amount | stays "Paid" + refund recorded | proportional transfer reversal; `payments.status` stays `paid`; cap enforced (over-cap → 400) | ✅ |
| A13 | **Refund AFTER cleaner was paid** | paid+settled card job (payout exists) | Issue a full refund | "Refunded" | **cleaner payout is NOT clawed back on a plain refund** (only the proportional transfer reversal the refund route does at `:119-150` runs; if a payout row was already `paid`/`bank_paid` confirm whether the reversal actually unwinds it) | ❌ **G6 — verify the cleaner keeps funds** |
| A14 | **Refund that fails at Stripe after reversals ran** | force `refunds.create` to throw (e.g. refund an already-refunded charge via API race, or simulate) | attempt refund | 502 "Refund failed" | **transfers already reversed but homeowner NOT refunded** → inconsistent | ❌ **G5** |
| A15 | Double-submit refund | click Refund twice fast / two tabs | rapid double POST | — | **no in-flight lock + no idempotency key** → can double-refund up to cap | ❌ **G15 — confirm** |
| A16 | Double-submit authorize / capture | rapid double-click | — | idempotent | authorize key `auth-<id>-<n>`, capture key `capture-<pi>` + DB guards (`alreadyCaptured`) | ✅ |
| A17 | Authorization expiry → auto re-auth | leave a hold ~6 days (or set `authorize_at`/age in dev) and run `cron/authorize-due` | n/a (cron) | invisible | stale hold canceled, fresh hold placed, `reauth_count++`; Stripe `payment_intent.canceled` also reschedules | ✅ |
| A18 | **Card → succeeds then DISPUTED (chargeback)** | card `4000000000000259` (fraudulent) | Pay+capture a job, let it settle, then the dispute auto-opens | **No disputed badge anywhere; payment still shows "Paid"** | `charge.dispute.created` → `disputes` row + `dispute_opened` notif; on `closed=lost` → `reversePlatformTransfer` claws back cleaner, `payouts.status='reversed'` | ⚠️ **G10 (no UI)**, ✅ clawback |
| A19 | Dispute on a charge with **no matching payment** | Stripe CLI: craft/resend `charge.dispute.created` for an unknown charge | replay event | nothing | **silently dropped — no row, no notif, no retry** | ❌ **G7** |
| A20 | Early fraud warning | card `4000000000005423` | pay a job | nothing | `radar.early_fraud_warning` unhandled (default no-op) | ⚠️ **G19** |
| A21 | Card-collection link fails to set up | open a card-collection link, use a declining card on the hosted page | — | link stays "pending" forever | **`setup_intent.setup_failed` unhandled** → `homeowner_payment_links` never closes | ❌ **G13** |

### Part B — ACH / bank edge cases (homeowner + self-pay)

> ACH has **no hold**. The debit is created at **job completion** and is **asynchronous** (`processing` → `paid`/`failed`). Use the test **account/routing** numbers in the bank-entry form, or the `pm_usBankAccount_*` token via API. Routing for all: `110000000`.

| ID | Scenario | Test trigger | Steps | Expect (UI) | Expect (Stripe/DB) | Status |
|----|----------|-------------|-------|-------------|--------------------|--------|
| B1 | Bank save via Financial Connections (instant) | FC test institution **"Test (Non-OAuth)"** → pick a test account | Add bank in the add-method panel | Bank appears in picker | SetupIntent `succeeded`, `us_bank_account` PM attached | ✅ |
| B2 | Authorize a bank job (defer) | any saved bank | Book/accept a bank job | "Bank account will be charged when the job is completed" toast | `authorize` returns `deferred_ach` (HTTP 200); **no hold, no `payments` row, `authorization_status` untouched** | ✅ |
| B3 | ACH charge at completion → clearing | bank acct `000123456789` (`pm_usBankAccount_success`) | Complete the job | Payer: one-time toast. **Cleaner Earnings: "Awaiting customer payment / Clearing"**. **Admin/homeowner: shows "Unpaid"** | `payments.status='processing'`, `payment_method='ach'`; `payment_events: ach_charge_initiated` | ✅ charge, ✅ cleaner UI, ❌ **G8 admin/homeowner UI** |
| B4 | ACH settles | (B3 then) let it settle / `stripe trigger payment_intent.succeeded` for that PI | wait | cleaner moves to payout history | `payments.status='paid'`; settlement runs (transfers) | ✅ |
| B5 | Insufficient funds | acct `000222222227` | complete job | "Awaiting" then drops to failed | PI `processing` → `failed`; `payments.status='failed'`; self-pay fires `authorization_failed` notif, **homeowner fires none and leaves `authorization_status` untouched** | ⚠️ (handled; homeowner gets no alert) |
| B6 | Account closed | acct `000111111113` | complete job | as B5 | `failed` (R02-class) | ⚠️ |
| B7 | No account found | acct `000111111116` | complete job | as B5 | `failed` (R03-class) | ⚠️ |
| B8 | Debits not authorized | acct `000333333335` | complete job | as B5 | `failed` (R29-class) | ⚠️ |
| B9 | Radar high-risk block | acct `000000004954` | complete job | as B5 | blocked/`failed` | ✅ |
| B10 | **Stuck in `processing` forever (lost terminal webhook)** | acct `000000000009` (`pm_usBankAccount_processing`) **or** B3 but don't forward the succeeded event | complete job, wait past 15 min, run `cron/reconcile-payments` | Cleaner stuck on "Clearing" indefinitely; admin "Unpaid" | **reconcile only scans `status='pending'`, ignores `processing` → never repaired** | ❌ **G4** |
| B11 | **ACH succeeds, cleaner paid, then RETURNS** | acct `000555555559` (`pm_usBankAccount_dispute`) for the dispute variant; for a pure return, CLI-resend `payment_intent.payment_failed`/`charge.failed` against the settled PI | settle (cleaner paid) → then the dispute/return fires | dispute: no UI (G10); pure return: payment flips "failed" with funds already gone | dispute-lost → clawback (✅). **Pure ACH return → `payments.status='failed'` but NO transfer reversal; `charge.failed` not in dispatcher** | ❌ **G2 (CRITICAL) for pure return**; ✅ for dispute path |
| B12 | Manual bank entry needing **microdeposit** verification | acct `000666666661` (`pm_usBankAccount_failMicrodeposits`) or any manual-entry path that doesn't instant-verify | try to add bank via manual entry | **No "verify your 2 deposits" UI; can't complete in-app** | `confirm-setup-intent` rejects non-`succeeded` SI (`:45`); no microdeposit handling exists | ❌ **G12** |
| B13 | Abandoned FC flow | open FC modal, close it | — | stays on form, save blocked | nothing saved (benign) | ✅ |
| B14 | Self-pay ACH timing safety | self-pay bank job | complete job | cleaner not paid until funds settle | transfer waits for `payment_intent.succeeded`; not premature | ✅ (but B11/G2 return-clawback gap still applies) |
| B15 | ACH processing-fee correctness | any bank job with fee-passthrough ON | book | fee line shows bank rate | `processingFee.ts:32` = 0.8%, no fixed, cap $5; `$0` and huge amounts handled | ✅ |

### Part C — Payout / Connect leg

| ID | Scenario | Test trigger | Steps | Expect | Status |
|----|----------|-------------|-------|--------|--------|
| C1 | Cleaner NOT Connect-onboarded at settlement | assign a cleaner with `stripe_connect_onboarding_complete=false`, pay+settle a **homeowner** job | complete + settle | **Cleaner's cut folds into the tenant remainder; no payout row, nothing held for the cleaner** | ❌ **G11** |
| C1b | same, **self-pay** | self-pay job, un-onboarded cleaner | complete + settle | no one paid; `payment_events: cleaner_not_payable_at_settlement` (safer) | ⚠️ by design |
| C2 | Tenant transfer fails mid-settlement | force tenant transfer error | settle | cleaner NOT paid (correct order); `payment_events: tenant_transfer_failed`; recovered by `settleUnsettledCaptures` sweep | ✅ |
| C3 | Cleaner transfer fails | force cleaner transfer error | settle | `payouts.status='failed'`; retried every 15 min by `retryFailedPayouts` (idempotent) | ✅ |
| C4 | `payout.paid` → `bank_paid` | ensure Connect events subscribed; let a connected-account payout pay out (or `stripe trigger payout.paid` with `event.account`) | wait | matching `payouts` → `bank_paid` (+`stripe_payout_id`); `cleaner_paid` notif; falls back to oldest-unattributed if txns unresolved | ✅ **if** Connect endpoint configured (else handler early-returns on missing `event.account`) → **G14** |
| C5 | `payout.failed` | `stripe trigger payout.failed` (with `event.account`) | — | row reverts `bank_paid`→`paid`, clears `stripe_payout_id` | ✅ if subscribed (**G14** in prod) |
| C6 | `transfer.reversed` | `stripe trigger transfer.reversed` | — | `payouts.status='reversed'` | ✅ if subscribed (**G14** in prod) |
| C7 | `payout.canceled` (not failed) | `stripe trigger payout.canceled` | — | **not handled** → row stays falsely `bank_paid` | ⚠️ **G18** |
| C8 | **"Approve" payout button** | admin Payments → a `pending` payout → Approve | click | **writes fake `tr_mock_...`, NO real transfer, NO auth check** | ❌ **G3 — confirm no money moves; decide to remove/replace** |
| C9 | Failed clawback not retried | force `reversePlatformTransfer` to fail on a lost dispute | dispute lost | `payment_events: cleaner_clawback_failed` but **no sweep retries it** | ⚠️ (part of G2/clawback) |
| C10 | Reconcile money-math check | run `cron/reconcile-payments` | n/a | mismatches only **flagged** (`money_math_violation`), not corrected | ⚠️ informational |

### Part D — Webhook / idempotency

| ID | Scenario | Test trigger | Expect | Status |
|----|----------|-------------|--------|--------|
| D1 | Duplicate event | Dashboard "Resend" any processed event | de-duped (`23505` on `processed` row) → skipped | ✅ |
| D2 | Out-of-order: `processing` after `paid` | resend `payment_intent.processing` after `succeeded` | no regression (guarded `.in(['pending','processing'])`) | ✅ |
| D3 | `succeeded` before the row exists | race | falls back to appointment_id+pending match; reconcile recovers | ✅ |
| D4 | Wrong-secret / test-vs-live event | send a live event to the test endpoint | signature fails for both secrets → 400, dropped (expected) | ✅ |
| D5 | `markWebhookProcessed` DB failure | simulate | throws → 500 → Stripe retries → re-claim → idempotent re-run | ✅ |
| D6 | Connect event missing `event.account` | unconfigured Connect endpoint | `payout.paid/failed` early-return, mark nothing | ⚠️ **G14** |

---

## 4. Stripe-side verification checklist (do this in the Dashboard during the sweep)

For each scenario also confirm on Stripe's end (test mode):
- **Payments tab**: PaymentIntent status matches DB (`requires_capture` for a live card hold, `processing` for ACH, `succeeded` after capture/settle, `canceled` after release). Amount captured = expected (base, or grossed-up if fee-passthrough on).
- **Charge**: `on_behalf_of` = tenant account on homeowner charges; **absent** on self-pay. `transfer_group = appt_<id>`.
- **Connect → Transfers**: after settlement, a platform→tenant transfer (`tenant-payout-<id>`) and a platform→cleaner transfer (`cleaner-payout-<id>`, or `selfpay-cleaner-<id>`). Confirm amounts: cleaner = % of **gross**; self-pay cleaner = exact cut (gross-up overshoot stays on platform).
- **Connect → connected account → Payouts**: bank payout appears (automatic schedule); confirm the `payout.paid` event fired and `bank_paid` flipped.
- **Events / Webhooks**: every expected event shows **200** delivery. Look for any event sitting in `default` (unhandled) in your logs — especially `charge.failed`, `setup_intent.setup_failed`, `payout.canceled`, `radar.early_fraud_warning`.
- **Refunds**: refund object present; for a settled job, check whether transfer **reversals** were created (they will be) and whether the **cleaner payout** was actually unwound (G6 — likely not for a plain refund).
- **Idempotency**: in the Developers → Logs, confirm retried operations reused keys (authorize/capture/transfers) and that refund/cancel did **not** (G15).

---

## 5. Suggested run order (most efficient sweep)

1. **Confirm 1a–1e prerequisites.** Without an onboarded tenant + Connect webhook, most rows are untestable.
2. **Card declines A1–A5** (fast, same setup, just swap the card).
3. **A6 (3DS hold)** — the headline CRITICAL. Confirm the false success toast + stuck row.
4. **A7** (3DS save works) for contrast.
5. **Hold lifecycle A9, A10, A16, A17.**
6. **Refunds A11–A15** including the after-payout (G6) and fail-after-reversal (G5) and double-submit (G15).
7. **Disputes A18, A19, A20.**
8. **ACH B1–B9** (collection + each charge-time failure).
9. **B10 (stuck processing, G4)** and **B11 (post-settlement return, G2)** — the two ACH criticals; needs CLI resend.
10. **B12 (microdeposit, G12).**
11. **Payout leg C1–C8**, especially **C8 (the mock approve route, G3)** and **C1 (cleaner-share-to-tenant, G11)**.
12. **Webhook D1–D6** (mostly CLI/Dashboard resends).
13. Repeat the card + ACH core (A1, A6, A9, A11, B3, B5, B11) under the **self-pay** flow to confirm the parallel paths and the self-pay-only `authorization_failed` notification.

---

## Appendix — test trigger reference (verified against current Stripe docs, June 2026)

**Cards** (`docs.stripe.com/testing`):

| Purpose | Number |
|--------|--------|
| Success | `4242424242424242` |
| Generic decline | `4000000000000002` |
| Insufficient funds | `4000000000009995` |
| Lost card | `4000000000009987` |
| Stolen card | `4000000000009979` |
| Expired card | `4000000000000069` |
| Incorrect CVC (send any CVC) | `4000000000000127` |
| Processing error (retryable) | `4000000000000119` |
| Radar fraud block | `4100000000000019` |
| **Always authenticate (off-session → `authentication_required`)** | `4000002760003184` |
| Authenticate unless set up | `4000002500003155` |
| Already set up (off-session succeeds) | `4000003800000446` |
| 3DS required, then declined | `4000008400001629` |
| Dispute: fraudulent | `4000000000000259` |
| Dispute: not received | `4000000000002685` |
| Inquiry | `4000000000001976` |
| Early fraud warning | `4000000000005423` |

**ACH / `us_bank_account`** (routing `110000000` for all; `docs.stripe.com/payments/ach-direct-debit`):

| Account # | Token | Behavior |
|-----------|-------|----------|
| `000123456789` | `pm_usBankAccount_success` | succeeds |
| `000111111113` | `pm_usBankAccount_accountClosed` | fails: account closed |
| `000111111116` | `pm_usBankAccount_noAccount` | fails: no account |
| `000222222227` | `pm_usBankAccount_insufficientFunds` | fails: insufficient funds |
| `000333333335` | `pm_usBankAccount_debitNotAuthorized` | fails: debits not authorized |
| `000000004954` | `pm_usBankAccount_riskLevelHighest` | Radar-blocked |
| `000444444440` | `pm_usBankAccount_invalidCurrency` | fails: invalid currency |
| `000666666661` | `pm_usBankAccount_failMicrodeposits` | fails to send microdeposits |
| `000555555559` | `pm_usBankAccount_dispute` | succeeds, then disputed |
| `000000000009` | `pm_usBankAccount_processing` | stays `processing` indefinitely |

**Financial Connections** (`docs.stripe.com/financial-connections/testing`): use the **"Test (Non-OAuth)"** institution for instant-verify happy path; **"Bank (Non-OAuth)"** + entering `error`/`incorrect`/`mfa` in the login fields to exercise auth failures; **"Invalid Payment Accounts"** for unusable accounts. Manual-entry microdeposit verification uses Stripe's test descriptor/amounts (confirm current value in the docs) — but note G12: the app has no in-app verification step, so this path can't complete today.

**Stripe CLI** for the events test PMs can't produce on their own (post-settlement ACH return, lost webhooks, dispute-without-payment):
`stripe listen --forward-to <preview>/api/stripe/webhook` and `stripe trigger payment_intent.payment_failed` / `charge.failed` / `payout.paid` / `transfer.reversed`, or Dashboard → Webhooks → Resend on a real event. For Connect events, ensure the triggered event carries an `account` (connected) context.
