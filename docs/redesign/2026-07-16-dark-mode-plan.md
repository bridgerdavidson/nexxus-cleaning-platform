# Dark Mode — Design & Build Plan

**Status:** Design finalized 2026-08-11 (supersedes the 2026-07-16 locks where noted). Building now, as **one PR** on `feat/dark-mode`.
**This is a build-ready plan.** The 2026-07-16 codebase scan is preserved below; the 2026-08-11 session re-verified the branding-surface facts.

---

## TL;DR

The dark mode designed during the redesign **survived and is nearly complete as infrastructure.** next-themes, `darkMode:['class']`, and a full light/dark token set are already wired, and the `ThemeProvider` **already wraps the entire live app.** The app is light only because the default is pinned to light and there is no user-facing toggle.

The 2026-08-11 design adds one new subsystem: **per-theme org logo assets.** White-label branding (shipped after the original plan) means tenant logos are raster uploads designed against one surface; dark mode must not silently break tenant brands. The brand *color* system needs nothing — one ramp already serves both themes with AA-resolved ink. Only the uploaded logo assets need dark variants.

Remaining work: (1) theme-complete the live surface, (2) dark logo pipeline, (3) build + expose a 3-way toggle, (4) fast-follow cross-device persistence.

---

## Decisions (updated 2026-08-11; supersedes 2026-07-16 where they conflict)

- **Grain: per-user** (reaffirmed after revisiting org-wide). Theme is a personal/device preference; org-wide would force dark on homeowners, flip themes on org switch, and reopen pre-paint flash work (theme must be known before org load). The logo-clash concern that motivated revisiting is solved at the logo level instead.
- **Default:** Light for anyone who has not chosen. Keep `defaultTheme="light"`. Existing users are never surprised into dark.
- **Control:** 3-way **Light / Dark / System**. Choosing "System" follows the OS. Keep `enableSystem`.
- **Persistence:** Device-local via next-themes `localStorage` now; **`user_profiles.theme`** cross-device sync is a post-MVP fast-follow (Phase 3).
- **Per-theme org logo assets (new):** `organizations` gains optional `logo_icon_dark_url` and `logo_full_dark_url`. A 2×2 asset model (icon/full × light/dark) where **only light assets are ever required** and each dark slot is independently optional.
- **Fallback (new):** in dark mode, a missing dark asset falls back to the light asset, **per-asset**. No heuristics, no monogram downgrade. The org fixes a clashing logo by uploading a dark variant.
- **The nudge (new):** Branding settings shows a live **dark preview** beside the light one, plus an "upload a dark variant" prompt when dark slots are empty. This preserves the white-label philosophy (honor the brand exactly, let them see it and choose) by making the owner *see* what dark-mode users see. Copy rule: no em dashes.
- **Brand color stays single-ramp.** `.dark` already resolves `--primary` to brand-500 and ink to brand-400/300 with AA guarantees. No per-theme colors.
- **Ship shape: one PR** (Bridger, 2026-08-11) containing Phases 1 + 2a + 2b. Phase 3 ships later.

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
  - (Re-verify this reuse list at execution time; the redesign import graph is the source of truth. Note the 3.9.2 messaging re-skin, PRs #239/#241/#243, landed after the original scan.)
- **The white-label branding pipeline** (new): migration, branding API, `OrgLogo`, brand cache/bootstrap, `BrandingSection`.

### Out of scope — permanently
- **The ~95 dead legacy top-level screens** in `src/components/*.tsx` and the legacy `/{role}-dashboard` + `/settings` routes. They sit behind the cutover and are being retired. **Do not touch them. They are gone.**
- **Auth screens** stay light by design (`src/components/auth/AuthShell.tsx` — light mode only, do not read/apply next-themes there).
- **Marketing / landing** stays light by design (`src/app/(marketing)/layout.tsx` deliberately omits the provider).
- **Org-default-theme column** — additive later if ever wanted; nothing here blocks it.

---

## What already exists (do not rebuild)

| Piece | Location | Notes |
|---|---|---|
| `next-themes` | `package.json` (v0.4.6), `src/components/ui/theme-provider.tsx` | thin wrapper, installed |
| Tailwind class strategy | `tailwind.config.js` | `darkMode: ['class']` |
| Light token set (`:root`) | `src/app/globals.css` | shadcn HSL tokens |
| Dark token set (`.dark`) | `src/app/globals.css` | full AA-tuned dark palette, warm near-black `#1A1815` |
| Canvas temperature axis | `src/app/globals.css` | orthogonal warm/slate/neutral, has dark variants (leave as-is) |
| **Provider already wrapping the LIVE app** | `src/app/(redesign)/layout.tsx` | `attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange` |
| Working 2-way toggle primitive | `src/components/ui/theme-toggle.tsx` | Sun/Moon, hydration guard. Mounted only in dev `/ui-kit`. Extend to 3-way. |
| Already theme-aware consumers | `logo.tsx`; Stripe appearance via `getRedesignConnectAppearance(resolvedTheme === 'dark')`; `dark:` Nexxus logo swaps in `OperatorRail.tsx`, `OperatorMobileNav.tsx` | proves dark is wired end-to-end; the `dark:` class swap is the hydration-safe pattern `OrgLogo` should copy |
| Brand ramp + dark ink | `src/lib/branding/palette.ts`, CSS vars | one ramp serves both themes; `--brand-ink` resolves per-theme with AA floor |
| Logo upload pipeline | `src/lib/branding/trimLogo.ts`, branding API | PNG/WebP, 2 MiB, alpha-aware trim; server-side path pinning `<prefix>/<orgId>/(icon\|full)-<id>.<ext>` |
| Brand cache + pre-paint bootstrap | `src/lib/branding/brandCache.ts` (`nexxus.brand.v1`, `{orgId, vars, iconUrl}`), `bootstrapScript.ts` | adopted-stylesheet mechanism (never pre-hydration DOM mutation — React 19 #418) |

**Because the provider is already live**, dark mode is QA-able right now via devtools/localStorage (`localStorage.theme = 'dark'`) before any toggle exists. There is **no "mount the provider" step.**

---

## Phased plan (all phases in the one PR except Phase 3)

### Phase 1 — Theme-complete the live surface
Invisible to users: the default stays light and no toggle is exposed until Phase 2b.

1. **Redesign-tree cleanup:**
   - Add `dark:` variants for the literal status ramps in `src/components/ui/badge.tsx` and `src/components/ui/stat-tile.tsx` (`bg-positive-50 text-positive-700`, `caution`, `critical`, `info`). These are literal palette classes and will not auto-invert.
   - Fix the stray literal colors inside `src/components/redesign/*` (grep `bg-white|text-gray-|bg-gray-|border-gray-` under that tree).
   - Leave `src/components/ui/switch.tsx` (`bg-white` knob) — intentional, reads correctly in both themes.
2. **Retrofit the reused-live legacy components** (list above) to semantic tokens. Standard substitution against the already-defined dark tokens:
   - `bg-white` → `bg-card` (or `bg-background` for page canvas)
   - `text-gray-900` / `text-black` → `text-foreground`
   - `text-gray-500/600/400` → `text-muted-foreground`
   - `border-gray-200/300` → `border-border`
   - `bg-gray-50/100` → `bg-muted` (or `bg-secondary`)
   - focus rings → `ring-ring`; destructive → `text-destructive`/`bg-destructive`
   - Lightbox chrome (`JobPhotoLightbox`, `MessageAttachmentsLightbox`) is **theme-stable on purpose** (dark scrim + light controls in both themes). Do not invert these.
3. **Global base + platform chrome touch-ups:**
   - Make `viewport.themeColor` theme-reactive (today `src/constants/theme.ts` `APP_BG_COLOR = '#ffffff'` → mobile Safari chrome stays white in dark). Emit the dark canvas `#1A1815` when dark.
   - `src/app/globals.css` body fallback (`bg-white text-gray-900`) — low-priority safety net; address only if a white flash/overscroll edge shows in dark.
4. **QA** each live screen per role in dark via devtools before exposing any toggle.

### Phase 2a — Dark logo pipeline (new)
1. **Migration** (timestamped via `npx supabase migration new`, never hand-numbered): `organizations.logo_icon_dark_url text`, `organizations.logo_full_dark_url text`, both nullable. `brand_updated_at` keeps serving as the cache-buster for all four assets. Idempotent (`IF NOT EXISTS`).
2. **Storage/API:** extend server-side path pinning to `icon-dark` / `full-dark` names; same bucket, same PNG/WebP + 2 MiB + trim rules; same no-SELECT-policy posture. Branding API accepts/normalizes the two new URLs.
3. **Runtime resolution:**
   - `useOrgBrand()` exposes `iconDarkUrl` / `fullDarkUrl` alongside the light ones (cache-busted at consume time, same as today).
   - **`OrgLogo` does the theme resolution via CSS `dark:` class swap** (render the applicable variant per theme; hydration-safe, no mount flicker — the same pattern as the Nexxus marks in `OperatorRail`). Per-asset fallback: no dark icon → light icon; independently for the lockup. Never read `resolvedTheme` in JS for this.
   - **Brand cache** adds `iconDarkUrl` (backward-compatible field add within `nexxus.brand.v1`); the cold-load loader picks the right mark via the same CSS mechanism, since next-themes puts the theme class on `<html>` before paint.
4. **Branding settings UI:** `BrandingSection` becomes the 2×2 asset grid (dark slots visibly optional) with a dual-theme live preview and the nudge when dark slots are empty. The dark preview needs the same scoped-token re-derivation BrandPreview already does (plus `--brand-*` alias re-chaining for scoped overrides). **ui-feature-workflow + ui-ux-pro-max apply** (design + implementation).

### Phase 2b — Build + expose the 3-way toggle (the "go-live" moment)
- Build a Light / Dark / System segmented control from the design system (extend `theme-toggle.tsx` or add a segmented primitive under `src/components/ui/`). Wire to next-themes `setTheme('light'|'dark'|'system')` and reflect `theme` (not `resolvedTheme`) as the selected value.
- Place an **"Appearance"** control in each role's existing settings home:
  - **Operator (admin/manager):** the **Settings → Appearance section already exists** (created by #231 for the rail pin toggle, with dark mode explicitly intended to land there). Add the control to it.
  - **Homeowner:** `src/components/redesign/homeowner/account/HomeownerAccountHubView.tsx` (Account section).
  - **Cleaner:** `src/components/redesign/cleaner/profile/CleanerProfile.tsx` / `CleanerProfileView.tsx`.
- **Copy rule:** no em dashes in any user-facing labels (CLAUDE.md).
- **ui-feature-workflow + ui-ux-pro-max apply.**

### Phase 3 — Post-MVP fast-follow: cross-device persistence
- Add migration: `user_profiles.theme text` (or a `preferences jsonb`).
- Hydrate on load and persist changes through the existing `updateProfile()` path. Reconcile with next-themes' localStorage (server value wins on login; write-through on change).

---

## Skills usage (scoped per Bridger, 2026-07-16, extended 2026-08-11)

- **ui-feature-workflow + ui-ux-pro-max** apply to **Phase 2a's BrandingSection UI**, **Phase 2b (the toggle)**, and design-system conformance verification across Phase 1 retrofits.
- The Phase 1 light→dark token substitution is mechanical against the already-defined dark tokens; it needs neither brainstorming nor the ui-feature-workflow design phase. Only conformance verification.
- **Brainstorming is done** (2026-07-16 original; 2026-08-11 logo-variant revision, both captured here).

---

## Testing

- Provider is already live → QA dark immediately via `localStorage.theme = 'dark'` + reload.
- **Unit:** OrgLogo resolution fallback chain; brand cache round-trip with `iconDarkUrl`; storage path normalization for `icon-dark`/`full-dark`.
- **Integration:** branding API accepts and pins the dark URLs (co-located `*.integration.test.ts`, helpers from `tests/helpers/`).
- **E2E:** a Playwright pass that forces `.dark` and screenshots the key live screens per role in both themes.
- Verify the already-theme-aware Stripe surfaces still render correctly in dark (they read `resolvedTheme`).
- **⚠ Hydration check (carried from the white-label #418 lesson):** on a prod build, confirm next-themes' pre-hydration class on `<html>` does not trip React 19 hydration error #418. Its `suppressHydrationWarning` guidance is supposed to cover this; verify, don't trust.

## Rollout

Low risk: everything ships dark-OFF-by-default in the one PR; the toggle's presence in settings is the go-live moment. Existing users see zero change unless they opt in. Phase 3 is additive later.

## Open items to confirm at execution time

- Re-verify the reused-live legacy component list against the current redesign import graph (3.9.2 messaging re-skin landed since the scan).
- Confirm no other in-flight session is mid-edit on the reused components (Messages, settings) before starting.
