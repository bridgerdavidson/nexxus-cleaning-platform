# Homeowner Slice 4: Account — Design

**Status:** design (awaiting user approval before the implementation plan)
**Date:** 2026-07-02
**Surface:** redesigned homeowner app (`(redesign)` route group), phone-first. Final homeowner slice; completing it makes the homeowner redesign surface done.

## 1. Goal

Build the homeowner **Account** tab: a hub that leads to five areas the homeowner manages , **Properties**, **Payment methods**, **Payment history / receipts**, **Browse services**, and **Profile**. Ships as **one combined PR** (decomposed into small tasks internally). Reuses existing hooks/routes/logic; presentation is built fresh from the design system.

## 2. Navigation architecture

- `/app/homeowner-dashboard/account` = the **hub**: grouped entry rows (icon + title + one-line subtitle + chevron), using the existing `ProfileRow` pattern. Groups: **Account** (Profile) and **Your cleanings** (Properties, Payment methods, Receipts, Browse services). A **Sign out** action sits at the bottom.
- Each area is a **sub-route** under `/account/` (matches the redesign's section convention): `/account/profile`, `/account/properties`, `/account/payment-methods`, `/account/receipts`, `/account/services`. Each renders a Container that owns hooks + a pure `derive*` + an open-handler, and a presentational `*View`.
- **Detail / add / edit** within an area use the established `?param=` takeover pattern: a write-only `useOpenX` hook (sets `?param=`, reads no search params) + a `*Host` that reads `useDetailParam('param')`, both mounted in the area's page; `MobileTakeover` for full-screen detail, vaul `Drawer` for add/edit/confirm sheets. Distinct params per area (`?property=`, `?payment_method=`, `?payment=`, `?service=`) so none collide with the existing `?appointment=`/`?job=`/`?thread=`.
- The bottom nav already has **Account** (Slice 1a). No nav change.

## 3. Areas

### 3.1 Properties (list / add / edit / delete)
- **Reuse:** `useHomeownerProperties` (`src/hooks/useHomeownerData.ts:224`) for the list; `updateProperty` / `deleteProperty` (`src/hooks/useAdminData.ts`, RLS-scoped by `organization_id`) for edit/delete; **create** via `supabase.from('properties').insert(...)` (no API route , RLS is the guard, same as legacy `AddPropertyModal`); photos via `useImageUpload` (`property-photos` bucket) exactly as `PropertyPhotoUpload` does today. Legacy **logic** refs (not styling): `AddPropertyModal`, `PropertyCard`, `PropertySidePanel`, `PropertyPhotoUpload`, `PropertiesPage`.
- **Property fields:** `name, address, city, state, zip_code, bedrooms?, bathrooms?, square_feet?, photo_url?, special_instructions?, access_instructions?`. **Note:** the homeowner hook's current `select`/type omits `special_instructions` + `access_instructions`; extend the `useHomeownerProperties` select + `Property` type to include them (needed for detail + edit).
- **Screens:** Properties list (compact `PropertyRow`: photo thumb + name + city/state + chevron; empty state + skeletons; "Add property" button) → property **detail** takeover (photo, name, full address, bed/bath/sqft grid, special/access instructions; Edit + Delete) → **add/edit** sheet (form; photo upload; Save) → **delete** confirm sheet.
- **Guardrail:** delete confirm discloses it cannot be undone. Photo upload is optional and a post-create upload failure must not block the create.

### 3.2 Payment methods (saved Stripe cards)
- **Gate:** entire area behind `stripeNewChargeFlowUiEnabled()`; the hub row is hidden when the flag is off.
- **Reuse:** `GET` + `DELETE /api/stripe/my-payment-methods` (list / remove); `POST /api/stripe/create-setup-intent` + `POST /api/stripe/confirm-setup-intent` (add card); legacy **logic** ref `AddPaymentMethodPanel` (Stripe Elements + SetupIntent confirm) and `PaymentMethodsPage` (list/refetch). Card shape: `{ id, brand, last4, expMonth, expYear, isDefault }` (+ ACH `{ type:'us_bank_account', bankName }` when present).
- **Backend delta (in scope):** add a **`PATCH /api/stripe/my-payment-methods`** handler (set default; mirror the existing org route's set-default) + extend its `route.integration.test.ts`. This is the only backend change in the slice.
- **Screens:** saved-cards list (default card marked; each row brand + ••••last4 + exp; Set as default / Remove; "Add a payment method" button; empty state) → **add-card** sheet (vaul Drawer wrapping the Stripe Elements panel; handle `confirmSetup` incl. 3DS `if_required`) → **remove** confirm sheet. Subtitle sets expectation: cards are charged only after a cleaning is completed.
- **Gotchas:** removing the default card leaves no default , after a remove that emptied the default, prompt to pick a new default (or surface it). Icons via lucide (`CreditCard`, `Landmark`).

### 3.3 Payment history / receipts (read-only)
- **Reuse:** `useHomeownerPayments` (`src/hooks/useHomeownerData.ts:376`) , fields `{ id, amount, status, paid_at, created_at, appointment: { scheduled_date, service_type: { name } } }`; money/date formatters `money2` / `longDate` from `src/components/redesign/payments/payments-presenters.tsx`; `Badge` variants for status. Legacy **logic** ref: `PaymentsPage` status mapping.
- **Status labels (charge-at-completion):** `pending`→"Awaiting completion" (caution), `processing`→"Clearing" (info), `paid`→"Paid" (positive), `failed`→"Failed" (critical), `refunded`→"Refunded" (info).
- **Screens:** payment-history list (friendly receipt cards: service + date on the left, amount + status badge on the right; tabular figures; empty state) → optional **receipt** detail takeover (`?payment=`): amount, status, date, service, linked cleaning. No mutations, no PDF (out of scope). Show gross amount only (the hook does not return fee/method breakdown; do not extend for this slice).

### 3.4 Browse services (read-only catalog)
- **Strong precedent:** mirror the cleaner's read-only catalog , `src/components/redesign/cleaner/profile/CleanerServicesCatalog(.View)` + `CleanerServiceDetail(.View)` + `deriveCatalog`. Reuse `useServices` / `useService` (`src/hooks/useServices.ts`) and the pure helpers in `src/components/redesign/services/deriveServices.ts` (`formatPrice`, `formatDuration`, `serviceTypeLabel`, `priceRangeLabel`). Active services only.
- **Fields:** `name, description, duration_minutes` (NOT `estimated_duration`), `base_price`, `service_type`; price range from `maxChecklistAdderByServiceId`.
- **Screens:** services list (name + type + duration + price range) → service **detail** takeover (`?service=`): description, duration, price range, checklist tiers (read-only) + a **"Request this cleaning"** CTA that routes into the existing homeowner request/booking entry (the same "Request a cleaning" flow the Home tab uses); if wiring that entry is not cheap, the CTA is informational for this slice (decision below).

### 3.5 Profile
- **Precedent:** mirror the cleaner Profile , `CleanerProfile(.View)` + `deriveProfile` + `ProfileRow` + `ChangePasswordDialog` (reuse directly) + the shared `AvatarEditor` (`src/components/redesign/shared/AvatarEditor.tsx`, already brand-styled , **do NOT** use the legacy yellow `AvatarUpload`). Reuse `useAuth().updateProfile` (`Partial<User['profile']>`), `useAuth().signOut`, phone helpers (`normalizePhoneToDigits` / `formatPhoneDisplay`), `personInitials`.
- **Screens:** profile editor , avatar (tap to change, via `AvatarEditor` + `useImageUpload`), first/last name, phone, read-only email ("Contact support to change it"), a sticky Save/Discard bar when dirty (`SettingsSaveBar`), a **Change password** row (email reset link) and a **Sign out** action (local scope, like the cleaner).

## 4. UI implementation & styling source

The scoping reports and any prior mockups are **UX/structure reference ONLY**. Every screen is implemented from the design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft "pillowy" shadows, the rounded scale). Do **not** copy ad-hoc colors, raw hex, or bespoke classes; do **not** carry over the legacy yellow (`#F7C41E`) or `primary-<number>` classes (legacy yellow ramp). Reuse `src/components/ui/*` + the shipped homeowner/cleaner patterns; if a needed pattern has no primitive, build it as a reusable primitive. No em dashes in any user-facing copy. Run **ui-ux-pro-max** at both design and implementation.

## 5. Backend / data summary

- **One new handler:** `PATCH /api/stripe/my-payment-methods` (set default) + its integration test. No migration.
- **One query extension:** add `special_instructions, access_instructions` to the `useHomeownerProperties` select + `Property` type.
- Everything else reuses existing hooks/routes; properties CRUD is Supabase-direct under RLS (as today).

## 6. Testing approach

- **Unit:** the pure `derive*` per area (`derive-properties`, `derive-payment-methods`, `derive-payments`, `derive-services` reuse/thin wrapper, `deriveProfile` homeowner variant) with co-located `*.test.ts`.
- **Integration:** the new `PATCH /api/stripe/my-payment-methods` (set default: success, missing id, not-owned, unauthorized) added to the route's existing integration test.
- **Visual:** built screens verified on the Vercel preview / dev with the homeowner role at phone width; screenshots sent (user is on mobile).

## 7. Decisions (resolved by user 2026-07-02)

1. **Account hub navigation:** **Hub + sub-routes** per area (`/account/properties` …) with `?param=` takeovers for detail.
2. **Browse-services "Request this cleaning" CTA:** **Wire it to the existing homeowner request flow** (the same entry the Home tab uses).
3. **Sign out scope:** **Local** (this device), like the cleaner app.

## 8. Global constraints (inherited by the plan)

- Design system only; brand `#0150FC`; no raw hex; no `primary-<number>`; semantic shades `-50`/`-700`.
- No em dashes in user-facing copy. No "operator" in homeowner-facing copy.
- Never import `lib/supabase-admin` from client code. Stripe UI behind `stripeNewChargeFlowUiEnabled()`.
- Reuse legacy/redesign LOGIC + hooks; build presentation fresh (no legacy component imports, no legacy yellow avatar).
- One PR; small tasks; merges user-gated.
