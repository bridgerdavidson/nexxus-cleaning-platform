# Dark Mode — Design & Resume Plan

**Status:** Planning complete, not started. Brainstormed and scoped 2026-07-16.
**Resume trigger:** "Let's work on dark mode" → start at **Phase 1** below.
**This is a build-ready plan.** The codebase scan is captured here so a future session does not have to re-derive it.

---

## TL;DR

The dark mode designed during the redesign **survived and is nearly complete as infrastructure.** next-themes, `darkMode:['class']`, and a full light/dark token set are already wired, and the `ThemeProvider` **already wraps the entire live app.** The app is light only because the default is pinned to light and there is no user-facing toggle. Remaining work is: (1) finish theming the live surface so dark looks right everywhere, (2) build + expose a 3-way toggle, (3) fast-follow cross-device persistence.

---

## Decisions (locked 2026-07-16)

- **Grain:** Per-user (theme is a personal/device preference), not per-org.
- **Default:** Light for anyone who has not chosen. Keep `defaultTheme="light"`. Existing users are never surprised into dark.
- **Control:** 3-way **Light / Dark / System**. Choosing "System" follows the OS. Keep `enableSystem`.
- **Persistence:** Device-local via next-themes `localStorage` now; add **`user_profiles.theme`** for cross-device sync as a fast-follow (Phase 3).

---

## Scope

### In scope — the live redesigned surface ONLY
- `src/components/ui/*` — design-system primitives (already token-based, tiny cleanup).
- `src/components/redesign/*` and `src/app/(redesign)/*` — already token-based, minor cleanup.
- The **legacy top-level components the redesign still renders live** (hardcoded light today; need token retrofit):
  - `src/components/MessagesPage.tsx` (rendered by all three redesign `.../messages/page.tsx`)
  - `src/components/MessageBubble.tsx`
  - `src/components/MessageAttachmentsLightbox.tsx`
  - `src/components/JobPhotoLightbox.tsx`
  - `src/components/NotificationBell.tsx`
  - `src/components/WorkspaceErrorScreen.tsx`
  - `src/components/PayoutTimingNotice.tsx`
  - `src/components/HomeownerCardPicker.tsx`
  - `src/components/TenantStripeConnect.tsx`, `src/components/CleanerStripeConnect.tsx`
  - (Re-verify this reuse list at execution time; the redesign import graph is the source of truth.)

### Out of scope — permanently
- **The ~95 dead legacy top-level screens** in `src/components/*.tsx` and the legacy `/{role}-dashboard` + `/settings` routes. They sit behind the cutover and are being retired. **Do not touch them. They are gone.**
- **Auth screens** stay light by design (`src/components/auth/AuthShell.tsx:15` — "light mode only, do not read/apply next-themes here").
- **Marketing / landing** stays light by design (`src/app/(marketing)/layout.tsx` deliberately omits the provider).

---

## What already exists (do not rebuild)

| Piece | Location | Notes |
|---|---|---|
| `next-themes` | `package.json` (v0.4.6), `src/components/ui/theme-provider.tsx` | thin wrapper, installed |
| Tailwind class strategy | `tailwind.config.js:12` | `darkMode: ['class']` |
| Light token set (`:root`) | `src/app/globals.css:444-473` | shadcn HSL tokens |
| Dark token set (`.dark`) | `src/app/globals.css:475-503` | full AA-tuned dark palette, warm near-black `#1A1815` |
| Canvas temperature axis | `src/app/globals.css:546-577` | orthogonal warm/slate/neutral, has dark variants (leave as-is) |
| **Provider already wrapping the LIVE app** | `src/app/(redesign)/layout.tsx:22` | `attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange` — wraps all of `(redesign)/app/{admin,cleaner,homeowner,owner}-dashboard` |
| Working 2-way toggle primitive | `src/components/ui/theme-toggle.tsx` | Sun/Moon, hydration guard. Currently only mounted in dev `/ui-kit` (`src/app/(dev)/ui-kit/page.tsx:38`). Extend to 3-way. |
| Already theme-aware consumers | `logo.tsx:27`; Stripe appearance in `PaymentsSection.tsx`, `PaymentsYourMoney.tsx`, `AccountAddCardPanel.tsx`, `CleanerEarnings.tsx` via `getRedesignConnectAppearance(resolvedTheme === 'dark')`; `dark:` logo swaps in `OperatorRail.tsx`, `OperatorMobileNav.tsx` | proves dark is wired end-to-end |

**Because the provider is already live**, dark mode is QA-able right now via devtools/localStorage (`localStorage.theme = 'dark'`) before any toggle exists. There is **no "mount the provider" step.**

---

## Phased plan

### Phase 1 — Theme-complete the live surface
Invisible to users: the default stays light and no toggle is exposed, so nothing changes for anyone until Phase 2 ships. Land this across as many small PRs as convenient.

1. **Redesign-tree cleanup:**
   - Add `dark:` variants for the literal status ramps in `src/components/ui/badge.tsx:11-17` and `src/components/ui/stat-tile.tsx:26` (`bg-positive-50 text-positive-700`, `caution`, `critical`, `info`). These are literal palette classes and will not auto-invert.
   - Fix the ~6 stray literal colors inside `src/components/redesign/*` (grep `bg-white|text-gray-|bg-gray-|border-gray-` under that tree).
   - Leave `src/components/ui/switch.tsx:24` (`bg-white` knob) — intentional, reads correctly in both themes.
2. **Retrofit the reused-live legacy components** (list above) to semantic tokens. Standard substitution against the already-defined dark tokens:
   - `bg-white` → `bg-card` (or `bg-background` for page canvas)
   - `text-gray-900` / `text-black` → `text-foreground`
   - `text-gray-500/600/400` → `text-muted-foreground`
   - `border-gray-200/300` → `border-border`
   - `bg-gray-50/100` → `bg-muted` (or `bg-secondary`)
   - focus rings → `ring-ring`; destructive → `text-destructive`/`bg-destructive`
   - Lightbox chrome (`JobPhotoLightbox`, `MessageAttachmentsLightbox`) is **theme-stable on purpose** (dark scrim + light controls in both themes — see the note at `globals.css:578-595`). Do not invert these.
3. **Global base + platform chrome touch-ups affecting the live surface:**
   - Make `viewport.themeColor` theme-reactive (today `src/constants/theme.ts` `APP_BG_COLOR = '#ffffff'` is fixed white → mobile Safari chrome stays white in dark). Emit the dark canvas `#1A1815` when dark.
   - `src/app/globals.css:6-13` body fallback (`bg-white text-gray-900`) — the `.redesign` wrapper already paints `hsl(var(--background))` over the viewport, so this is a low-priority safety net; address only if a white flash/overscroll edge shows in dark.
   - The `@layer components` messaging classes (`globals.css:16-343`, `.message-bubble-*`, `.messages-search-input`, etc.) are **dead legacy** — `MessagesPage` does not use them. Skip unless a live component is found using one.
4. **QA** each live screen per role in dark via devtools before exposing any toggle.

### Phase 2 — Build + expose the 3-way toggle (the "go-live" moment)
This is the one piece that is real product UI, so it goes through the skills below.
- Build a Light / Dark / System segmented control from the design system (extend `theme-toggle.tsx` or add a new segmented primitive under `src/components/ui/`). Wire to next-themes `setTheme('light'|'dark'|'system')` and reflect `theme` (not `resolvedTheme`) as the selected value.
- Place an **"Appearance"** control in each role's existing settings home:
  - **Operator (admin/manager):** new section or a row in the "account" group. See `src/components/redesign/settings/sections.ts`, `.../sections/registry.ts`, `.../sections/ProfileSection.tsx`, `.../SettingRow.tsx`.
  - **Homeowner:** `src/components/redesign/homeowner/account/HomeownerAccountHubView.tsx` (Account section).
  - **Cleaner:** `src/components/redesign/cleaner/profile/CleanerProfile.tsx` / `CleanerProfileView.tsx`.
- Optionally gate exposure behind a `NEXT_PUBLIC_*` flag (mirror the `redesignUiEnabled()` pattern in `src/lib/redesign/flags.ts`) so it lands on preview before prod.
- **Copy rule:** no em dashes in any user-facing labels (CLAUDE.md).

### Phase 3 — Fast-follow: cross-device persistence
- Add migration: `user_profiles.theme text` (or a `preferences jsonb`). `user_profiles` has no such column today (`supabase/migrations/000_baseline.sql:1299-1309`).
- Hydrate on load and persist changes through the existing `updateProfile()` path (`src/hooks/useAuth.ts:38`, used by `ProfileSection.tsx`). Reconcile with next-themes' localStorage (server value wins on login; write-through on change).

---

## Skills usage (scoped per Bridger, 2026-07-16)

- **ui-feature-workflow + ui-ux-pro-max** apply to **Phase 2 (the toggle)** — design its placement/shape UX (design phase) and implement it from the design system (implementation phase) — and to **design-system conformance verification** across Phase 1 retrofits (ui-ux-pro-max catching any raw-hex / off-system styling leaks).
- **Brainstorming is done** (this doc). The Phase 1 light→dark token substitution is mechanical against the already-defined dark tokens; it needs neither brainstorming nor the ui-feature-workflow design phase. Only conformance verification.

---

## Testing
- Provider is already live → QA dark immediately via `localStorage.theme = 'dark'` + reload, before the toggle exists.
- Add a Playwright pass that forces `.dark` and screenshots the key live screens per role (admin/manager/cleaner/homeowner dashboards, Messages, settings) in both themes.
- Verify the already-theme-aware Stripe surfaces still render correctly in dark (they read `resolvedTheme`).

## Rollout
Low risk: Phase 1 PRs are invisible (default light, no toggle). Phase 2 shipping the toggle is the single go-live moment; optionally flag-gate to preview first. Phase 3 is additive.

## Open items to confirm at execution time
- Re-verify the reused-live legacy component list against the current redesign import graph.
- Decide whether the toggle also gets a quick-access placement (e.g. a menu), or settings-only (default assumption: settings-only).
- Confirm no other in-flight session is mid-edit on the reused components (Messages, settings) before starting, to avoid collisions.
