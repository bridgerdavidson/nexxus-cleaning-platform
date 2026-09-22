# SaaS subscription billing (Phase 1) — design spec

**Date:** 2026-09-08
**Status:** Approved in brainstorming (Bridger + Claude, 2026-08-31 and 2026-09-08). Ready for `writing-plans`.
**Roadmap:** Phase 1 of `~/ai-os/projects/nexxus-service-solutions/strategy-decisions/2026-07-26-build-roadmap.md`.
**Pricing source of truth:** `2026-07-26-pricing-decision.md` (same directory). Deviations from it are listed in §18 and must be logged there if accepted.
**Successor:** Phase 2 (self-serve signup) gets its own spec. It depends on §5 and §8 here, and on the still-unrecorded outcome of `2026-08-18-domain-and-umbrella-brand-plan.md`.

---

## 1. Summary

Today a tenant org is created by a platform admin and lives in `subscription_status = 'trialing'` forever. There is no trial clock, no plan, no seats, no checkout, no enforcement, and no way for a prospect to pay us. This spec adds all of that on top of the billing scaffolding that already exists (`organizations.stripe_customer_id / subscription_status / subscription_id / subscription_current_period_end`, `tenant_subscription_events`, `src/lib/stripe/billing.ts`, `src/lib/payments/orgBilling.ts`, and the `customer.subscription.*` webhook mirroring).

The shape:

- A **14-day, no-card trial** that ends in a **read-only paywall**, not a lockout.
- **Three tiers** (Starter / Growth / Pro, monthly or annual) and **purchased cleaner seats**. The bill follows the tier and the seat count the owner chose; adding or removing cleaners never changes the bill.
- **Stripe Checkout** for the first purchase, one in-app `changePlan` call for every later change, and the **Stripe Customer Portal** for payment method, invoices, and cancellation.
- A **freeze** for expired trials, exhausted dunning (`unpaid`), cancellation, and admin pause. Frozen orgs can see everything and finish scheduled work; they cannot create new work. Enforced **server-side on every route that creates new work**, which first requires moving the browser's remaining direct table writes behind routes (**Phase 1a**).
- A **back office** that can comp, un-comp, extend, pause, cancel, annotate, and see billing state for every tenant.
- Everything ships behind `BILLING_ENFORCEMENT_ENABLED` (default off). The pilot is untouched until the flag flips, and the migration comps every pre-existing org, so the flag flip cannot touch it either. Leaving a comp is a deliberate back-office act that always lands the tenant in an open trial (§14).

## 2. Locked decisions (from the brainstorming sessions)

1. **Billing before signup.** Two specs; this one first. Signup's only output is "an org in trial," and the trial needs machinery first.
2. **Paywall is server-enforced on write routes.** Not client-side only. Not RLS (deferred as a hardening pass; see §21).
3. **Freeze new work; let scheduled work finish.** Blocked: new bookings, service/checklist edits, invites, new customers or homes, settings changes. Allowed: everything about appointments that already exist, job completion, charging, payouts, messaging, profiles.
4. **Every freeze-relevant write goes through an API route** (Phase 1a), rather than a targeted RLS predicate. Chosen for architectural cleanliness; accepted the larger refactor.
5. **No per-tier feature gates in Phase 1.** Every paying org gets the whole product. Tiers differ only in included seats, seat cap, and price.
6. **Purchased seats, not metered seats.** The owner buys N seats; the roster lives inside N.
7. **Plan changes are immediate with proration**, including downgrades (deviation from the pricing doc's "downgrades at period end"; §18).
8. **Trial cap is a flat 15 seats** (Growth's max). The Phase 2 signup team-size answer only pre-fills checkout.
9. **Eight back-office additions** accepted (§14): Stripe deep links, billing timeline, tenant notes, roster billing columns and filters, admin-only pause, billing address collection, `checkout.session.completed` handling with `integration_identifier`, one Stripe Product per tier.
10. **Pilots cannot hit a trial wall by accident** (2026-09-12). Every org that exists before the billing migration is comped by the migration itself, not by a checklist step. The platform admin controls every tenant's billing state from the back office (comp, un-comp with a runway, extend, pause, cancel), and un-comping always lands the tenant in an open trial, never a frozen one. Moving the Nexxus Core pilot onto paid billing is one back-office action followed by the tenant's own checkout.

## 3. Definitions

- **Org** — a tenant (`organizations` row). The billing unit.
- **Seat** — one `organization_members` row with role `cleaner`. Owners, admins, managers, and homeowners never count.
- **Seats in use** — cleaner members + pending, unexpired cleaner invites (`invites.status = 'pending'`, `expiration_date > now()`).
- **Seat count** — `organizations.seat_count`, the number of seats the org has purchased. Null while trialing or comped.
- **Included seats / max seats** — per tier, from the plan catalog (§6).
- **Extra seats** — `max(0, seat_count − included)`. Billed at the seat price.
- **Frozen** — `deriveBillingAccess(...).frozen === true` (§7). Reads allowed, new work refused.
- **New work** — the set of writes in §11.2.
- **Enforcement flag** — `BILLING_ENFORCEMENT_ENABLED === 'true'` on the server, `NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED` on the client.

## 4. Scope split

### Phase 1a — route the freeze-relevant writes

Prerequisite for enforcement, shipped first as normal PRs against master while the pilot runs. Only writes that **create new work** move. Lifecycle writes stay as direct supabase-js calls (appointment status, reschedule, cancel, assign, checklist ticks, photos, messages, profile edits, property edits and archives).

| Today (direct supabase-js) | New route(s) | Rewired |
|---|---|---|
| `service_types` insert / update / delete, duplicate-with-checklists (`useServices.ts`) | `POST /api/services`, `PATCH /api/services/[id]`, `DELETE /api/services/[id]` | `useServices` |
| `checklists` + `checklist_line_items` CRUD, bulk add, reorder (`useChecklists.ts`, `useServices.ts`) | `POST /api/services/[id]/checklists`, `PATCH` and `DELETE` on `/api/checklists/[id]`, `POST /api/checklists/[id]/items`, `PATCH` and `DELETE` on `/api/checklists/[id]/items/[itemId]`, `PUT /api/checklists/[id]/items/order` | `useChecklists`, `useServices` |
| operator one-off booking: `appointments` + `appointment_requested_slots` insert (`useCreateOperatorBooking.ts`) | `POST /api/appointments` | `useCreateOperatorBooking` (recurring already uses `/api/recurring-appointments`) |
| homeowner add-home: `properties` insert (`PropertyFormSheet.tsx`) | `POST /api/properties` | `PropertyFormSheet` |

Operators add customers through `admin/send-invite` (already a route). Details in §12.

### Phase 1b — billing

Everything else in this spec.

## 5. Data model

One migration created with `npx supabase migration new saas_billing_phase1`, written idempotently.

### 5.1 `organizations` — new columns

| Column | Type | Meaning |
|---|---|---|
| `trial_ends_at` | timestamptz | End of the free trial. Set at org creation to `created_at + 14 days`. |
| `trial_extended_at` | timestamptz | Non-null once the one-time 7-day extension has been used. |
| `comped_at` | timestamptz | Non-null = complimentary. No trial clock, no freeze, no seat cap. Doubles as audit stamp. |
| `plan_tier` | text, CHECK in (`starter`,`growth`,`pro`) | Null until first checkout. Webhook-truthed. |
| `billing_period` | text, CHECK in (`monthly`,`annual`) | Null until first checkout. Webhook-truthed. |
| `seat_count` | integer, CHECK `> 0` | Purchased seats. Null until first checkout. Webhook-truthed. |
| `subscription_cancel_at` | timestamptz | Mirror of Stripe `cancel_at` (portal cancel-at-period-end). Display only. |
| `billing_paused_at` | timestamptz | Mirror of Stripe `pause_collection` being set. Non-null = paused (frozen). |
| `billing_pause_resumes_at` | timestamptz | Mirror of `pause_collection.resumes_at`. Display only. |

### 5.2 `organizations.subscription_status` — CHECK gains `unpaid`

Values become `none | trialing | active | past_due | unpaid | canceled`. `mapSubscriptionStatus` maps Stripe `unpaid → 'unpaid'` (today it collapses into `past_due`). `OrgSubscriptionStatus` in `orgBilling.ts` gains the value.

### 5.3 Backfill (same migration)

```sql
update organizations set subscription_status = 'trialing' where subscription_status = 'none';
update organizations set trial_ends_at = now() + interval '14 days'
  where subscription_status = 'trialing' and trial_ends_at is null;
-- Every org that predates this migration was hand-provisioned for the pilot: comp it.
-- The cutoff is this migration's own version timestamp, so a re-application on the
-- shared dev database never comps an org created after it.
update organizations set comped_at = now()
  where comped_at is null and created_at < '<this migration's version timestamp>';
```

Nothing can freeze on deploy or on the later flag flip: every pre-existing org, the Nexxus Core pilot included, is comped by the migration and stays comped until a platform admin removes the comp from the back office (§14), which always lands it in an open trial. `trial_ends_at` is still stamped so the column is never null, but it is dormant while `comped_at` is set. Internal test orgs that should exercise a real trial are un-comped after the flag flips. If the migration is ever re-applied, a pre-existing org that had been deliberately un-comped is re-comped, which fails open (never frozen) and shows in the roster's comped filter.

### 5.4 `platform_tenant_notes` — new table

`id uuid pk, organization_id uuid fk organizations on delete cascade, author_user_id uuid fk auth.users, body text not null, created_at timestamptz default now()`. RLS enabled with no policies: service-role only through the platform routes, same posture as `platform_audit_log`.

### 5.5 `platform_stats()` — extended

Adds `past_due`, `unpaid`, `trial_expired` (trialing and `trial_ends_at < now()`), `trial_expiring_7d` (trialing and `trial_ends_at` within 7 days), `comped`, `paused`. MRR is **not** computed in SQL (pricing lives in TypeScript); the platform organizations route computes `mrr_cents` per org from the catalog and the stats route sums it.

### 5.6 Realtime

`organizations` is not in the realtime publication and this spec does not add it. The billing hook (§11.4) refetches on window focus, after every billing mutation, and polls briefly after checkout return.

## 6. Plan catalog

`src/lib/billing/plans.ts` — importable from server and client. The single source for tiers; `src/components/marketing/pricing.ts` re-exports from it so the pricing page and the billing engine cannot drift.

```ts
export type PlanTier = 'starter' | 'growth' | 'pro';
export type BillingPeriod = 'monthly' | 'annual';

export const PLANS: Record<PlanTier, {
  name: string;
  monthlyCents: number;          // 3900 | 9900 | 16900
  annualMonthlyCents: number;    // 2900 | 7900 | 13900  (per month, billed yearly)
  includedSeats: number;         // 3 | 8 | 15
  maxSeats: number | null;       // 5 | 15 | null
}>;
export const EXTRA_SEAT_MONTHLY_CENTS = 1000;
export const TRIAL_DAYS = 14;
export const TRIAL_EXTENSION_DAYS = 7;
export const TRIAL_SEAT_CAP = 15;

export const LOOKUP_KEYS = [
  'starter_monthly', 'starter_annual', 'growth_monthly', 'growth_annual',
  'pro_monthly', 'pro_annual', 'extra_seat_monthly', 'extra_seat_annual',
] as const;   // 8 Prices, not 7: Stripe requires every item on a subscription to share
              // an interval, so annual plans need an annual seat price ($120/yr).

export function planMonthlyCents(tier, period, seatCount): number;   // base + extras
export function seatBounds(tier): { min: number; max: number | null }; // [included, max]
export function tierFor(lookupKey): { tier, period } | null;
```

Numbers mirror the pricing doc exactly; change them only with a logged decision there.

## 7. Billing access state machine

### 7.1 Dunning ends in `canceled`, not `unpaid` (decided 2026-09-22)

Stripe can end a failed dunning cycle either by marking the subscription `unpaid` or by
cancelling it. **We cancel.** The reasoning, after review found that `unpaid` had no specified
recovery path:

- The only way out of `unpaid` is for the customer to pay the open invoice. That means a
  customer who is lapsing *because they cannot afford the plan* must pay the old price before
  they are allowed to move to a cheaper one, which is the case most likely to end in a support
  ticket or a lost customer.
- `canceled` is already frozen (§7), already shows the paywall (§13), and already routes to
  Checkout, because `readLiveSubscription` reports no live subscription. A lapsed customer
  therefore just buys again, at whatever tier they can afford, through a path that is built
  and tested.
- It removes an entire state's worth of UI from PR F (the Settings branch) and PR G (the back
  office case), and removes the need to expose `latest_invoice.hosted_invoice_url` anywhere.

**`unpaid` remains fully implemented and must stay that way.** It is in the CHECK constraint,
`mapSubscriptionStatus` still emits it, and `deriveBillingAccess` still freezes on it. It is
now a *defensive* state rather than an expected one: it can still arrive if the Dashboard
setting is ever changed back, or on a subscription created before this decision. Treat any
occurrence in production as a signal that the Dashboard config has drifted.

Consequence for `POST /api/billing/plan`: the route refuses a plan change while the mirrored
status is `past_due` or `unpaid`, with a 409 and "Please update your payment method before
changing your plan." That is not a dead end. A `past_due` org is **not frozen** (§7), so it
keeps working normally while Stripe retries, and its banner already tells it to fix the card.
If the retries run out, the subscription cancels and the paywall's Checkout path takes over.


`src/lib/billing/access.ts` — one pure function, unit-tested against fixed clocks. Every consumer (server guard, client hook, banner, paywall, back office) calls it. There is exactly one definition of "frozen."

```ts
export type BillingState =
  | 'comped' | 'paused' | 'trialing' | 'trial_expired'
  | 'active' | 'past_due' | 'unpaid' | 'canceled';

export interface BillingAccess {
  state: BillingState;
  frozen: boolean;
  trialDaysLeft: number | null;   // trialing / trial_expired only
  canExtendTrial: boolean;        // trialing or trial_expired, and trial_extended_at is null
  seatCap: number | null;         // null = unlimited (comped)
}

export function deriveBillingAccess(org: OrgBillingRow, now: Date): BillingAccess;
```

Precedence and derivation:

| State | Derived from | Frozen |
|---|---|---|
| `comped` | `comped_at` not null | no |
| `paused` | `billing_paused_at` not null | **yes** |
| `trialing` | status `trialing`, `trial_ends_at >= now` | no |
| `trial_expired` | status `trialing`, `trial_ends_at < now` | **yes** |
| `active` | status `active` | no |
| `past_due` | status `past_due` (Stripe still retrying) | no (banner) |
| `unpaid` | status `unpaid` (retries exhausted) | **yes** |
| `canceled` | status `canceled` | **yes** |

`none` never occurs after the §5.3 backfill and provisioning changes; if it does, treat as `trial_expired` (safe: frozen with a plan picker).

`seatCap`: comped → `null`; trialing / trial_expired → `TRIAL_SEAT_CAP`; otherwise `seat_count` (Pro has no upper bound on purchase, but the cap is still what was purchased).

"Trial expired" is derived, never stored. No cron flips rows, and there is no stale window.

## 8. Trial

- **Start.** `trial_ends_at = created_at + 14 days`, stamped by `POST /api/platform/organizations` (and later by the Phase 2 signup route). Backfilled per §5.3.
- **Extension.** `POST /api/billing/trial/extend` `{ organization_id }`. Owner only. Allowed once: `trial_extended_at` must be null and state must be `trialing` or `trial_expired`. Sets `trial_ends_at = max(now, trial_ends_at) + 7 days`, stamps `trial_extended_at`. Offered on the paywall and in the banner when 3 or fewer days remain.
- **Platform-side extension** (§14) is separate, unlimited, and does not touch `trial_extended_at`.
- **Leaving a comp.** Remove comp (§14) always sets `trial_ends_at = now() + runway` (default 14 days) before clearing `comped_at`, so a formerly comped org lands in `trialing`, never `trial_expired`. A formerly comped org that already has an active Stripe subscription lands in `active` and needs no runway.
- **End.** Nothing is charged (no card exists). State becomes `trial_expired`; the paywall (§13) is the conversion moment.

## 9. Purchased seats

- Bill = tier base + extras × seat price, where extras = `max(0, seat_count − includedSeats)`.
- `seat_count` bounds: `[includedSeats, maxSeats]` for Starter and Growth (3–5, 8–15); `[15, ∞)` for Pro. Never below seats in use.
- The bill changes **only** on `changePlan` (§10.4). Adding or removing a cleaner never touches Stripe. There is no membership-triggered sync and no seat-reconcile job.
- **Invite cap.** `admin/send-invite` with role `cleaner` computes seats in use and refuses with **409** `{ error: 'seat_cap_reached', cap, in_use, tier, next_tier }` when `in_use >= seatCap`. Pending invites reserve a slot so twenty invites cannot land at a five-seat cap. Comped orgs are never capped.
- **Above the cap after un-comp.** A formerly comped org may have more cleaners than `TRIAL_SEAT_CAP`. It keeps every cleaner it has (nothing is removed and nothing freezes) but cannot invite more until it buys seats; checkout's `seat_count >= seatsInUse` rule then steers it to the tier that fits, or to Pro. The Billing section and the un-comp dialog both say so.
- **Freeing a seat.** Deleting a cleaner or cancelling a pending invite frees the slot immediately. The bill is unchanged until the owner reduces `seat_count` in Billing. The Cleaners page says so after a delete ("1 seat is now open. Add a cleaner, or reduce your seats in Billing to lower your bill.").
- **Accepted race.** Two invites sent simultaneously at cap-minus-one both pass; the org sits one over cap until someone leaves. Billing is unaffected (it counts purchased seats). Not worth a constraint trigger.
- **No deactivate exists.** Delete is blocked while a cleaner has active appointments or an open pay request, so a seasonal cleaner with a job next month keeps a seat until it runs. Named follow-up (§21).

## 10. Stripe integration

All new Stripe SDK calls live in `src/lib/stripe/billing.ts` so integration tests can `vi.mock` the module (the global setup stubs `getStripe()` to throw). Orchestration mixing Stripe and DB lives in `src/lib/payments/orgBilling.ts`. No `payment_method_types` anywhere (Stripe picks dynamically). Every Checkout Session carries `integration_identifier: 'nexxus-saas-checkout-<8 random letters>'`.

### 10.1 Setup script — `scripts/stripe-billing-setup.ts`

Run once per Stripe account (test, then live). Idempotent (looks up by lookup key / metadata before creating).

- Creates **four Products**: Starter, Growth, Pro, and "Extra cleaner seat." One Product per tier is Stripe's stated best practice: invoices and Checkout print the Product name per line, so tiers sharing a Product would be indistinguishable.
- Creates the **8 Prices** with the lookup keys from §6, each on its Product, `recurring.interval` month or year, `tax_behavior: 'exclusive'`.
- Creates **one Customer Portal configuration** tagged `metadata.nexxus_portal = 'default'`: `invoice_history`, `payment_method_update`, `customer_update` (email, address, name), `subscription_cancel` at period end with the built-in cancellation-reason survey, `subscription_update` **disabled** (plan changes are in-app). Tax ID collection off until Stripe Tax is on.
- Prints what it found and what it created. Never deletes.
- For a future price change: create the new Price with `transfer_lookup_key: true`; existing subscribers keep their old Price (Stripe grandfathers). This is how the pricing doc's 60-day-notice promise stays mechanically cheap.

### 10.2 Price and portal resolution

`resolvePrices()` calls `prices.list({ lookup_keys: [...all 8], active: true })`, validates all 8 are present (throws a clear error naming the missing keys otherwise), and caches per process. `resolvePortalConfiguration()` lists configurations and picks the one tagged `default`, cached. No env vars, no config table; test and live differ only in which account the SDK key points at.

### 10.3 Checkout (first purchase)

`POST /api/billing/checkout` `{ organization_id, tier, period, seat_count }`. Owner or admin. **Never guarded by `requireWritable`** (a frozen org must be able to pay). Validates tier/period/seat bounds and `seat_count >= seatsInUse`. Reuses `getOrCreateOrgCustomer`. Creates:

```ts
checkout.sessions.create({
  mode: 'subscription',
  customer: customerId,
  customer_update: { address: 'auto', name: 'auto' },
  billing_address_collection: 'required',
  line_items: [
    { price: basePriceId, quantity: 1 },
    ...(extras > 0 ? [{ price: seatPriceId, quantity: extras }] : []),
  ],
  subscription_data: { metadata: { organization_id } },
  allow_promotion_codes: true,
  integration_identifier,
  success_url: `${APP_URL}/admin/settings?section=billing&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
  cancel_url:  `${APP_URL}/admin/settings?section=billing&checkout=canceled`,
})
```

No `trial_period_days`: the app-managed trial is over by the time they pay. `allow_promotion_codes` means the stakeholders' launch offer becomes a Stripe coupon, not code. `automatic_tax` is **not** passed until `BILLING_TAX_ENABLED === 'true'` (§20, Stripe Tax); billing addresses are collected from day one so the data exists when tax turns on.

The existing `POST /api/stripe/billing/subscriptions/start`, `startOrgSubscription`, and `createStripeSubscription` are **deleted**. Two purchase paths is one too many.

### 10.4 `changePlan` (every later change)

`POST /api/billing/plan` `{ organization_id, tier, period, seat_count }`. Owner only. Never guarded by `requireWritable`.

- Validates as checkout does.
- If the org has no live subscription (`trialing`, `trial_expired`, `canceled`, or no `subscription_id`): returns `{ checkout_url }` from §10.3.
- Otherwise retrieves the subscription, computes the item diff with a **pure function** `diffSubscriptionItems(current, target)` (unit-tested) and calls once:

```ts
subscriptions.update(subId, {
  items: diffSubscriptionItems(current, target),
  //  base item:  { id: baseItem.id, price: newBasePriceId }            tier and/or interval swap
  //  seat item:  { id: seatItem.id, price: newSeatPriceId, quantity }   extras > 0, item exists
  //              { price: newSeatPriceId, quantity }                    extras > 0, no item yet
  //              { id: seatItem.id, deleted: true }                     extras == 0, item exists
  //              (omitted)                                              extras == 0, no item
  proration_behavior: 'create_prorations',
  metadata: { organization_id },
})
```

Prorated in both directions, with the **invoicing** split by direction. Corrected 2026-09-22:
the original claim ("immediate, prorated, both directions") was false in code. Stripe's
`create_prorations` writes proration lines but does NOT invoice them, so an upgrade's extra
money waited for the next scheduled invoice, which on an annual plan is up to a year away
(a Growth annual customer going 8 to 15 seats in month two received roughly $840 of seats
before any charge).

| Change | `proration_behavior` | Billed |
|---|---|---|
| Raises the per-cycle charge (tier up, seats up, monthly→annual) | `always_invoice` + `payment_behavior: 'error_if_incomplete'` | Now. A declined card rejects the change rather than leaving the customer upgraded and unpaid |
| Lowers it (tier down, seats down, annual→monthly) | `create_prorations` | Credit on the next invoice. We never refund cash for a downgrade |
| Leaves it unchanged (a seat shuffle at one price) | `create_prorations` | Nothing |

Direction is one comparison of `planChargeCents` before against after, which reproduces the
whole table. A stored plan the code cannot read is treated as an upgrade, failing toward
charging rather than toward giving service away. Refused entirely while `past_due` or
`unpaid` (§7.1). Monthly↔annual is a normal call (both items swap interval together). Mirrors
`plan_tier`, `billing_period`, `seat_count` on success; the webhook is the backstop.

For `past_due` / `unpaid`, a plan change does not fix the failed payment; the UI leads with "Update payment method" (portal) and offers Change plan second.

### 10.5 Customer Portal

`getOrgPortalLink(orgId, returnUrl)` gains the resolved configuration. Exposed as `POST /api/stripe/billing/portal-link` (exists). Owns payment method, billing email/name/address, invoice history, cancel at period end (with Stripe's cancellation survey). Plan changes disabled there.

### 10.6 Pause and cancel (admin-only)

`PATCH /api/platform/organizations/[id]` with `{ action: 'pause', resumes_at }` → `subscriptions.update(subId, { pause_collection: { behavior: 'void', resumes_at } })`; `{ action: 'resume' }` → `pause_collection: ''`. `void` means no invoice records exist for paused months. Requires an active subscription (trialing orgs get a trial extension instead). The webhook mirrors `pause_collection` onto `billing_paused_at` / `billing_pause_resumes_at`; state `paused` is frozen (§7). Self-serve pause is a follow-up inside a cancellation flow (§21).

`{ action: 'cancel', when: 'period_end' | 'now' }` → `period_end` calls `subscriptions.update(subId, { cancel_at_period_end: true })`; `now` calls `subscriptions.cancel(subId)`. `cancelOrgSubscription` in `orgBilling.ts` (today: immediate only) gains the `when` argument and is the single call site. Requires a subscription in `active`, `past_due`, or `unpaid`. The webhook mirrors `cancel_at` and then `canceled` exactly as a portal cancel does; state `canceled` is frozen (§7), so the dialog says the org will freeze unless it is comped first. Refunds stay a Dashboard action (§20 step 10).

### 10.7 Webhooks

Existing handlers in `dispatchStripeEvent.ts` (`customer.subscription.created|updated|deleted`, `invoice.payment_succeeded|payment_failed`) are extended, and one event is added:

- **`customer.subscription.created|updated`** (`handleSubscriptionUpsert`): in addition to status and `current_period_end`, mirror `plan_tier` + `billing_period` from the base item's `price.lookup_key` via `tierFor()`, `seat_count = includedSeats + (seatItem?.quantity ?? 0)`, `subscription_cancel_at` from `cancel_at`, and `billing_paused_at` / `billing_pause_resumes_at` from `pause_collection`. `mapSubscriptionStatus` now yields `unpaid`. Items and their prices are present on the subscription payload (`items.data[].price.lookup_key`); no extra fetch.
- **`customer.subscription.deleted`**: unchanged (`canceled`) plus clears `subscription_cancel_at` and pause mirrors.
- **`checkout.session.completed`** (new): resolves org from `session.metadata`/`subscription`, writes a `tenant_subscription_events` row with `session_id`, `integration_identifier`, `amount_total`. Fulfillment itself continues to key off `customer.subscription.created`, which arrives in the same burst. The org row's `billing_email` is refreshed from `customer_details.email` when the org had none.
- **`invoice.payment_failed|payment_succeeded`**: unchanged (audit rows).

Ops (§20): the live-mode webhook endpoint must have all six events enabled.

### 10.8 Accepted payment methods

Added 2026-09-22 after the PR F design session. The spec was previously silent on this,
which meant we would have shipped whatever the Stripe Dashboard happened to have enabled.

**Wallets (Apple Pay, Google Pay, Link): on, and nothing to build.**

`createBillingCheckoutSession` deliberately passes no `payment_method_types`, so dynamic
payment methods are active and Stripe decides per device. For this integration path Stripe
documents that "Stripe.js detects and supports the following wallets based on the state of
your device", and per wallet, "If you don't meet device and integration requirements, Stripe
doesn't show Apple Pay as a payment option." A Windows user therefore never sees Apple Pay;
no defensive code is required.

| Buyer's setup | Wallet offered |
|---|---|
| iPhone / iPad, any browser on iOS 16+ | Apple Pay |
| Mac, Safari (incl. no Touch ID, via paired iPhone or Watch) | Apple Pay |
| Mac, Chrome | Google Pay |
| Android, Chrome | Google Pay |
| Windows, Chrome or Edge | Google Pay (never Apple Pay) |
| Windows, Firefox | Card or Link only |

Two consequences worth recording:

- **No Apple Pay domain verification is required.** That is only needed for embedded Checkout
  or Elements. Hosted Checkout renders on `checkout.stripe.com`, which Stripe has already
  registered. The only ops step is enabling the wallets in the Dashboard payment method
  configuration (§20).
- **Wallet ordering is not merchant-controllable** on hosted Checkout; Dashboard payment
  method rules explicitly exclude wallets. We therefore cannot act on the finding that
  *defaulting* to a wallet outperforms merely offering it. Accepted as a consequence of
  keeping hosted Checkout (PR F ruling R10).

**ACH Direct Debit (`us_bank_account`): deliberately OFF, and explicitly excluded in code.**

ACH is fully supported for `mode: 'subscription'`, and because we pass no
`payment_method_types`, enabling it in the Dashboard would turn it on in production **with
zero code change**. That is a footgun, and it is most likely to be tripped during the very
ops step that enables the wallets, since both live on the same Dashboard screen.

It is off because it would silently break the paywall. Stripe Billing documents that with
ACH a subscription "can move directly to `active` after creation and bypass `incomplete`. If
the payment fails later, Stripe voids the invoice but the subscription remains `active`."
ACH settles at T+4 business days, and a consumer bank account can return the debit for up to
60 days. So `subscription_status === 'active'`, which §7's state machine treats as proof of
payment, would stop meaning paid and would stay wrong after a failure. We would unfreeze an
account with no mechanism to re-freeze it.

The saving does not justify that: $13 to $46 per customer per year at our prices, against a
$4 NSF fee that erases three months of it and a $15 dispute that erases thirteen months plus
the revenue.

**The rule generalises past ACH.** Any payment method whose result arrives asynchronously
breaks the same assumption, and the SDK's union carries several that a non-US billing address
can surface: `sepa_debit`, `bacs_debit`, `acss_debit`, `au_becs_debit`. Exclude any such
method until the payment dimension above exists. Two further ACH-specific facts found in
review: it is **not supported in the Stripe Customer Portal**, so a bank-paying customer could
not manage their own subscription, and **partial refunds are unavailable** for it, which would
block any pro-rata refund.

**Therefore:** `createBillingCheckoutSession` passes
`excluded_payment_method_types: ['us_bank_account']` (PR F task 15; not in the code at the
time this section was written). This is the Stripe-sanctioned way to
narrow methods (`payment_method_types` remains forbidden), it is greppable, and it survives a
Dashboard change. Verified present in the pinned SDK at
`node_modules/stripe/types/Checkout/SessionsResource.d.ts:124`.

**To enable ACH later**, these nine changes are required. Do not enable it without them:

1. Stop treating `subscription_status = 'active'` as paid; add a payment dimension driven by
   the PaymentIntent.
2. Provisional unfreeze on `payment_intent.processing` with a hard ~6-business-day horizon,
   then re-freeze if it has not settled.
3. Wire `invoice.payment_failed` to access. Today it records an audit row and deliberately
   does not touch access (`dispatchStripeEvent.ts:1900` says so explicitly).
4. Route **subscription** disputes separately from job-charge disputes. We do handle
   `charge.dispute.created` (`dispatchStripeEvent.ts:57`), but that handler maps to a
   `payments` row; a subscription dispute finds no match and falls through to
   `unmatched_dispute` with a console warning. A `us_bank_account` dispute must re-freeze the
   org, clear the payment method (the Nacha mandate dies with the dispute), and alert.
5. Handle `payment_method.automatically_updated` for blocked bank accounts.
6. Extend `reconcileBillingMirror` to check `latest_invoice` and PaymentIntent status, not
   just subscription status.
7. Turn on Direct Debit retries (2 tries / 40 days / NSF only) and re-tune dunning; a 14-day
   card schedule is wrong for a 40-day ACH cycle.
8. Add **pending updates** to plan-change upgrades. As of 2026-09-22 upgrades already use
   `always_invoice` + `payment_behavior: 'error_if_incomplete'` (§10.4), which is correct for
   cards but not sufficient for ACH: `error_if_incomplete` cannot detect a failure that
   arrives four business days later, so the org would flip out of `active` well after we told
   them the upgrade worked. (This item previously described `create_prorations` as charging
   immediately. It does not, which was the bug §10.4 fixes.)
9. Keep hosted Checkout (it collects and stores the Nacha mandate, emails confirmation, and
   auto-answers proof-of-authorization inquiries) and do not disable Stripe's customer
   emails, or we inherit the mandate and microdeposit email duty ourselves.

Unverified and to be settled by a sandbox test before any ACH work: whether partial refunds
are genuinely unavailable for ACH (Stripe's capability table shows "Partial refunds: no",
which would block pro-rata refunds), and the T+2 eligibility for the fee cap. Note that
sandbox ACH settles instantly, so a green sandbox test proves nothing about timing; use the
`pm_usBankAccount_*` test payment methods and record the actual webhook sequence.

## 11. Enforcement

### 11.1 The guard

`requireOrgAuth` gains `requireWritable?: boolean`. When true, after the membership check it loads the org's billing columns, runs `deriveBillingAccess`, and if `frozen` returns:

```
HTTP 402
{ "error": "billing_frozen", "state": "trial_expired" | "unpaid" | "canceled" | "paused",
  "trial_ends_at": "...", "can_extend_trial": true }
```

With the enforcement flag off, `requireWritable` is a no-op. For the two guarded routes that use hand-rolled auth (`admin/send-invite`, `recurring-appointments`), a standalone `assertOrgWritable(supabaseAdmin, orgId)` returning the same 402 is called after their existing membership check. Both live in `src/lib/billing/guard.ts`.

### 11.2 Guarded routes (the "new work" set)

- Phase 1a: `POST|PATCH|DELETE /api/services[/id]`, all `/api/services/[id]/checklists` and `/api/checklists/**` write methods, `POST /api/appointments`, `POST /api/properties`.
- `admin/send-invite` (every role), `recurring-appointments` (POST), `appointments/request`, `appointments/confirm`, `appointments/confirm-series`.
- `organizations/[orgId]/{profile,branding,business-hours,cleaner-experience,cleaner-payouts,payment-settings}` PATCH (not `onboarding`: checklist stamps are not settings), `admin/update-cleaner`, `admin/update-manager-permissions`.

### 11.3 Explicitly not guarded

Cancel, reschedule, lifecycle, details, assign/reassign cleaner, accept-counter-proposal, charge, payment-method, pay-request, refund, retry-fee, payouts/*, pay-requests/*, cleaner appointment status, photo-skip, messages, notifications, every `stripe/*` setup-intent and Connect route, `billing/*` (checkout, plan, trial extend, card-links, portal-link), `accept-invite/*` (the seat was reserved at send time), `cancel-invite`, all `delete-*` routes, `invites/[id]/*`, `forgot-password`, and every GET.

Cron routes and the webhook never call `requireOrgAuth`. A unit test asserts `src/lib/billing/guard.ts` is not imported (transitively) by `src/lib/payments/**`, `src/app/api/cron/**`, or `src/app/api/stripe/webhook/**`, so the "service role is never gated" invariant is enforced by CI.

### 11.4 Client

- `useOrgBilling()` (TanStack, `keys.billing.org(orgId)`, `staleTime` 30s) reads the org's billing columns plus cleaner-member and pending-cleaner-invite counts and returns `deriveBillingAccess(...)` plus `{ seatsInUse, seatCount, planTier, billingPeriod, periodEnd, cancelAt }`. Refetches on window focus, after any billing mutation, and polls every 2s (max 10) when the URL carries `checkout=success` until state is `active`.
- The operator shell reads it for the pill/banner and paywall (§13).
- The four "new work" entry points (New booking, Services editor, Invite, Add customer) check `frozen` (with the client flag on) and open the paywall instead of the form.
- The shared fetch helpers (`settings-api.ts` pattern, extended to the new route clients) catch any 402 with `error === 'billing_frozen'` and open the paywall, so a stale tab lands in the right place instead of on an error toast.
- No RLS policy changes.

## 12. Phase 1a route design

Conventions for every new route: `requireOrgAuth` against the **resolved** org (the service's / checklist's / property's `organization_id`, never a body field alone), `supabaseAdmin` for writes, JSON `{ success, data }` / `{ error }`, `runtime = 'nodejs'`, co-located `*.integration.test.ts` using `tests/helpers/{supabase,auth,db,fixtures}.ts`. Client calls go through `getAccessToken()` + `fetch` exactly like `settings-api.ts`; new helper modules `services-api.ts`, `checklists-api.ts`, `bookings-api.ts`, `properties-api.ts` beside their hooks. Hooks keep their cache-update logic (`updateServiceInState`, `applyLineItemAdded`, …) because each route returns the created/updated row.

### 12.1 Services

- `POST /api/services` `{ organization_id, name, description?, base_price, duration_minutes, is_active?, …, checklists?: [{ name, price_adder, items: string[] }] }` → creates the service, then any checklists and items sequentially with a compensating delete of the service on failure (parity with today's client behavior; an atomic RPC is a follow-up). Roles: owner, admin, manager (manager permission key confirmed at plan time against the existing `service_types` policies).
- `PATCH /api/services/[id]` partial fields. `DELETE /api/services/[id]`.

### 12.2 Checklists

- `POST /api/services/[id]/checklists` `{ name, price_adder, items?: string[] }`.
- `PATCH /api/checklists/[id]` `{ name?, price_adder? }`. `DELETE /api/checklists/[id]`.
- `POST /api/checklists/[id]/items` `{ task }` or `{ tasks: string[] }` (bulk; positions appended).
- `PATCH /api/checklist-items/[itemId]` `{ task }`. `DELETE /api/checklist-items/[itemId]`. (Amended at plan time, 2026-09-12: keyed by item id alone because `updateLineItem(lineItemId, task)` and `deleteLineItem(lineItemId)` only know the item; the route resolves the org from the item.)
- `PUT /api/checklists/[id]/items/order` `{ item_ids: string[] }` — validates the set equals the checklist's items, writes positions.
- Tier order remains `checklistOrder.ts` (price_adder asc); reorder applies to items only, matching #263.

### 12.3 Operator booking

`POST /api/appointments` `{ organization_id, appointment: <buildBookingInsert output>, slots: [...] }`. Roles: owner, admin, manager. Validates property, service, checklist, and cleaner (if any) belong to the org; applies the same cleaner-payability gate as the form (`selfPayCleanerBlockReason`) server-side. Inserts the appointment and, when more than one slot, the requested slots. Returns `{ id }`.

### 12.4 Properties

`POST /api/properties` `{ organization_id, owner_id?, …property fields }`. Roles: homeowner (owner_id forced to caller), owner/admin/manager (owner_id must be a homeowner member of the org). Returns the row.

## 13. UX

The Billing section and paywall are real UI. Per repo rule they go through **`ui-feature-workflow`** (browser companion question, mobile/desktop question, `ui-ux-pro-max` at design and implementation) before being built; every screen uses `src/components/ui/*` primitives and tokens. No em dashes in copy.

### Operator

- **Settings → Billing** — new `billing` section in `sections.ts` (group `business`, roles owner + admin; owner-only actions disabled for admin). One component with a branch per `BillingState`:
  - `trialing`: days left, seats in use of 15, **Choose a plan** (tier + seat stepper + live price via `planMonthlyCents`), Extend trial when ≤ 3 days remain and eligible.
  - `trial_expired`: same, urgent tone.
  - `active`: plan card (tier, period, "4 of 5 seats in use", price/month, renews on, "cancels on" if `subscription_cancel_at`), **Change plan** form (tier radios greyed with reason when `maxSeats < seatsInUse`, seat stepper floored at `max(includedSeats, seatsInUse)` and capped at `maxSeats`, live price and delta, Update), **Payment method and invoices** (portal).
  - `past_due`: card-failed banner, **Update payment method** (portal) primary, plan card, Change plan secondary.
  - `unpaid` / `canceled`: frozen plan card, **Reactivate** (portal for unpaid; Change plan → checkout for canceled).
  - `paused`: "Your account is paused until {date}. Contact us to resume early." No controls.
  - `comped`: "Complimentary plan," seats in use, no controls.
- **Shell indicator** — compact "Trial: 9 days left" pill in the operator header for the whole trial; becomes a banner at ≤ 3 days. `past_due` is always a banner with the portal link. Nothing during `active`.
- **Paywall** — full-screen interstitial in the operator shell when `frozen` and the client flag is on: headline by state, the tier + seats picker (reusing the Billing form), Extend trial when eligible, **View your data** which drops into the read-only dashboard with a persistent frozen bar. Any new-work button reopens it.
- **Cleaners page** — "4 of 5 seats" beside Invite. At the cap the dialog says "All 5 of your seats are in use. Add a seat for $10/mo or move to Growth" with a link to Billing. After a delete: the one-seat-open message (§9). During trial the copy names the 15-seat trial cap only when reached.
- **Checkout return** — `checkout=success` shows "Activating your plan" while §11.4 polls; `checkout=canceled` returns to the plan form silently.

### Homeowner

Book a cleaning and Add a home, when the route returns 402: "This company isn't taking new bookings right now. Your scheduled cleanings are unaffected." No plan picker, no mention of billing.

### Cleaner

No change. Nothing a cleaner does creates new work.

## 14. Platform back office (`/owner`)

- **`TenantDetailSheet`** billing block: state (from `deriveBillingAccess`), plan, period, seats in use / purchased, MRR, trial ends, renews / cancels on, paused until; **Stripe deep links** to the customer and subscription (`https://dashboard.stripe.com/{test/}customers/{id}`, `/subscriptions/{id}`; test-mode prefix when the key is a test key); a **billing timeline** listing `tenant_subscription_events` newest first (event type, time, key payload fields); **internal notes** (list + add).
- **Actions**, each behind a confirm dialog and each writing a `platform_audit_log` row (`billing.comp`, `billing.uncomp`, `billing.extend_trial`, `billing.pause`, `billing.resume`, `billing.cancel`, `tenant.note`):
  - **Comp.** Sets `comped_at = now()`. Warns when the org has an active subscription (comp wins, but Stripe keeps invoicing until the subscription is paused or canceled).
  - **Remove comp.** Requires a **runway in days** (default 14, minimum 1). Sets `trial_ends_at = now() + runway`, then clears `comped_at`, in one update, so the tenant lands in an open `trialing` state and never in `trial_expired`. The dialog shows seats in use against `TRIAL_SEAT_CAP` and names the tier that fits, and the audit row records the runway. If the org already has an active subscription the runway field is hidden and the org lands in `active`. This is the "take them out of the pilot" action: for the Nexxus Core pilot it is one click, after which the tenant checks out on its own inside the runway.
  - **Extend trial by N days** (platform-side, unlimited, any trialing or trial-expired org).
  - **Pause until date / Resume** (active subscriptions only).
  - **Cancel subscription** at period end or immediately (§10.6). The dialog states that the org freezes on cancellation unless it is comped.
- **`PATCH /api/platform/organizations/[id]`** (new; `requirePlatformAdmin`) with a discriminated `action` body. **`POST /api/platform/organizations/[id]/notes`** (new).
- **`GET /api/platform/organizations`** returns the billing columns plus computed `mrr_cents`, `seats_in_use`, `billing_state`. **`TenantRoster`** adds Plan, Seats, Trial/renews, MRR columns and a state filter (all / trialing / expiring in 7 days / past_due / unpaid / frozen / comped). `PlatformStatCards` adds MRR and past_due + unpaid counts.
- **`ProvisionTenantDialog`** gains a "Complimentary (no trial clock, no billing)" checkbox → `comped_at = now()` at creation. Provisioning always stamps `trial_ends_at`.
- "View as this company" already exists and already refuses to start without an audit row; unchanged.

## 15. Permissions

| Action | Who |
|---|---|
| View Billing section | owner, admin |
| Checkout, change plan, extend trial, portal link | owner (admin may open checkout; may not change an existing plan) |
| Invite cleaner (cap-checked) | as today (owner, admin, manager with `can_manage_cleaners`) |
| Comp, remove comp, platform extend, pause, resume, cancel, notes | platform admin |
| Read `tenant_subscription_events` | org owners (existing RLS) and platform admin via the route |

## 16. Events, audit, observability

- Every billing mutation the app initiates (`checkout` session created, `plan` changed, `trial` extended, platform actions) appends a `tenant_subscription_events` row with `event_type` prefixed `app.` (`app.checkout_started`, `app.plan_changed`, `app.trial_extended`, `app.comped`, `app.uncomped`, `app.platform_extended`, `app.platform_paused`, `app.platform_resumed`, `app.platform_canceled`, …) so the timeline shows both what we did and what Stripe told us. `stripe_event_id` is `app:<uuid>` for these rows (the column is unique, not Stripe-validated).
- Webhook mirror failures and `resolvePrices()` failures raise `platform_alerts` rows (`alert_type` `billing_mirror_failed`, `billing_prices_missing`).
- A nightly `reconcileBillingMirror` job in the existing reconcile sweep compares each active org's `plan_tier / billing_period / seat_count / subscription_status` to Stripe and repairs drift, alerting on any repair. Cheap insurance in the codebase's own pattern.

## 17. Edge cases

- **Checkout completed but webhook late.** Client polls up to 20s. If still `trialing`, the Billing section shows "Still activating, refresh in a minute" and the nightly reconcile repairs any true drift.
- **Owner opens two checkout tabs.** Stripe creates two sessions; only one can complete against the same customer with a default payment method; the second's success return sees `active` already. Harmless.
- **Seat count below seats in use via a stale form.** Route validates against live counts and returns 400 with the current number; the form refreshes.
- **Cleaner deleted while frozen.** Allowed (delete routes are not guarded); frees a seat; bill unchanged.
- **Homeowner request pending when the trial expires.** `confirm` is guarded, so the request cannot be confirmed until the org pays. The homeowner sees the request as still pending; the operator's paywall explains why. Accepted.
- **`past_due` for an annual subscriber.** Same behavior: banner only until Stripe's retries end.
- **Portal cancel then change of mind.** Portal allows reactivation before period end; `subscription_cancel_at` clears via webhook.
- **Comped org with a Stripe subscription.** Comp wins (§7 precedence). The back office warns when comping an org that has an active subscription.
- **Un-comping an org whose backfilled clock has long expired.** Cannot freeze: Remove comp always resets `trial_ends_at` in the same update that clears `comped_at` (§14). `deriveBillingAccess` is unit-tested for the row shape `comped_at null, trial_ends_at in the future` immediately after an un-comp.
- **Un-comping an org above the trial seat cap.** Nothing is removed and nothing freezes; invites are refused at the cap until seats are bought (§9).
- **Enforcement flag flipped with a pre-existing org still in `trialing`.** Cannot happen by accident: the §5.3 migration comps every pre-existing org. The roster's comped filter is the pre-flip check (§20 step 7).
- **Multiple orgs per user.** Billing is per org; the pill/banner/paywall follow `currentOrganizationId`.

## 18. Accepted trade-offs and deviations from the pricing doc

1. **Downgrades are immediate with prorated credit**, not at period end. Avoids Subscription Schedules. Accepted; logged in the pricing doc's 2026-09-12 addendum together with items 2, 3, and 7.
2. **Trial cap is 15 seats regardless of the signup answer.** Simpler; the friction case is one click in Billing after purchase.
3. **Feature gates are not enforced** in Phase 1 (Starter gets analytics, fee tooling). Revisit when a Starter customer exists.
4. **Monthly↔annual switches are self-serve** (the pricing doc is silent; this is a clarification, not a deviation).
5. **Service creation with nested checklists is not atomic** (compensating delete, parity with today). Follow-up: an RPC.
6. **Pause is admin-only.** Self-serve pause waits for the cancellation-flow work.
7. **`unpaid` timing is Stripe's dunning setting**, not code. The pricing doc's "14 days" is configured in the Dashboard (§20).

## 19. Testing

- **Unit** (`src/lib/billing/*.test.ts`, `src/lib/payments/orgBilling.test.ts`): `deriveBillingAccess` for every state and clock edge (day 14 boundary, extension, comped precedence, paused precedence); `planMonthlyCents` and `seatBounds`; `diffSubscriptionItems` for tier up/down, interval swap, seat add/remove/zero; `tierFor`; `resolvePrices` caching and the missing-key error; `mapSubscriptionStatus('unpaid')`; the guard-import invariant test.
- **Integration** (co-located, real local Supabase, `@/lib/stripe/billing` mocked): every Phase 1a route (401/403/org-scope/happy path; 402 when frozen with the flag on; pass-through with the flag off); `checkout` and `plan` validation (bounds, below in-use, greyed tier, checkout-vs-update branch); `trial/extend` exactly once; `send-invite` 409 at cap and pending-invite reservation; webhook mirroring of tier, period, seat count, `unpaid`, `cancel_at`, pause; `checkout.session.completed` audit row; platform PATCH actions and audit rows; notes; migration backfill (`none → trialing`, `trial_ends_at` set).
- **E2E** (Playwright, one spec): frozen org → operator sees the paywall, browses read-only, extends the trial, paywall clears; homeowner sees the block message. Hosted Checkout is not automated; it is verified manually in test mode on `dev` with the Stripe CLI.
- **Manual before flag flip** (§20): full checkout with a test card, webhook mirror, change plan up/down/interval, portal cancel → `canceled` → frozen, pause/resume.

## 20. Rollout and ops checklist

**PRs, in order** (each through the normal branch → CI → PR flow; A–C may stack via `gh stack`). Plans: A–C in `docs/superpowers/plans/2026-09-12-phase1a-write-routes.md`; D–G are planned after A–C land.

| # | Contents | Flag |
|---|---|---|
| A | `/api/services` routes + `useServices` rewire + tests | n/a |
| B | checklist routes + `useChecklists` / `useServices` rewire + tests | n/a |
| C | `POST /api/appointments`, `POST /api/properties` + rewires + tests | n/a |
| D | migration (§5, including the comp-every-pre-existing-org backfill), plan catalog, `deriveBillingAccess`, `requireWritable` + `assertOrgWritable`, guard wired on §11.2, `mapSubscriptionStatus('unpaid')`, `platform_stats` extension | off |
| E | Stripe: setup script, resolvers, checkout, `changePlan`, trial extend, portal config, pause, webhook changes, `reconcileBillingMirror`, delete old start route | off |
| F | UI: Billing section, pill/banner, paywall, seats UI, homeowner copy (via `ui-feature-workflow`) | off |
| G | Back office: platform PATCH (comp, un-comp with runway, extend, pause, resume, cancel) + notes route, `TenantDetailSheet` billing block/timeline/notes/actions, roster columns/filters, stat cards, provisioning checkbox | off |

**Build model (decided 2026-09-12, to save tokens).** Fable is the decision-maker and reviewer, never the implementer:

- **Fable** (the main session) writes and approves the implementation plan, makes every design call the plan leaves open, reviews each PR's full diff and test output before anything is pushed, and requests changes or approves. Fable does not write implementation code beyond a one-line fix found in review.
- **Opus** subagents build the money-adjacent and multi-file work: PR D (migration, catalog, guard), PR E (Stripe integration and webhooks), PR G (platform actions), and any migration.
- **Sonnet** subagents build the mechanical work: PRs A, B, C (route extraction and hook rewires), tests, and PR F once its design is fixed by `ui-feature-workflow`.
- Fable chooses Opus or Sonnet per task at its discretion within those defaults. Each subagent receives the relevant spec sections, the plan task, and the repo conventions, and reports a diff summary plus the exact test output. Nothing merges without a Fable review.

**Ops (Bridger), after E–G are in prod and before the flag:**

1. Run `scripts/stripe-billing-setup.ts` against test mode, then live.
2. Stripe Dashboard → Billing → Manage failed payments: Smart Retries on; retry window ≈ 14 days; after the final retry **cancel the subscription** (NOT "mark unpaid"). **Changed 2026-09-22**, see §7.1.
3. Automatic card updater on (verify). Customer emails on: failed payment, card expiring, upcoming renewal (annual), receipts.
4. Live webhook endpoint: enable `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`, `checkout.session.completed`.
5. Portal branding (logo, colors) and public business info.
6. **Stripe Tax:** set the head-office address so nexus monitoring runs from day one; choose the SaaS product tax code **with an accountant from Stripe's canonical tax-code list** (never guessed) and set it on the four Products; add registrations where required. Only then set `BILLING_TAX_ENABLED=true`, which adds `automatic_tax` to Checkout and subscriptions. Until a registration exists, Stripe Tax silently collects nothing, so the flag stays off.
7. In the roster's comped filter, confirm the Nexxus Core pilot and every other pre-existing org show as comped (the §5.3 migration did this; nothing to click). Un-comp any internal test org you want on a real trial, giving it a runway.
8. On your own test org: full checkout, change plan, portal cancel, pause/resume. Watch the timeline.
9. **Payment method configuration** (§10.8). Enable **Apple Pay, Google Pay and Link**; hosted Checkout hides each one automatically on devices that cannot use it, and needs **no Apple Pay domain verification** because the page renders on `checkout.stripe.com`. ⚠️ **Do NOT enable ACH Direct Debit on this screen.** It is supported for subscriptions and we pass no `payment_method_types`, so enabling it here would turn it on in production with zero code change and silently break the paywall (an ACH subscription stays `active` after a failed debit). The Checkout Session passes `excluded_payment_method_types: ['us_bank_account']` as a belt-and-braces guard; §10.8 lists the nine changes required before ACH can ever be switched on.
10. Set `BILLING_ENFORCEMENT_ENABLED=true` and `NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED=true` in Vercel prod. Redeploy.
11. Decide and log the **refund policy** in the pricing doc (Jobber: none prorated; Housecall Pro: 30-day money-back). Refunds themselves are Dashboard actions.

## 21. Out of scope / follow-ups

- **Phase 2:** self-serve signup (own spec; needs the domain/umbrella decision recorded).
- **Phase 3:** trial email sequence, setup-call link, 90-day retention warning + deletion job, **data export** (CSV of customers, bookings, payments), cancellation save offers (one offer max under California's auto-renewal law), tenant health signals on the roster.
- **Soft-deactivate cleaner** (frees a seat without deleting history).
- **Per-tier feature gates.**
- **RLS hardening:** once no client writes remain on the Phase 1a tables, tighten their write policies to service-role only.
- **Atomic service-with-checklists RPC.**
- **Self-serve pause** inside a cancellation flow.
- **Annual prepay by invoice** (`collection_method: send_invoice`), referral credits, role-split back-office permissions.
- **ACH Direct Debit for subscriptions.** Deferred 2026-09-22 with the reasoning, the fee
  arithmetic and the nine prerequisite changes recorded in §10.8. Worth revisiting once annual
  plans carry volume, where the saving is $23 to $44 per invoice rather than $13 to $46 a year.
- **Annual renewal reminder email** (15 to 45 days before renewal). Required for auto-renewing
  subscriptions by California's Automatic Renewal Law, which is in force and is not affected by
  the vacated federal click-to-cancel rule. This is an email, so it belongs with the Phase 3
  sequence, but it is a compliance obligation rather than a nice-to-have and currently has no owner.
- **Platform suspend independent of Stripe.** A `suspended_at` stamp set from the back office, frozen at the same precedence as `paused`, for abuse or non-payment on a trialing or comped org. Phase 1 has no lever to shut off an org that has no subscription other than deleting it.
- **Manual plan or seat override** for a tenant that pays by invoice or check. Phase 1 truths `plan_tier` and `seat_count` from webhooks only; comp covers these tenants until this exists.

## 22. Open items to verify at plan time

1. ~~Manager permission key that gates service/checklist writes today~~ **Resolved at plan time (2026-09-12):** migration 104 gates `service_types` on `can_manage_services` and `properties` on `can_edit_properties`; checklists carry no flag in RLS but the services page already hides them behind `can_manage_services`, so the checklist routes use it; bookings use `can_edit_bookings`. Routes call the existing `requireManagerPermission` helper.
2. Whether `src/lib/settings.ts` (legacy sections list) is still consumed anywhere; if so, add `billing` there too.
3. Exact `inv_status` enum values for the pending-invite count (`pending`, possibly `creating`).
4. Stripe SDK version in `package.json` supports `integration_identifier` (API ≥ 2026-03-25) and `pause_collection` resume via empty string; bump if needed.
5. The `platform_audit_log` write helper used by `impersonation/route.ts`, to reuse for the new actions.
6. `APP_URL` is set in every environment (checkout success/cancel URLs must be absolute and never built from the request host).
7. **Pricing review 2026-09-09, confirmed by Bridger 2026-09-12** and logged in the pricing doc addendum: (a) annual plans are one upfront charge per year ($348 / $948 / $1,668), not monthly billing on a 12-month commitment; (b) the annual seat price is $120/yr (12 × $10, no annual discount on seats); (c) Pro's marketing bullet changes from "Unlimited cleaner seats" to "No seat limit" (one-line change in `pricing.ts`, lands in PR D with the catalog).
