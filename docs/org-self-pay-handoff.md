# Organization Self-Pay — Implementation Handoff

Resume doc for the `feat/org-self-pay` feature. Pairs with:
- **Full design/plan:** `~/.claude/plans/i-want-to-brainstorm-cozy-squirrel.md` (the brainstormed design, UI/UX specs per surface, build sequence, test plan, verification).
- **Memory:** `project_org_self_pay`, `feedback_ui_native_verify`, `project_dev_testing_env`, `project_connected_transfer_constraint`, `project_stripe_restructure`.

Goal recap: let an org own homeowner-less properties and pay for a cleaning on **any** property out of its **own company card**, settling 100% to the cleaner (cleaner cut grossed-up for Stripe fees, no platform fee, no tenant remainder). Two axes: `properties.owner_id` nullable (NULL = org-owned), `appointments.is_self_pay`. Flag: `STRIPE_SELF_PAY_ENABLED` (+ `NEXT_PUBLIC_` mirror), which implies `STRIPE_NEW_CHARGE_FLOW_ENABLED`.

## Status: backend + org-card UI DONE and verified; booking modal + polish REMAIN

Type-clean (project baseline 20 pre-existing tsc errors, 0 introduced). 222 unit tests green. Migration `077` applied clean to local Docker Supabase. Two surfaces Playwright-verified seamless (settings company-card section; AddPropertyModal ownership toggle).

### Done (committed)
- **Flags** `src/lib/stripe/flags.ts`: `stripeSelfPayEnabled()` / `stripeSelfPayUiEnabled()` (+ documented new-charge-flow dependency).
- **Migration** `supabase/migrations/077_org_self_pay.sql`: `properties.owner_id` + `appointments.homeowner_id` + `recurring_appointment_series.homeowner_id` → nullable; `is_self_pay` on appointments/recurring/payments/payouts; CHECK `is_self_pay OR homeowner_id IS NOT NULL` on appointments + recurring; `organizations.stripe_self_pay_customer_id` + partial unique index; re-created all four `properties_*` RLS policies with the org-membership branch for `owner_id IS NULL`; redefined `admin_dashboard_stats` + `payment_stats` to exclude self-pay from revenue.
- **Types** `src/types/index.ts` + `src/lib/supabase.ts`: nullable `owner_id`/`homeowner_id`, `is_self_pay` on Appointment/Payment/Payout/RecurringAppointmentSeries.
- **Money math** `src/lib/payments/selfPayMath.ts` (+ `.test.ts`, 8 tests): `cleanerCutCents = floor(gross*pct/100)`; `chargeCents = ceil((cut + 30) / (1 - 0.029))`; constants `STRIPE_PERCENT_FEE`/`STRIPE_FIXED_FEE_CENTS`.
- **Charge/settle siblings** (legacy + tenant paths untouched): `src/lib/stripe/charges/authorizeSelfPay.ts` (platform charge, org Customer, NO `on_behalf_of`, `metadata.self_pay='true'`, key `selfpay-auth-${id}-${attempt}`); `src/lib/payments/authorizeSelfPayAppointment.ts`; `src/lib/payments/settleSelfPay.ts` (one cleaner transfer of the exact recomputed cut, key `selfpay-cleaner-${id}`, idempotency guard on an existing paid payout).
- **Webhook** `src/lib/payments/dispatchStripeEvent.ts`: branch on `paymentIntent.metadata?.self_pay === 'true'` → `settleSelfPay`, placed BEFORE the `on_behalf_of` check.
- **Cancel** `.../[appointmentId]/cancel/route.ts`: self-pay always releases the hold (fee=0), skips `computeCancellationFee`.
- **Authorize dispatcher** `src/lib/payments/authorizeDispatch.ts` (`authorizeAppointmentAuto`): routes on `is_self_pay`. Wired into `appointments/confirm/route.ts` (gate broadened to fire on `is_self_pay` too), `.../[appointmentId]/authorize/route.ts` (+ HTTP codes for `no_org_card`/`cleaner_not_payable`), and `cron/authorize-due/route.ts` (section A query broadened to `.or('payment_method_id.not.is.null,is_self_pay.eq.true')` so card-less self-pay jobs get picked up; both authorize calls use the dispatcher).
- **Org card routes** `src/app/api/stripe/org/{create-setup-intent,confirm-setup-intent,saved-payment-methods}/route.ts` + helper `src/lib/auth/requireOrgPaymentsAuth.ts` (owner/admin pass; manager needs `can_manage_payments`). Persist `organizations.stripe_self_pay_customer_id`.
- **Settings UI** `src/components/OrgPaymentMethodSection.tsx` wired into `src/app/settings/payments/page.tsx` behind the flag + `can_manage_payments`. Playwright-verified seamless.
- **Badges** `src/components/StatusBadge.tsx`: `self_pay` (`DollarSign`, `bg-primary-100 text-primary-700`) and `org_owned` (`Building2`, `bg-blue-50 text-blue-700`) variants.
- **AddPropertyModal** `src/components/AddPropertyModal.tsx`: "Who owns this property?" toggle in step 1 (gated by `stripeSelfPayUiEnabled()`); "Owned by us" hides the homeowner picker, inserts `owner_id: null`. Playwright-verified seamless.

### Divergences from the plan (IMPORTANT — do not re-derive against the old plan)
1. **No `payment_type='self_pay'` enum value.** The repo deliberately avoids `ALTER TYPE ... ADD VALUE` (see 065). Self-pay charge rows are `payment_type='revenue'` + **`is_self_pay=true`**. Revenue stats exclude via `AND is_self_pay = false` (both `admin_dashboard_stats` and `payment_stats` redefined in 077). Anywhere the plan says `payment_type='self_pay'`, the real discriminator is the **`is_self_pay` boolean**.
2. **`stripe_self_pay_customer_id`** is a dedicated column (the open decision was resolved in favor of isolation, not reusing `stripe_customer_id`).
3. **AddPropertyModal** keeps the step COUNT stable: the ownership toggle lives inside step 1 and conditionally hides the homeowner picker (cleaner + lower-risk than "remove the homeowner step / decrement the step bar"). Validation: `isStep1Valid = ownershipMode === 'org' || selectedHomeowner !== null`.
4. **capture and refund routes need NO change**: self-pay rows are `payment_type='revenue'`, so the existing `payment_type='revenue'` lookups already find them. Settlement runs via the webhook branch, not the capture route.
5. **`authorizeDispatch.ts`** is the single fork point (the plan implied per-call-site branches).

## Remaining work

### 1. `AddAppointmentModal.tsx` (the big one) — design = plan UI/UX surfaces 1–5
This file is the most complex in the feature. Structural gotchas to respect:
- It has **mobile sub-steps** (`mobileSubStep` = "homeowner" | "property") and **three pre-selection modes** (homeowner-only, homeowner+property, neither) that shift the step numbering. Any new control must handle all of them.
- Local `interface Property { ... owner_id: string }` (~L44) assumes non-null; make it `string | null`.
- `fetchProperties` (~L364) filters `.eq('owner_id', ownerId)` — in self-pay mode fetch ALL org properties `.eq('organization_id', orgId)` instead.
- `fetchCleaners` (~L463) — extend the select to `payout_model, stripe_connect_onboarding_complete, payout_percent` for the payout-capable gate.
- `handleCreateAppointment` (~L571) + the insert (~L713 `homeowner_id: selectedHomeowner.id`) — insert `homeowner_id: selfPay && orgOwned ? null : selectedHomeowner.id`, `is_self_pay: selfPay`. Keep setting `authorize_at` so the JIT cron picks up self-pay jobs.
- `AppointmentPaymentSection` (+ `DEFER_CARD`) is the homeowner card picker — hide it in self-pay mode; show the company-card summary / empty-state instead.
- Build to the native patterns: bill-to selectable cards (surface 1), all-properties picker with `StatusBadge org_owned` (surface 2), disabled non-payable cleaner rows + amber "Not payout-ready" badge (surface 3), money-transparency panel using a client port of `selfPayMath` (surface 4), company-card summary (surface 5). Gate everything behind `stripeSelfPayUiEnabled()`; restrict self-pay to owner/admin or `can_manage_payments` manager.

### 2. Smaller pieces
- **Property-edit attach-homeowner:** grep `from('properties').update` (likely `EditPropertyModal` or a customer/property page); add an "Attach homeowner" picker that sets `owner_id`. RLS UPDATE branch already permits org staff.
- **Badge wiring:** render `<StatusBadge status="self_pay" />` on `AppointmentCard.tsx`, `AppointmentSidePanel.tsx`, and payment rows; `org_owned` wherever owner/property is shown.
- **Client revenue fallbacks:** audit `src/hooks/useAdminData.ts` (`useAdminStats`/`usePaymentStats` legacy multi-query paths) to exclude `is_self_pay` rows from revenue.
- **Integration tests** (plan test plan): org setup-intent role gating; self-pay booking route; capture/webhook → `settleSelfPay` one transfer / no tenant remainder; cancel release-only; RLS org-owned visibility. Extend `tests/helpers/fixtures.ts` `createTestAppointment` with `selfPay?`/`orgOwnedProperty?`. Local Docker Supabase already has 077.
- **Full Playwright + ui-ux-pro-max pass** over every new surface (plan Verification step 5).

## Verification recipe (Playwright, learned this session)
- Dev login creds are in `.env.development.local`: `E2E_TEST_USER_EMAIL_ADMIN=admin@nexxus.com` / `E2E_TEST_USER_PASSWORD_ADMIN=Admin123!` (also MANAGER/CLEANER/HOMEOWNER suffixes). Self-pay flags appended there too.
- Login: `browser_navigate` to `/login` → `browser_fill_form` `input[type="email"]` + `input[type="password"]` → click `button[type="submit"]` → wait ~3s, lands on `/admin-dashboard`.
- Dashboard nav: the matched nav button may be a hidden mobile duplicate (`element is not visible`). Click the visible one via `browser_evaluate`: find the `button` whose exact text matches and `offsetParent !== null`, then `.click()`. Properties tab = `?tab=properties`; the top-right **"+ New"** button (text "New") opens `AddPropertyModal`.
- Settings company card: `/settings/payments`.
- **CAVEAT:** `npm run dev` points at the **remote dev Supabase** (ref `suaezjtspglgulunkyip`), which does **not** have migration 077 until the branch is pushed (CI `Migrate / migrate-dev`). So self-pay DATA calls return empty/500 there — the live pass verifies **visual seamlessness** only. Functional correctness is the **local integration tests** (local Docker has 077). After push, full data flow works on the dev/preview.

## Commands
- `npx supabase db reset` — rebuild local DB with 077 (needs Docker).
- `npm run test` / `npm run test:unit` / `npm run test:integration` — Vitest.
- `npx tsc --noEmit` — type-check (filter for self-pay files; baseline is 20 pre-existing errors).
- `npm run lint` — ESLint.
