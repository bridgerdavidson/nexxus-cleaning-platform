# PR E Fix Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix three money bugs in PR E (`feat/phase1b-stripe-billing`, #278) that two independent Fable reviews found, before PR F is built on top of them.

**Architecture:** Three focused changes to already-reviewed code. No new files, no migration. Each is independently testable.

**Tech Stack:** Stripe Node SDK `20.1.2` pinned at `apiVersion: '2025-12-15.clover'`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-saas-billing-design.md` (§10.4 plan changes, §10.7 webhooks, §10.1 price catalog)

**Branch:** `feat/phase1b-stripe-billing`. This is PR #278, which is OPEN and previously green. Work directly on it; do NOT branch off it.

---

## Why this exists

PR E's tests mock every Stripe call, so they encoded our assumptions rather than Stripe's
behaviour and passed while three real defects sat underneath. All three were found by review
and confirmed against the pinned SDK and the live code.

## Global Constraints

- **Money is integer cents.** Never float.
- **No em dashes in user-facing strings.** Error messages count.
- **Never pass `payment_method_types`** to Stripe.
- **Never `new Stripe()`**; use `getStripe()`.
- Every changed function keeps or gains a test that would FAIL against the old behaviour.
- **Pre-push:** `npm run test`, `npx tsc --noEmit`, `npm run lint`.
- **Commit trailer:**
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
  ```

---

### Task 1: Bill upgrades immediately **[Opus]**

**The bug.** `updateSubscriptionItems` (`src/lib/stripe/billing.ts:227-233`) passes
`proration_behavior: 'create_prorations'` and nothing else. Stripe creates proration line
items but does **not** invoice them; they wait for the next scheduled invoice. Consequences:

- Monthly upgrade: the extra money arrives one cycle late.
- **Annual upgrade: the extra money arrives up to a year late.** A Growth annual customer going
  8 to 15 seats in month two receives roughly $840 of extra seats before a single charge.
- A plan change while `past_due` or `unpaid` mints credit balance out of time the customer has
  not paid for.

Spec §10.4 claims "immediate, prorated, both directions", which is false today.

**Files:**
- Modify: `src/lib/stripe/billing.ts` (`updateSubscriptionItems`)
- Modify: `src/app/api/billing/plan/route.ts` (refuse changes while unpaid; pass direction)
- Modify: `src/lib/stripe/billing.test.ts`, `src/app/api/billing/plan/route.integration.test.ts`

**The policy to implement.** Decide direction by comparing `planChargeCents` for the current
stored plan against the requested one:

| Case | `proration_behavior` | Invoice now? |
|---|---|---|
| Upgrade (new charge > current) | `always_invoice` | Yes, plus `payment_behavior: 'error_if_incomplete'` so a declined card fails the request instead of silently leaving them upgraded and unpaid |
| Downgrade (new charge < current) | `create_prorations` | No. The credit lands on the next invoice. We do not refund cash |
| Interval switch to annual | `always_invoice` | Yes. They are buying a year |
| Interval switch to monthly | `create_prorations` | No |
| Identical charge (seat shuffle at same price) | `create_prorations` | No |

**Refuse entirely while `past_due` or `unpaid`.** Return `409` with
`{ error: 'billing_payment_required' }` and the message
`Please update your payment method before changing your plan.` Stripe's own guidance is to
avoid prorating against unpaid time, and it prevents minting credit from it.

- [ ] **Step 1: Write the failing wrapper tests**

Extend `src/lib/stripe/billing.test.ts`. Use the existing helpers in that file
(`checkoutInput()` / `createdParams()` style; read the file first and match its conventions).

```ts
it('invoices an upgrade immediately and fails closed on a declined card', async () => {
  await updateSubscriptionItems('sub_1', items, 'org_1', { invoiceNow: true })
  const params = subscriptionsUpdate.mock.calls[0][1]
  expect(params.proration_behavior).toBe('always_invoice')
  expect(params.payment_behavior).toBe('error_if_incomplete')
})

it('defers a downgrade to the next invoice and never charges now', async () => {
  await updateSubscriptionItems('sub_1', items, 'org_1', { invoiceNow: false })
  const params = subscriptionsUpdate.mock.calls[0][1]
  expect(params.proration_behavior).toBe('create_prorations')
  expect(params).not.toHaveProperty('payment_behavior')
})
```

- [ ] **Step 2: Run them and verify they fail**

Run: `npx vitest run src/lib/stripe/billing.test.ts`
Expected: FAIL. `updateSubscriptionItems` takes three arguments today and always sends
`create_prorations`.

- [ ] **Step 3: Implement the wrapper change**

```ts
export async function updateSubscriptionItems(
  subscriptionId: string,
  items: Stripe.SubscriptionUpdateParams.Item[],
  organizationId: string,
  opts: { invoiceNow: boolean },
): Promise<Stripe.Subscription> {
  const params: Stripe.SubscriptionUpdateParams = {
    items,
    metadata: { organization_id: organizationId },
    proration_behavior: opts.invoiceNow ? 'always_invoice' : 'create_prorations',
  };
  if (opts.invoiceNow) {
    // Fail closed: a declined card must reject the change rather than leave the
    // customer upgraded with an unpaid invoice.
    params.payment_behavior = 'error_if_incomplete';
  }
  return getStripe().subscriptions.update(subscriptionId, params);
}
```

`opts` is required, not optional. A required argument forces every existing call site to state
its intent, which is the point.

- [ ] **Step 4: Implement the route change**

In `src/app/api/billing/plan/route.ts`, after the auth check and before touching Stripe:

1. Read the org's current `plan_tier`, `billing_period` and `seat_count` (the route already
   loads the org row for `readLiveSubscription`; reuse it rather than adding a query).
2. Refuse while the mirrored status is `past_due` or `unpaid`, with the 409 above.
3. Compute `invoiceNow` per the table. When the stored tier or period is null (a first
   purchase), the route already routes to Checkout, so this path only runs for live
   subscriptions and both values are present; if either is unexpectedly null, treat it as an
   upgrade (`invoiceNow: true`), which fails safe toward charging rather than not charging.
4. Pass `{ invoiceNow }` into `updateSubscriptionItems`.

- [ ] **Step 5: Update the preview endpoint's contract note**

`POST /api/billing/plan/preview` does not exist yet; it is PR F Task 4. Leave a comment in
`plan/route.ts` above the `invoiceNow` computation reading:

```ts
// PR F's preview endpoint MUST use this same direction logic, or the amount it
// quotes will not match the amount charged. Extract this into a shared helper
// when that endpoint lands.
```

- [ ] **Step 6: Run everything and commit**

Run: `npx vitest run src/lib/stripe/billing.test.ts && npm run test:integration -- billing/plan && npx tsc --noEmit`

```bash
git add src/lib/stripe/billing.ts src/app/api/billing/plan/route.ts \
        src/lib/stripe/billing.test.ts src/app/api/billing/plan/route.integration.test.ts
git commit -m "fix(billing): bill upgrades immediately, refuse plan changes while unpaid"
```

---

### Task 2: Read the renewal date from the subscription item **[Opus]**

**The bug.** `dispatchStripeEvent.ts:1703-1709` reads `current_period_end` off the Subscription
object, with a comment noting the field "has moved across Stripe API versions". It has: in our
pinned SDK `current_period_end` **does not exist on `Subscription` at all**. It exists only on
`SubscriptionItem` (`node_modules/stripe/types/SubscriptionItems.d.ts:53`). So `cpe` is always
`undefined` and `organizations.subscription_current_period_end` is **null for every
subscriber**. The defensive read prevents a crash; it does not get the value.

The D/E tests pass only because they fabricate the top-level field.

**Files:**
- Modify: `src/lib/payments/dispatchStripeEvent.ts` (around line 1703)
- Modify: the webhook's test file

- [ ] **Step 1: Write the failing test**

Find the existing `handleSubscriptionUpsert` test and add a case whose fixture has **no**
top-level `current_period_end` and instead carries it on the item, which is what Stripe
actually sends on this API version:

```ts
it('mirrors the renewal date from the subscription item, not the subscription', async () => {
  await handleSubscriptionUpsert(supabase, {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    items: { data: [{ id: 'si_1', current_period_end: 1792000000,
                      price: { lookup_key: 'growth_monthly' }, quantity: 1 }] },
  } as unknown as Stripe.Subscription, 'evt_1', 'customer.subscription.updated')

  const org = await readOrg('org_1')
  expect(org.subscription_current_period_end).toBe(new Date(1792000000 * 1000).toISOString())
})
```

Also **fix the existing tests that fabricate the top-level field**. They are asserting a shape
Stripe does not send, which is how this got through. Move the field onto the item in every
subscription fixture in that file.

- [ ] **Step 2: Run it and verify it fails**

Run: `npm run test:unit -- dispatchStripeEvent`
Expected: FAIL, the mirrored value is null.

- [ ] **Step 3: Implement**

```ts
  // current_period_end moved from Subscription to SubscriptionItem. On the pinned
  // API version (2025-12-15.clover) it exists ONLY on the item, so read the item
  // first and keep the top-level read as a fallback for older payloads and for
  // any replayed historical event.
  const subAny = sub as unknown as {
    current_period_end?: number
    items?: { data?: Array<{ current_period_end?: number }> }
  };
  const cpe =
    subAny.items?.data?.[0]?.current_period_end ??
    subAny.current_period_end;
```

Leave the existing `cpe ? new Date(cpe * 1000).toISOString() : null` line untouched.

- [ ] **Step 4: Run and commit**

Run: `npm run test:unit -- dispatchStripeEvent && npx tsc --noEmit`

```bash
git add src/lib/payments/dispatchStripeEvent.ts
git commit -m "fix(billing): read the renewal date from the subscription item"
```

---

### Task 3: Stop classifying subscriptions by lookup key alone **[Opus]**

**The bug.** `readCurrentItems` (`src/app/api/billing/plan/route.ts:49`) identifies a
subscription's plan line from `item.price.lookup_key`, and throws
`This subscription has no plan line we recognize` when it cannot (line 61-63).

`scripts/stripe-billing-setup.ts` instructs, in its header comment (line 27) and its closing
console output (line 347), that a price change is made by creating a new Price with
`transfer_lookup_key: true`. That flag **moves the lookup key off the old Price**. Every
existing subscriber is still billed on the old Price, which now has no lookup key. The moment
anyone follows the script's own instructions:

- those customers can never change tier or seats again (the route throws), and
- `readPlanFromItems` returns null, so webhook mirroring of `plan_tier`, `billing_period` and
  `seat_count` silently stops for them.

This is latent today because no price has ever been rotated, and cheap to fix while PR E is
unmerged and nobody is subscribed.

**Files:**
- Modify: `src/app/api/billing/plan/route.ts` (`readCurrentItems`)
- Modify: `src/lib/payments/orgBilling.ts` (`readPlanFromItems`, if it keys on lookup_key too)
- Modify: `scripts/stripe-billing-setup.ts` (the two guidance passages)
- Modify: the corresponding tests

- [ ] **Step 1: Decide the classification key**

The setup script already creates **one Stripe Product per tier** plus one for seats
(spec §10.1), and stamps `metadata.nexxus_lookup_key` on each Price (`setup script:177`).
Both survive a lookup-key transfer. Classify in this order:

1. `price.lookup_key` when present (fast path, unchanged for the common case);
2. otherwise `price.metadata.nexxus_lookup_key`;
3. otherwise the Product id, mapped back to a tier through the catalog.

Only throw when all three fail. Read the setup script first to confirm the exact metadata key
and Product naming before implementing.

- [ ] **Step 2: Write the failing test**

```ts
it('still recognises a plan line whose lookup key was transferred away', async () => {
  const sub = {
    id: 'sub_1',
    items: { data: [{ id: 'si_base', quantity: 1,
      price: { lookup_key: null, metadata: { nexxus_lookup_key: 'growth_monthly' } } }] },
  }
  expect(() => readCurrentItems(sub as never)).not.toThrow()
  expect(readCurrentItems(sub as never).basePriceLookupKey).toBe('growth_monthly')
})
```

- [ ] **Step 3: Run it and verify it fails**

Run: `npm run test:integration -- billing/plan`
Expected: FAIL, throws "no plan line we recognize".

- [ ] **Step 4: Implement, and move the function**

While changing it, **export `readCurrentItems` from a shared module** rather than leaving it
private to the route. PR F Task 4 needs the identical logic for its preview endpoint, and two
copies that can drift is exactly how the preview would come to quote a different plan than the
change applies. Put it beside `diffSubscriptionItems` in `src/lib/billing/`, import it in the
route, and keep the route's behaviour and error message identical.

- [ ] **Step 5: Correct the setup script's guidance**

Both passages currently recommend `transfer_lookup_key: true`. Replace with: create the new
Price with a fresh lookup key and leave the old Price untouched and active, so existing
subscribers keep billing on it and stay classifiable. Note that the catalog resolver finds the
new key for new purchases. Keep the warning against archiving a Price that has subscribers.

- [ ] **Step 6: Run and commit**

Run: `npm run test && npx tsc --noEmit && npm run lint`

```bash
git add src/app/api/billing/plan/route.ts src/lib/billing/ src/lib/payments/orgBilling.ts \
        scripts/stripe-billing-setup.ts
git commit -m "fix(billing): classify plan lines without depending on lookup key"
```

---

## Not doing, and why

- **"Expired invites hold seats"** was raised in review and **rejected on inspection.** The
  `invites` table has no `expires_at` column (the one in migration 065 is on
  `homeowner_payment_links`), `'expired'` is a real `InviteStatus` that `.eq('status','pending')`
  already excludes, and a pending invite reserving a seat is spec §9's deliberate design
  ("Pending invites reserve a slot so twenty invites cannot land at a five-seat cap"). The
  operator frees it by cancelling the invite. No change.
- **Everything the reviews found in the platform back office** (tenant delete not cancelling
  the subscription, `unpaid` having no recovery path, un-comp landing frozen, admin pause
  voiding a full annual period). Those are PR G's and are recorded for its plan. The tenant
  delete one is the most serious: it keeps charging a deleted tenant's card. **PR G must not
  ship without it.**

## After this lands

1. Push and let #278 go green.
2. `git rebase` the `feat/phase1b-billing-ui` branch onto the updated PR E branch.
3. Update spec §10.4, whose "immediate, prorated, both directions" claim is what Task 1 makes
   true, and §10.8 item 8, which currently asserts the opposite of the old behaviour.
4. Revise the PR F plan: its "Due today" copy becomes correct for upgrades only, and the
   preview endpoint must reuse Task 1's direction logic and Task 3's shared `readCurrentItems`.
