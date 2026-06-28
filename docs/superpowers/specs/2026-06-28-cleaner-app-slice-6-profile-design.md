# Redesign: Cleaner app, Slice 6 (Profile + employee placeholders + real payout model)

- **Date:** 2026-06-28
- **Status:** Design approved (companion UX + decisions); spec for review
- **Branch:** `feat/redesign-cleaner-app-slice6-profile` (off current `master`, includes #99 `2ff63c6`)
- **Owner:** Bridger
- **Predecessors:** Cleaner Slices 1-5 shipped (PRs #93, #95, #96, #98, #99). This is the **last cleaner slice**; finishing it completes the cleaner experience.
- **Spec/design parent:** `docs/superpowers/specs/2026-06-26-redesign-cleaner-app-design.md` (§5.6, §5.7).

## 1. Context and goal

The cleaner app is 5/6 slices shipped (Today, Schedule, active-job flow, Earnings, Messages). Slice 6 builds the **Profile** screen (the cleaner's personal hub), wires the **real operating model** across the app (replacing the Slice-1 hardcode), and leaves clean **employee-model placeholders**. With the roadmap reordered so the redesign gates the pilot (see the AI Second Brain), this slice is on the critical path to launch.

This is a **UI rebuild on existing behavior (Approach B)**: reuse existing hooks/actions/routes, build presentation fresh on the redesign foundation. Phone-first.

### Goals
- A phone-first **Profile hub** (hybrid layout "C"): inline profile edit at the top, lighter items drill into focused screens, sign-out separated.
- A **read-only Services catalog** (list, then drill into a service), so a cleaner can reference what each service includes on the job.
- A lightweight **Change password** action (email reset link), since no shared settings shell or security surface exists yet.
- **Wire the real `organizations.default_payout_model`** into Today / Earnings / Schedule.
- **Employee-model placeholders** that drop in later without restructuring.

### Non-goals (deferred)
- A shared role-scoped settings shell, notification-preferences UI, and a full in-app security/account surface. None exist for any role today; building them is its own cross-cutting task (R4 launch polish). Slice 6 stays self-contained.
- Employee-model functionality (availability scheduling, direct assignment). Placeholder only (Brain target Aug-Sep 2026).
- Editing cleaner-specific fields (bio, rate, etc.). Profile edits the shared `user_profiles` fields only (name, phone, avatar).
- Booking from the catalog; the catalog is informational/read-only.

## 2. Key correction vs the parent spec

The parent spec (§5.6) said Notifications and Security should "link into the shared R2 settings shell." **That shell does not exist as described:** the R2 settings shell is operator-only (`/admin-dashboard/settings`, mounted under the operator shell and role-gated away from cleaners), and **no Notifications or Security section exists for any role** (only a Profile section: name/phone/avatar, email read-only). The §5.6 hedge ("confirm the exact redesign settings route at build") is hereby resolved:

- **Decision (Bridger):** keep the cleaner Profile **self-contained**. Do not link out. Provide a lightweight **Change password** (reset-email) action on the Profile page itself. Defer notification preferences (needs a new table + backend) and a full security surface.

## 3. Architecture

Mirror the cleaner-app conventions exactly.

- **Routes** (real Next.js sub-routes for native back, deep-linking, and scroll restoration; the Profile tab stays active on sub-routes because `deriveCleanerActive` matches the longest `href` prefix `/app/cleaner-dashboard/profile`):
  - `src/app/(redesign)/app/cleaner-dashboard/profile/page.tsx` -> Profile hub (replaces the current stub `EmptyState`).
  - `src/app/(redesign)/app/cleaner-dashboard/profile/services/page.tsx` -> read-only catalog list.
  - `src/app/(redesign)/app/cleaner-dashboard/profile/services/[serviceId]/page.tsx` -> service detail.
  - Each page is a thin wrapper rendering its Container inside `<Suspense>` with a skeleton fallback, like the other cleaner pages.
- **Components** under `src/components/redesign/cleaner/profile/**`, following the Container / View / derive split:
  - `CleanerProfile.tsx` (container: hooks, local form state, mutations) + `CleanerProfileView.tsx` (pure).
  - `CleanerServicesCatalog.tsx` + `CleanerServicesCatalogView.tsx`.
  - `CleanerServiceDetail.tsx` + `CleanerServiceDetailView.tsx`.
  - `CleanerAvatarEditor.tsx` (a fresh redesign avatar control built on `useImageUpload`; NOT the legacy `AvatarUpload`).
  - `deriveProfile.ts` (+ co-located `deriveProfile.test.ts`), `profile-types.ts`. Reuse the already-tested `deriveServices.ts` formatters for the catalog; add a thin cleaner presenter only if a mapping is non-trivial (with a co-located test).
- **Shell:** screens mount inside the existing `CleanerShell` (top bar + bottom nav persist; consistent with iOS tab drill-in). Sub-screens render an in-page back header ("Profile" / "Services").
- **Flag:** the existing `(redesign)/layout.tsx` gating (`redesignUiEnabled()` / `NEXT_PUBLIC_REDESIGN_ENABLED`); the cleaner-dashboard layout role-guards `role === 'cleaner'`.

## 4. Screens and behaviors (UX/structure)

### 4.1 Profile hub (layout C)
Single scrollable column inside the shell:
1. **Profile edit card** (inline):
   - Avatar with a change-photo affordance (tap to pick/replace). Live upload feedback; remove/replace supported.
   - First name, Last name (text inputs), Phone (`inputMode="tel"`, formatted display, digits-only storage), Email (read-only, helper "Contact your office to change it").
   - A **save bar** appears only when the form is dirty (Save / Discard). Saving shows progress then a success toast.
2. **Account** section: a single **Change password** row (lock icon, chevron). Tapping opens a confirm dialog: "Send a password reset link to your email?" -> on confirm, call `POST /api/auth/forgot-password` with the user's email -> success toast ("Check your email for a reset link"). Errors surface a retry-able message.
3. **Catalog** section: a **Service catalog** row (list icon, chevron) -> navigates to `…/profile/services`.
4. **Availability** (employee model only, see §6): a non-tappable "coming soon" card explaining the office sets their schedule. Hidden for contractor orgs.
5. **Sign out**: visually + spatially separated at the bottom, danger styling. Calls `useAuth().signOut()`.

### 4.2 Service catalog list (`…/profile/services`)
- In-page header with back to Profile, title "Services".
- Rows: service name, meta line (duration, tier count), price; chevron. Tap -> service detail.
- Empty state when the org has no services. Skeleton while loading.
- Read-only: no create/edit/reorder affordances.

### 4.3 Service detail (`…/profile/services/[serviceId]`)
- In-page header with back to Services.
- Service name, meta line (base price, duration, service type), description if present.
- **Tiers** (checklists) as cards: tier name + price-adder badge ("Included" / "+$X"), then its tasks as a checklist (read-only, check icons). Tiers sorted by `position` (null last) then name; tasks by `position` (null last) then `created_at`, via the existing `useChecklists` ordering.
- Empty/loading states.

### 4.4 Change-password confirm
A small confirm dialog/sheet (reuse the redesign dialog primitive). Single primary action; dismissable. No new screen/route.

## 5. Operating-model wiring (replace the Slice-1 hardcode)

- **Source of truth:** add `default_payout_model` to the `organizations` select that populates `currentOrganization` in `AuthContext` (the column already exists in `src/types/index.ts`; **no migration**). Expose it on `currentOrganization` so every screen reads one consistent value.
- **Consumers updated** to read `currentOrganization?.default_payout_model ?? 'percentage_contractor'` (safe fallback):
  - `CleanerToday.tsx` (currently hardcodes `'percentage_contractor'` at the `deriveToday(...)` call).
  - `CleanerEarnings.tsx` (currently hardcodes it; `deriveEarnings` is already model-aware).
  - `CleanerSchedule.tsx` (pass the model into `deriveSchedule` for the employee gating in §6).
- Re-fetch behavior: the value loads with org context and refreshes via the existing `reloadOrganization`; no live mid-session toggle handling needed (owner toggles are rare and a reload picks them up).

## 6. Employee-model placeholders (cross-screen, gated on `hourly_external`)

- **Today:** offers are already empty for non-contractor models in `deriveToday`; add an "assigned by your office" framing in the empty/offers area so the absence is explained, not silent.
- **Schedule:** hide the `needs_response` status-filter option and gate any offer-response affordance; add the same "assigned by your office" framing.
- **Profile:** show the Availability "coming soon" card (§4.1.4).
- All copy uses **"office"**, never "operator" (internal term). All placeholders are clearly non-functional until the employee-model brainstorm lands.

## 7. UI implementation and styling source (REQUIRED boundary)

The browser-companion mockups produced during design are **UX/structure reference ONLY**. Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft pillowy shadows, the rounded scale). Do **not** copy ad-hoc colors, raw hex, or bespoke classes from a mockup.

Specifically for this slice (Bridger called this out): the legacy operator settings reused `src/components/AvatarUpload.tsx`, whose "change photo" text is the **old brand yellow `#F7C41E`**. That is a legacy bleed. Reuse only the **headless logic** (`useImageUpload`, `useAuth().updateProfile`, `src/lib/phone.ts`); build the avatar control and the form **fresh** from our primitives. If a needed pattern has no primitive yet, build it as a reusable primitive that matches the system, never an inline one-off. Run the **ui-ux-pro-max** implementation-conformance pass before the PR (it flags raw-hex / off-token styling and touch-target issues).

## 8. Data reuse map (no new data layer)

- **Profile edit:** `useAuth().updateProfile(Partial<User['profile']>)` (name/phone, camelCase->snake_case internally); avatar via `useImageUpload` with `{ kind: 'avatar', ctx: { userId, currentAvatarUrl } }` -> writes `user_profiles.avatar_url` (Storage RLS, no route); `src/lib/phone.ts` (`normalizePhoneToDigits`, `formatPhoneDisplay`); `src/lib/upload.ts` (`AVATAR_*`, `validateImageFile`).
- **Change password:** existing `POST /api/auth/forgot-password` (no new route).
- **Services:** `useServices()` + `useChecklists(serviceTypeId)` + `deriveServices.ts` formatters (`formatPrice`, `priceRangeLabel`, `priceAdderLabel`, `formatDuration`, `serviceTypeLabel`). Column traps: `base_price` not `price`, `duration_minutes` not `estimated_duration`.
- **Model:** `currentOrganization.default_payout_model` (AuthContext, after the §5 change).
- **Sign out:** `useAuth().signOut()`.
- **Migrations:** none. **New API routes:** none.

Form dirty/save state: use a small local state (or a dedicated tiny hook) in `CleanerProfile`. Do **not** depend on the operator `useSettingsSection`/settings leave-guard provider (it is coupled to the operator settings shell); a fresh dismiss guard can reuse the app-wide `useDismissGuard` if a guard is wanted.

## 9. Cross-cutting UX (ui-ux-pro-max)
Touch targets >= 44px + 8px spacing + `touch-action: manipulation`; visible labels + blur validation + `tel` keyboard + autofill for the form; success/error feedback; skeletons > 300ms; empty states for every list; safe-area insets on sticky bars; deep-linkable sub-routes with predictable back + scroll restoration; read-only state visually distinct; sign-out gets destructive separation; AA contrast both themes; reduced-motion respected; tabular figures for prices.

## 10. Testing
- **Unit** (`deriveProfile.test.ts`): pure logic (initials/display name, Availability visibility by model, any catalog VM mapping). Reuse existing `deriveServices` tests; add a presenter test only if a new mapping is introduced.
- **Integration:** none required (no new/changed API routes). If the AuthContext change is meaningfully testable in isolation, add a focused unit test for the model fallback.
- **E2E** (Playwright, 375px): Profile loads; edit name -> save -> success; drill Profile -> Services -> service detail -> back. Resilient skip-on-uncertainty for preview auth/data latency, per the cleaner E2E precedent.
- **Visual:** Playwright MCP screenshots of the built screens (sent to Bridger, on desktop) + the ui-ux-pro-max conformance pass + Codex review before push.

## 11. Decided / deferred
- **Decided:** layout C (hybrid) for Profile; layout A (list -> detail drill-in) for Services; Change-password-only for account (option 2); self-contained Profile (no shared shell); centralize `default_payout_model` in AuthContext; sub-routes for drill-in; "office" copy.
- **Deferred:** shared role-scoped settings shell, notification preferences, full security/account surface, employee-model functionality, catalog search/filter (flat list is enough for MVP), counter-propose/calendar views.

## 12. Slice acceptance
- Profile hub renders for a contractor cleaner with working inline edit (name/phone/avatar) + save/discard + change-password reset email + sign out.
- Services catalog browses read-only (list -> detail with tiers/tasks), with empty/loading states.
- `default_payout_model` is read from the org (not hardcoded) in Today/Earnings/Schedule; setting an org to `hourly_external` shows employee placeholders (no offers, "assigned by your office" framing, Availability card) with no contractor offer UI.
- No new migration or API route; flag-gated; gates green (`npm run test`, `npx tsc --noEmit`, `npm run lint`); no legacy-yellow bleed; dollars not cents; no em dashes.
