# Redesign R2 — Operator Settings (design spec)

- **Date:** 2026-06-26
- **Status:** Design approved (structure + nav model); ready for implementation plan
- **Branch (to create):** `feat/redesign-operator-settings` off **current** `master`
- **Flag:** ships inside the existing `(redesign)` route group (gated by `redesignUiEnabled()` / dev-preview), like every operator screen
- **Roadmap:** R2 of the screen redesign. See `[[project_redesign_screens]]`. Sequence: R1 chrome (done) -> **R2 Settings (this)** -> R3 Homeowner/Cleaner/Platform -> R-Booking -> R4 polish.

---

## 1. Goal

Give the **operator** (owner / admin / manager) a redesign-native Settings experience that lives inside the finished operator shell, reuses the headless section logic, and feels like a modern app's settings — not the legacy `/settings/*` pages restyled.

This phase is **operator-only**. The cleaner and homeowner settings (thin subsets: cleaner = Profile + Payouts, homeowner = Profile) are deferred to R3 and will reuse the section components built here through their phone-first chrome.

---

## 2. CRITICAL guardrail — the mockup is not the design reference

A throwaway HTML mockup (`.superpowers/brainstorm/.../settings-native-v1.html`) was used **only** to validate layout, the nav model, and the content structure. Its ad-hoc colors, spacing, fake controls, and markers (e.g. the "OWNER" pill) are **not** the design. The implementation's visual source of truth is the existing redesign system, exactly as the other operator screens use it:

- The owned primitive kit in `src/components/ui/*` (Input, Select, Switch, Button, Tabs, EmptyState, etc.).
- The design tokens + brand `#0150FC` + Plus Jakarta Sans + warm canvas + pillowy radii/shadows from `[[project_redesign_foundation]]`.
- The established operator-screen conventions (section spacing, `StatusBadge`, gate-before-fetch, Container/View/derive(+test) split).

No mockup-ism may bleed into the build. In particular: **no "owner" pills or any per-section role markers** — section visibility is already handled by role-scoping (a non-owner never sees owner-only sections), so the visibility *is* the signal.

---

## 3. Navigation model — nested "quiet left index"

Settings is **one more operator screen inside `OperatorShell`** — the primary rail stays put. A **Settings (gear) item** at the bottom of the primary rail opens it. Inside the content area:

- A **quiet left index**: a text-forward, role-scoped section list living on the settings surface (grouped `Account` / `Business`). It is **not** a second boxed rail; it sits on the surface with comfortable separation from the dark primary rail, lighter weight than the legacy `SettingsRail`. Active item = brand color + subtle `brand-50` wash (no heavy "card" highlight, no left accent bar).
- The **section body** to the right: a flat surface (not a floating card) with native rows.
- **No "Back to dashboard" button.** The primary rail is the way out; the legacy back-link existed only because legacy settings took over the whole screen, which no longer happens.

**Route:** `src/app/(redesign)/app/admin-dashboard/settings/[[...section]]/page.tsx` (optional catch-all). Bare `/settings` lands on the **Profile** section (calm, universal default — confirmed, for every role, replacing legacy's owner/admin -> Payments). `/settings/<section>` renders that section. The primary rail's gear shows active for any `/settings*` path (longest-prefix `deriveActive`, same as nested Bookings).

**Mobile (operator phone):** no left index. Settings is reached from the operator mobile menu; it shows the **section list -> full-screen section** with a back-to-list affordance (a list<->section back is legitimate on mobile — there's no persistent index — and is distinct from the removed desktop "back to dashboard"). Reuses the mobile patterns from the Messages screen work.

---

## 4. Section list + role-scoping

Operator sections after the reconciliation decisions (Settings owns **org-level config only**; per-entity editing stays in the People/Cleaners screens):

| Group | Section | Visible to | Source |
|---|---|---|---|
| Account | **Profile** | everyone | `useAuth` + avatar upload route (`api/user/upload-avatar`) |
| Account | **Organization** | owner | org name / logo URL / billing email — `useAuth` + direct `supabase` update |
| Business | **Payments** | owner, admin (manager + `can_manage_payments`) | tenant Stripe Connect — `useTenantConnect` + `TenantStripeConnect` embed |
| Business | **Cancellation policy** | owner, admin (manager + `can_manage_payments`) | cancellation fee / window / no-show — direct `supabase` |
| Business | **Payout settings** *(merged)* | owner | payout model + org default % in one section — `useAdminCleaners` (default %) + direct `supabase` (model) |
| Business | **Business hours** | owner, admin (manager + `can_manage_cleaners`) | weekly hours + IANA timezone — direct `supabase` + `listTimezones` |

**Dropped vs legacy:** Team & permissions (now in People -> Staff), Security and Notifications ("Soon" placeholders — removed entirely), and the per-cleaner payout table (now in the Cleaners screen). **Merged:** legacy `cleaner-payouts` (org default %) + `payout-model` -> one owner-only **Payout settings** section.

**Registry:** legacy `src/lib/settings.ts` is **shared with the still-live legacy settings and must not be edited**. The redesign gets its own small registry + pure role-scoping function under `src/components/redesign/settings/sections.ts` (`REDESIGN_SETTINGS_SECTIONS` + `deriveSettingsSections(role, orgRole, permissions)`), mirroring the filter logic of `getSectionsForRole` (reuse the `ManagerPermissions` type). Pure + unit-tested.

---

## 5. Content style — native rows

Each section body is built from a small reusable **`SettingRow`** primitive (composed from the kit), not bespoke forms:

- A row = **label + optional helper text on the left, control on the right**, separated by hairline dividers (token border). Generous vertical rhythm. No inner bordered "form card."
- Controls are real kit primitives: `Input`, `Select`, `Switch` (iOS-style toggle), `Button`, segmented control, plus the Stripe embed for Payments.
- **Save model — explicit save, NOT auto-save (confirmed).** Rationale: this surface holds consequential org/money config (cancellation fees, default payout %, business hours), where a deliberate commit + clear confirmation beats silent auto-save. Mechanics:
  - A section-level **save bar appears only when the form is dirty** ("Unsaved changes · Discard · Save changes"), reusing each section's existing save logic.
  - On a successful save, give **clear confirmation** so the user is never guessing: a success toast (`ToastContext`) and the save bar collapses to a brief "Saved" state.
  - If the user tries to **leave while dirty** (switch sections, click another rail item, or navigate away), pop the app's discard guard (`useDismissGuard` / `DiscardChangesDialog` from `[[project_modal_ux_hardening]]`) — a **Save / Don't save / keep editing** dialog.
  - **Payments** has no save bar (Stripe manages its own state).

---

## 6. Architecture / files

All new code under `src/components/redesign/settings/` and the `(redesign)` route; **legacy `src/app/settings/*`, `src/components/settings/*`, and `src/lib/settings.ts` are never touched.**

- `OperatorSettings.tsx` — Container: resolves role/orgRole/permissions, computes visible sections via `deriveSettingsSections`, owns the active-section state synced to the route, **gates before fetch** per section.
- `OperatorSettingsView.tsx` — pure View: renders the quiet left index + the active section body (props only).
- `sections.ts` (+ `sections.test.ts`) — redesign registry + pure `deriveSettingsSections`.
- `SettingRow.tsx`, `SettingsSaveBar.tsx` — shared presentational primitives.
- `sections/{ProfileSection,OrganizationSection,PaymentsSection,CancellationSection,PayoutSettingsSection,BusinessHoursSection}.tsx` — one per section; each ports its legacy load/save logic faithfully and restyles on the kit. `PaymentsSection` reuses `useTenantConnect` + the themed `TenantStripeConnect` embed (with `getRedesignConnectAppearance`).
- Entry points (both confirmed): (a) the **Settings gear** in the operator primary rail bottom group — replace the existing placeholder gear in `OperatorRail` / `nav-items.ts`, keeping its current position; (b) a **"Settings" link in the `OperatorTopBar` profile dropdown**. Both route to `/app/admin-dashboard/settings`.
- `src/app/(redesign)/app/admin-dashboard/settings/[[...section]]/page.tsx` — wraps `OperatorShell active="settings"` + `OperatorSettings`.
- Dev preview: `src/app/(dev)/settings-preview/page.tsx` renders `OperatorSettingsView` with mock data for no-login Playwright iteration.

**Permission gating (gate-before-fetch, the Customers/Payments pattern):** the index renders only `deriveSettingsSections(...)` items; each section component gates on its own rule before mounting data hooks (e.g. an unauthorized manager hitting `/settings/payments` directly gets a denied state, never a `useTenantConnect` fetch). Owner-only sections (Organization, Payout settings) and manager-permission-gated ones inherit their rules from the registry.

---

## 7. Testing

- **Unit:** `deriveSettingsSections` (role/orgRole/permission filtering, group ordering, merged Payout section visibility = owner-only). Any per-section pure helpers (e.g. business-hours validation, payout-% clamp).
- **Playwright (dev preview + live):** index renders the right sections per role; switching sections; native rows render; save bar appears on dirty; mobile list -> section. Verify live against real dev Supabase per role (owner, admin, manager-with/without each permission).
- **Verification:** Playwright MCP + `[[reference_ui_ux_pro_max]]` iterate-until-seamless per `[[feedback_ui_native_verify]]`; Codex pre-push review per `[[feedback_codex_prepush_review]]`.

No new API routes or migrations are expected (reuses existing save paths). If any section's save currently has no route and uses direct `supabase` writes, keep that path.

---

## 8. Scope boundaries

**In:** operator settings shell (nested, quiet left index), the 6 sections above on the kit, role-scoping, gate-before-fetch, mobile list->section, dev preview, tests.

**Out (deferred):** cleaner/homeowner settings chrome (R3, reuses these section components); real white-label branding — logo upload to Storage + brand-color live re-theme (onboarding-wizard phase); real Security and Notifications features; the booking-logic family (R-Booking).

---

## 9. Decisions (confirmed 2026-06-26)

1. **Default landing:** `/settings` -> **Profile** for every role (calm/universal), replacing legacy's owner/admin -> Payments.
2. **Entry points:** the **gear in the primary rail** (replacing the current placeholder) **and** a **"Settings" link in the top-bar profile dropdown**.
3. **Save model:** **explicit save** (dirty-only save bar) with a clear post-save confirmation, plus a **Save / Don't save** discard guard on leaving dirty. Not auto-save — chosen because the config is consequential (money/scheduling).
