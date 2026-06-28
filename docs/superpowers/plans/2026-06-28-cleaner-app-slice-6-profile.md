# Cleaner App Slice 6 (Profile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline; the author is implementing this in-session) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the cleaner Profile hub (inline name/phone/avatar edit + change-password + read-only Services catalog + sign out), wire the real `organizations.default_payout_model` across Today/Earnings/Schedule, and leave clean employee-model placeholders. Last cleaner slice.

**Architecture:** Approach B (UI on existing behavior). New pages under `(redesign)/app/cleaner-dashboard/profile/**` render inside the existing `CleanerShell`. Container/View/derive split. Services drill-in uses real Next.js sub-routes (native back + deep-link; the greeting top bar persists on every tab, so sub-routes are consistent, takeovers stay reserved for the immersive job/thread contexts). All presentation is built fresh from `src/components/ui/*` + tokens; only headless logic is reused.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, TanStack Query, Supabase, Vitest.

## Global Constraints

- Flag-gated by the existing redesign route group (`redesignUiEnabled()` / `NEXT_PUBLIC_REDESIGN_ENABLED`); no new flag.
- Brand `#0150FC`, Plus Jakarta Sans, warm canvas, pillowy `shadow-soft-*`, rounded scale (`rounded-card/control/field/pill`). Semantic tokens only, **no raw hex, no `primary` (old yellow)**. Do NOT import `src/components/AvatarUpload.tsx` (yellow bleed).
- Dollars not cents; **no em dashes** in user-facing copy; use "office" not "operator" in cleaner-facing copy.
- Reuse logic only: `useAuth().updateProfile`, `useImageUpload`, `src/lib/phone.ts`, `src/lib/upload.ts`, `useServices`, `useChecklists`, `deriveServices` formatters, `toast` from `@/components/ui/toast`.
- No new migration. No new API route (change-password reuses `POST /api/auth/forgot-password`).
- Gates before PR: `npm run test`, `npx tsc --noEmit`, `npm run lint`. Pure logic gets co-located `*.test.ts` (TDD).

---

### Task 1: Wire the real payout model into AuthContext

**Files:**
- Modify: `src/contexts/AuthContext.tsx` (org-load select ~line 277; `setCurrentOrganization` object ~lines 316-329)

**Interfaces:**
- Produces: `currentOrganization.default_payout_model: 'percentage_contractor' | 'hourly_external' | undefined` (already on the `Organization` type in `src/types/index.ts`).

- [ ] **Step 1:** In the org-load query select, add `default_payout_model`:
  `.select('organization_id, role, organizations ( id, name, logo_url, default_payout_model )')`
- [ ] **Step 2:** In the `setCurrentOrganization({...})` object, add:
  `default_payout_model: (org as { default_payout_model?: 'percentage_contractor' | 'hourly_external' }).default_payout_model ?? 'percentage_contractor',`
- [ ] **Step 3:** `npx tsc --noEmit` passes (Organization type already allows the field).
- [ ] **Step 4:** Commit: `feat(redesign): load org default_payout_model into AuthContext`.

Note: `require_job_photos` / `cleaner_pay_display` are read off `org` but were never in the select (they always fall back to defaults). Out of scope to fix here; flag to Bridger as a separate finding.

---

### Task 2: Consume the real model in Today / Earnings / Schedule + employee framing

**Files:**
- Modify: `src/components/redesign/cleaner/today/CleanerToday.tsx:23`, `today-types.ts`, `deriveToday.ts`, `CleanerTodayView.tsx`
- Modify: `src/components/redesign/cleaner/earnings/CleanerEarnings.tsx:45-46`
- Modify: `src/components/redesign/cleaner/schedule/CleanerSchedule.tsx`, `schedule-types.ts`, `CleanerScheduleView.tsx`
- Test: `deriveToday.test.ts` (add cases), `src/components/redesign/cleaner/schedule/scheduleFilters.test.ts` (new)

**Interfaces:**
- Produces: `TodayData.isEmployee: boolean`; `scheduleStatusFilters(isEmployee: boolean): { id: ScheduleStatusFilter; label: string }[]`.

- [ ] **Step 1 (TDD):** Add to `deriveToday.test.ts`: with `payoutModel: 'hourly_external'`, `offers` is `[]` and `isEmployee` is `true`; with `'percentage_contractor'`, `isEmployee` is `false`.
- [ ] **Step 2:** Run -> fails (no `isEmployee`).
- [ ] **Step 3:** Add `isEmployee: boolean` to `TodayData`; in `deriveToday` return `isEmployee: payoutModel !== 'percentage_contractor'`.
- [ ] **Step 4:** Run -> passes.
- [ ] **Step 5:** `CleanerToday.tsx`: read `const { currentOrganization } = useAuth();` and pass `currentOrganization?.default_payout_model ?? 'percentage_contractor'` to `deriveToday` instead of the literal.
- [ ] **Step 6:** `CleanerTodayView.tsx`: when `data.isEmployee` and not loading and `!data.activeJob`/offers, render a subtle framing card ("Your office assigns your jobs" + brief copy) using `Card`/muted tokens (no offers section in this model). Keep minimal.
- [ ] **Step 7:** `CleanerEarnings.tsx`: replace the hardcoded `payoutModel: "percentage_contractor"` with `currentOrganization?.default_payout_model ?? "percentage_contractor"` (read from `useAuth()`).
- [ ] **Step 8 (TDD):** New `scheduleFilters.test.ts`: `scheduleStatusFilters(false)` includes `needs_response`; `scheduleStatusFilters(true)` excludes it (employees have no offers).
- [ ] **Step 9:** Run -> fails. Implement `scheduleStatusFilters` in `schedule-types.ts` (or a `scheduleFilters.ts`); export the base filter list. Run -> passes.
- [ ] **Step 10:** `CleanerSchedule.tsx`: read the model from `useAuth()`, compute `isEmployee`, pass it to `CleanerScheduleView`. `CleanerScheduleView.tsx`: render the filter chips from `scheduleStatusFilters(isEmployee)`; when employee, show the "assigned by your office" framing near the top.
- [ ] **Step 11:** `npm run test`, `npx tsc --noEmit`, `npm run lint` clean for touched files.
- [ ] **Step 12:** Commit: `feat(redesign): cleaner app reads real payout model + employee framing`.

---

### Task 3: Pure logic, deriveProfile + deriveCatalog (TDD)

**Files:**
- Create: `src/components/redesign/cleaner/profile/deriveProfile.ts` (+ `deriveProfile.test.ts`)
- Create: `src/components/redesign/cleaner/profile/deriveCatalog.ts` (+ `deriveCatalog.test.ts`)
- Create: `src/components/redesign/cleaner/profile/profile-types.ts`

**Interfaces:**
- Produces:
  - `cleanerDisplayName(p: { firstName?: string|null; lastName?: string|null }): string`
  - `cleanerInitials(p): string`
  - `showAvailabilityPlaceholder(model?: string): boolean` (`=== 'hourly_external'`)
  - `toCatalogRow(service: ServiceType, maxAdder: number): CatalogRowVM` and `toCatalogDetail(service, checklists: ChecklistWithItems[]): CatalogDetailVM` (reusing `deriveServices` formatters); types in `profile-types.ts`.

- [ ] **Step 1 (TDD):** `deriveProfile.test.ts`: `cleanerDisplayName({firstName:'Maria',lastName:'Alvarez'})==='Maria Alvarez'`; missing last name -> 'Maria'; both empty -> 'Your profile'. `cleanerInitials` -> 'MA' / 'M' / 'U'. `showAvailabilityPlaceholder('hourly_external')===true`, `('percentage_contractor')===false`, `(undefined)===false`.
- [ ] **Step 2:** Run -> fails. Implement `deriveProfile.ts`. Run -> passes.
- [ ] **Step 3 (TDD):** `deriveCatalog.test.ts`: `toCatalogRow({name,base_price:120,duration_minutes:120,...}, 40)` -> `{ id, name, priceLabel:'$120+', durationLabel:'2h', tierCount? }`; `toCatalogDetail(service, checklists)` maps tiers to `{ id, name, priceAdderLabel, tasks:[{id,task}] }` with "Included" when `price_adder===0` else `priceAdderLabel`.
- [ ] **Step 4:** Run -> fails. Implement `deriveCatalog.ts` (reuse `rowPriceLabel`, `priceRangeLabel`, `priceAdderLabel`, `formatDuration`, `serviceTypeLabel`, `formatPrice`). Run -> passes.
- [ ] **Step 5:** Commit: `feat(redesign): cleaner profile + catalog pure logic`.

---

### Task 4: CleanerAvatarEditor (fresh, on useImageUpload)

**Files:**
- Create: `src/components/redesign/cleaner/profile/CleanerAvatarEditor.tsx`

**Interfaces:**
- Consumes: `useImageUpload`, `useAuth`, `validateImageFile`/`AVATAR_*`/`IMAGE_ACCEPT_ATTR` from `src/lib/upload.ts`.
- Produces: `<CleanerAvatarEditor currentAvatarUrl={...} name={...} onUploaded={(url:string)=>void} />`

- [ ] **Step 1:** Build it from scratch using `Avatar`/`AvatarImage`/`AvatarFallback` + a brand camera badge button (`bg-brand-600 text-white`, `rounded-pill`), a hidden file input, preview + Save/Cancel while pending, upload status label (Converting/Compressing/Uploading) from `items[0].status`, error text via `text-destructive`. On `onComplete.uploaded[0]`, call `onUploaded(url)`. No `primary`/yellow, no raw hex.
- [ ] **Step 2:** `npx tsc --noEmit` + `npm run lint` clean.
- [ ] **Step 3:** Commit: `feat(redesign): cleaner avatar editor (design-system)`.

---

### Task 5: Profile hub (CleanerProfile + View + ChangePasswordDialog)

**Files:**
- Create: `src/components/redesign/cleaner/profile/CleanerProfile.tsx`, `CleanerProfileView.tsx`, `ChangePasswordDialog.tsx`
- Modify: `src/app/(redesign)/app/cleaner-dashboard/profile/page.tsx` (replace the stub)

**Interfaces:**
- Consumes: `useAuth` (`user`, `updateProfile`, `signOut`, `currentOrganization`), `toast`, `CleanerAvatarEditor`, `deriveProfile`, `normalizePhoneToDigits`/`formatPhoneDisplay`.

- [ ] **Step 1:** `CleanerProfile.tsx` container: local form state seeded from `user.profile` (firstName/lastName/phone); `isDirty` = any field differs from baseline; `onSave` calls `updateProfile({firstName,lastName,phone})` -> toast success/error, reset baseline; `onDiscard` resets to baseline; avatar handled by `CleanerAvatarEditor` calling `updateProfile({avatarUrl})`. Pass `model = currentOrganization?.default_payout_model` for the Availability card. Renders `<CleanerProfileView .../>`.
- [ ] **Step 2:** `CleanerProfileView.tsx` (pure): inline edit `Card` (avatar editor + first/last `Input` + phone `Input` (`inputMode="tel"`, formatted, autocomplete) + read-only email row with helper "Contact your office to change it") + a sticky/inline save bar shown only when dirty (Save/Discard `Button`s); **Account** section with a Change-password row (lock icon + chevron) that opens `ChangePasswordDialog`; **Availability** card (only when `showAvailabilityPlaceholder(model)`); **Catalog** section with a "Service catalog" row linking to `/app/cleaner-dashboard/profile/services`; separated **Sign out** `Button` (destructive variant) at the bottom. Use `SectionHeader`-style labels, `rounded-card`, `shadow-soft-*`, 44px targets.
- [ ] **Step 3:** `ChangePasswordDialog.tsx`: Radix `Dialog`; body "Send a password reset link to <email>?"; primary `Button` calls `POST /api/auth/forgot-password` with `{ email: user.email, redirectTo: \`${location.origin}/reset-password\` }`, then `toast.success("Check your email for a reset link")`, closes; error -> `toast.error`. Disable button while sending.
- [ ] **Step 4:** `profile/page.tsx`: replace stub with `<Suspense fallback={<profile skeleton>}><CleanerProfile/></Suspense>`.
- [ ] **Step 5:** Verify in browser (Playwright MCP at 390px): hub renders, edit name shows save bar, save toasts, change-password dialog opens, sign out present.
- [ ] **Step 6:** `npm run test`, `npx tsc --noEmit`, `npm run lint` clean.
- [ ] **Step 7:** Commit: `feat(redesign): cleaner Profile hub (edit, change-password, sign out)`.

Note: verify the `/reset-password` redirect path matches what the login forgot-password flow uses; adjust if different.

---

### Task 6: Read-only Services catalog (list + detail sub-routes)

**Files:**
- Create: `src/app/(redesign)/app/cleaner-dashboard/profile/services/page.tsx`
- Create: `src/app/(redesign)/app/cleaner-dashboard/profile/services/[serviceId]/page.tsx`
- Create: `src/components/redesign/cleaner/profile/CleanerServicesCatalog.tsx` + `CleanerServicesCatalogView.tsx`
- Create: `src/components/redesign/cleaner/profile/CleanerServiceDetail.tsx` + `CleanerServiceDetailView.tsx`
- Create (shared): `src/components/redesign/cleaner/profile/CleanerSubHeader.tsx` (in-page back header: back link + title)

**Interfaces:**
- Consumes: `useServices` (`services`, `loading`, `maxChecklistAdderByServiceId`), `useChecklists`, `deriveCatalog`.

- [ ] **Step 1:** `CleanerSubHeader.tsx`: a back row (`ChevronLeft` + label as a `Link`/`router.back()`) + a bold title. Sticky-friendly, design-system styled.
- [ ] **Step 2:** `CleanerServicesCatalog.tsx`: `useServices()` -> map active services via `toCatalogRow(s, maxChecklistAdderByServiceId[s.id] ?? 0)`; render `CleanerServicesCatalogView` (back to Profile; list of rows -> `Link` to `./services/[id]`; `EmptyState` when none; `Skeleton` while loading).
- [ ] **Step 3:** `CleanerServiceDetail.tsx`: `useService(serviceId)` + `useChecklists(serviceId)` -> `toCatalogDetail`; render `CleanerServiceDetailView` (back to Services; name + meta (price range, duration, type) + description; tier `Card`s with `priceAdderLabel`/"Included" + read-only task checklist using a check icon; empty/loading states).
- [ ] **Step 4:** Wire the two `page.tsx` route files (thin wrappers, `Suspense`, read `params.serviceId` for detail).
- [ ] **Step 5:** Verify in browser (390px): Profile -> Service catalog -> service -> back chain; empty + loading.
- [ ] **Step 6:** `npm run test`, `npx tsc --noEmit`, `npm run lint` clean.
- [ ] **Step 7:** Commit: `feat(redesign): cleaner read-only services catalog`.

---

### Task 7: E2E smoke + final verification + review + PR

- [ ] **Step 1:** Add `tests/e2e/cleaner-profile.spec.ts` (375px, resilient skip-on-uncertainty like `cleaner-messages.spec.ts`): log in as cleaner, open Profile, assert the edit card + Sign out render; open Service catalog and assert a row or empty state; (best-effort) drill into a service.
- [ ] **Step 2:** Run the full gates: `npm run test`, `npx tsc --noEmit`, `npm run lint`.
- [ ] **Step 3:** ui-ux-pro-max implementation-conformance pass (raw-hex/off-token/touch-target scan) over the new components. Fix any leak.
- [ ] **Step 4:** Playwright MCP screenshots of every built screen (Profile hub, contractor + employee variants, catalog list, service detail, change-password dialog) -> send to Bridger (desktop link + images).
- [ ] **Step 5:** Codex review of the branch (`/codex:review --scope branch --base master --wait`); apply valid fixes.
- [ ] **Step 6:** Push, open PR to master; ensure the 4 checks go green; merge when approved.
- [ ] **Step 7:** After merge: update `docs/superpowers/cleaner-app-status.md` (Slice 6 done -> cleaner app complete) and the memory.

---

## Self-review

- **Spec coverage:** Profile hub (Task 5) ✓; avatar (Task 4) ✓; change-password (Task 5) ✓; read-only services (Task 6) ✓; model wiring (Tasks 1-2) ✓; employee placeholders (Task 2 framing + Task 5 Availability card) ✓; no migration/route ✓; styling boundary (Global Constraints + Task 4) ✓; testing (Tasks 2,3,7) ✓.
- **Placeholder scan:** none (every task names files, functions, and the concrete change).
- **Type consistency:** `default_payout_model` literal union consistent across Tasks 1/2; `isEmployee` defined in Task 2 and consumed in the views; `toCatalogRow`/`toCatalogDetail` defined in Task 3 and consumed in Task 6; `CatalogRowVM`/`CatalogDetailVM` in `profile-types.ts`.
