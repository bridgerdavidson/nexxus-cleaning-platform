# Homeowner Slice 4 (Account) Implementation Plan

> **Execution:** controller-driven subagent-driven-development in this session (dispatch flakiness observed this session; heavy reuse). Code is written at implementation time against the cited precedents/hooks (verified in the scope pass). One branch `feat/homeowner-account-slice4`, one PR, small commits per task. Ledger: `.superpowers/sdd/progress.md`.

**Goal:** Build the homeowner **Account** tab (hub + Profile, Properties, Payment methods, Receipts, Browse services), finishing the homeowner redesign surface.

**Architecture:** `/account` hub (grouped `ProfileRow`s) → one sub-route per area under `/account/`; detail/add/edit via `?param=` + `MobileTakeover`/vaul `Drawer`, Container/`*View`/`derive*`+test split. Reuse existing hooks/routes; presentation fresh from the design system.

**Spec:** `docs/superpowers/specs/2026-07-02-homeowner-slice4-account-design.md`.

## Global Constraints
- Design system only (`src/components/ui/*` + tokens); brand `#0150FC`; **no** raw hex, **no** `primary-<number>` (legacy yellow), semantic shades `-50`/`-700`; **no** legacy yellow `#F7C41E` (avatar especially); **no** em dashes in copy; **no** "operator" in homeowner copy.
- Never import `lib/supabase-admin` from client code. Stripe UI behind `stripeNewChargeFlowUiEnabled()`.
- Reuse LOGIC/hooks; build presentation fresh (no legacy component imports except headless helpers/hooks and `RequestAppointmentButton`).
- Phone-first (`max-w-lg`, `MobileTakeover`, vaul `Drawer`). Container holds hooks + pure `derive*`; `*View` is props-only; `derive*` has a co-located `*.test.ts`.

## UI implementation & styling source
Scope reports + any mockups are UX/structure reference ONLY. Implement every screen from `src/components/ui/*` + tokens. Reuse the shipped homeowner slices (`cleanings/*`) and the cleaner precedents (`redesign/cleaner/profile/*`). Run ui-ux-pro-max at implementation for design-system conformance.

---

## Task 0 , Account shell: layout hosts + hub + sub-route scaffolding
- **Create** `src/app/(redesign)/app/homeowner-dashboard/account/layout.tsx` , renders `{children}` + (later) mounts the per-area `*Host` takeovers under `<Suspense>` so `?param=` detail works across the area pages. (Hosts added by each area task.)
- **Rewrite** `account/page.tsx` , the hub: `HomeownerAccountHub` container → `HomeownerAccountHubView` (grouped `ProfileRow`s: **Account** → Profile; **Your cleanings** → Properties, Payment methods (only when `stripeNewChargeFlowUiEnabled()`), Receipts, Browse services; a bottom **Sign out** row → confirm `Drawer` → `useAuth().signOut()` local). Each row links to its sub-route.
- **Create** sub-route pages: `account/profile/page.tsx`, `account/properties/page.tsx`, `account/payment-methods/page.tsx`, `account/receipts/page.tsx`, `account/services/page.tsx` , each renders its area Container (stubs until the area task lands; scaffold with a back link + title using a small shared `AccountSubHeader`).
- **Create** `src/components/redesign/homeowner/account/AccountSubHeader.tsx` (back chevron → `/account`, title) and `HomeownerAccountHub(.View).tsx` + `deriveAccountHub`? (hub rows are static; no derive/test needed unless the Stripe-gate makes the list dynamic , keep the gate in the container).
- **Test:** none (static nav) beyond typecheck.
- **Commit:** `feat(homeowner-account): account hub + sub-route scaffolding`.

## Task 1 , Profile (mirror cleaner Profile)
- **Files:** `src/components/redesign/homeowner/account/profile/` , `HomeownerProfile.tsx` (container: `useAuth` name/phone/avatar/dirty/saving, `updateProfile`, `signOut`), `HomeownerProfileView.tsx` (avatar via shared `AvatarEditor`, first/last name, phone `Input` (`normalizePhoneToDigits`/`formatPhoneDisplay`), read-only email + "Contact support to change it", `SettingsSaveBar` when dirty, a **Change password** `ProfileRow` → reuse `ChangePasswordDialog`, **Sign out** row), `deriveHomeownerProfile.ts` (+ `.test.ts`: display name + initials via `personInitials`, dirty-diff).
- **Reuse:** `redesign/cleaner/profile/{CleanerProfile,CleanerProfileView,deriveProfile,ProfileRow,ChangePasswordDialog}`, `redesign/shared/AvatarEditor`, `useImageUpload` (avatar context), `src/lib/phone.ts`, `src/lib/initials.ts`.
- **Wire:** `account/profile/page.tsx` → `HomeownerProfile`.
- **Test:** `deriveHomeownerProfile.test.ts`.
- **Commit:** `feat(homeowner-account): profile (name/phone/avatar/change-password/sign-out)`.

## Task 2 , Properties list + detail
- **Files:** `src/components/redesign/homeowner/account/properties/` , `HomeownerProperties.tsx`, `HomeownerPropertiesView.tsx`, `PropertyRow.tsx`, `derive-properties.ts`(+test), `useOpenProperty.ts`, `HomeownerPropertyDetailHost.tsx`, `HomeownerPropertyDetail.tsx` (read-only takeover; Edit/Delete buttons).
- **Reuse:** `useHomeownerProperties`; legacy LOGIC from `PropertyCard`/`PropertySidePanel`/`PropertiesPage`.
- **Also:** extend `useHomeownerProperties` select + `Property` type in `src/hooks/useHomeownerData.ts` to include `special_instructions, access_instructions`.
- **Mount** `HomeownerPropertyDetailHost` in the account layout (or the properties page) under `<Suspense>`.
- **Test:** `derive-properties.test.ts` (sort/section, isEmpty).
- **Commit:** `feat(homeowner-account): properties list + detail`.

## Task 3 , Properties add / edit / delete
- **Files:** `HomeownerPropertyEditSheet.tsx` (vaul `Drawer`; add + edit form; fields per §3.1; `PropertyPhotoUploadInline.tsx` reusing `useImageUpload`/`uploadOne` + the legacy validation constants), `HomeownerPropertyDeleteSheet.tsx`.
- **Reuse:** create via `supabase.from('properties').insert`; `updateProperty`/`deleteProperty` (`useAdminData`); `AddPropertyModal` LOGIC (multi-field form + photo, WITHOUT the sessionStorage draft).
- **Wire:** detail Edit → edit sheet; Delete → delete confirm; list "Add property" → add sheet; refetch on success; toast.
- **Test:** a small pure validator (`validateProperty`) `*.test.ts` (required fields).
- **Commit:** `feat(homeowner-account): properties add/edit/delete`.

## Task 4 , Receipts (read-only)
- **Files:** `src/components/redesign/homeowner/account/receipts/` , `HomeownerPaymentHistory.tsx`, `HomeownerPaymentHistoryView.tsx`, `PaymentRow.tsx`, `derive-payments.ts`(+test: status→label/tone mapping + section/sort), `useOpenPayment.ts`, `PaymentReceiptHost.tsx`, `PaymentReceipt.tsx` (takeover, `?payment=`).
- **Reuse:** `useHomeownerPayments`; `money2`/`longDate` from `redesign/payments/payments-presenters`; `Badge` variants (positive/caution/critical/info). Read-only; gross amount only.
- **Test:** `derive-payments.test.ts` (all 5 statuses → correct label/tone; empty).
- **Commit:** `feat(homeowner-account): payment history + receipt detail`.

## Task 5 , Browse services (mirror cleaner catalog)
- **Files:** `src/components/redesign/homeowner/account/services/` , `HomeownerServices.tsx`, `HomeownerServicesView.tsx`, `useOpenService.ts`, `HomeownerServiceDetailHost.tsx`, `HomeownerServiceDetail.tsx` (takeover, `?service=`, "Request this cleaning" → `RequestAppointmentButton` restyled, preselect service if the prop supports it). Reuse `deriveServices` helpers directly; add `derive-homeowner-services.ts` only if extra shaping is needed (+test if added).
- **Reuse:** `useServices`/`useService`; `redesign/services/deriveServices` (`formatPrice`/`formatDuration`/`priceRangeLabel`/`serviceTypeLabel`); the cleaner `CleanerServicesCatalog`/`CleanerServiceDetail` as the presentational precedent; `RequestAppointmentButton` for the CTA.
- **Test:** reuse existing `deriveServices.test.ts`; add one only if a new helper is introduced.
- **Commit:** `feat(homeowner-account): browse services catalog + detail`.

## Task 6 , Payment methods + set-default route
- **Backend first:** add `PATCH` handler to `src/app/api/stripe/my-payment-methods/route.ts` (set default; mirror the org route's set-default; Bearer-auth → `stripe_customer_id` → `setDefaultPaymentMethod`). Extend `route.integration.test.ts` (success, missing id, not-owned/404, unauthorized).
- **Files:** `src/components/redesign/homeowner/account/payment-methods/` , `HomeownerPaymentMethods.tsx`, `HomeownerPaymentMethodsView.tsx`, `PaymentMethodCard.tsx`, `useListPaymentMethods.ts` (GET), `usePaymentMethodActions.ts` (DELETE + PATCH), `derive-payment-methods.ts`(+test: default vs other, isEmpty), `AddPaymentMethodSheet.tsx` (vaul Drawer wrapping the Stripe Elements panel; `create-setup-intent`→`confirm-setup-intent`; 3DS `if_required`), `RemoveConfirmSheet.tsx`.
- **Reuse:** `GET/DELETE /api/stripe/my-payment-methods`, `create-setup-intent`/`confirm-setup-intent`, `AddPaymentMethodPanel` LOGIC, `stripe/customers/homeowner` helpers.
- **Gate:** entire area behind `stripeNewChargeFlowUiEnabled()`; hub row hidden when off. Prompt to set a new default if the removed card was the default.
- **Test:** `derive-payment-methods.test.ts` + the route integration test.
- **Commit:** `feat(homeowner-account): saved payment methods (list/add/remove/set-default) + PATCH route`.

## Task 7 , Conformance + review + visual
- ui-ux-pro-max implementation-phase conformance pass (no raw hex / legacy yellow / `primary-<number>`; touch targets; tokens).
- Gates: `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`; integration for the PATCH route (needs local Supabase) or note CI will run it.
- Independent adversarial review over the branch; fix Critical/Important.
- Visual on dev (homeowner John Doe, phone width): hub → each area → detail/add/edit; send screenshots (user on mobile).
- **PR** to master (user-gated merge).

## Self-review (spec coverage)
Properties (§3.1)→T2/T3; Payment methods (§3.2)→T6; Receipts (§3.3)→T4; Browse services (§3.4)→T5; Profile (§3.5)→T1; hub+nav (§2)→T0. Backend delta (§5): PATCH route→T6, properties select extension→T2. Decisions (§7): sub-routes→T0, CTA→T5, local sign-out→T0/T1.
