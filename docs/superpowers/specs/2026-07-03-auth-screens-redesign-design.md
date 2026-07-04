# Auth Screens Redesign , Design

**Date:** 2026-07-03
**Surface:** The shared, pre-login auth pages (`/login`, `/forgot-password`, `/reset-password`, `/accept-invite`) + the shared `AuthShell`. Sub-project **A** of R4 launch polish.
**Status:** Design approved via the browser companion (layout Shape B, real logo, all-white lockup technique, mobile collapse, and tagline all confirmed with the user). Ready for an implementation plan.

## Goal

Rebuild the four auth screens , today all **legacy-styled** (yellow `#F7C41E` `primary-*` ramp, ad-hoc `.btn-primary` / `.input-field` classes, Inter font, gray palette) , on the redesign design system, so the first thing every pilot user sees is on-brand instead of jarringly off-brand next to the redesigned app. **Presentation-preserving:** every existing auth behavior (sign-in, redirect, invite preview/accept, password validation, expiry/error handling, the invite `pagehide` beacon) is preserved unchanged, with **one** deliberate behavior improvement folded in , a **password-policy hardening** (see below). The rest of the "make auth more official" ideas from the 2026-07-03 auth analysis (social/Google login + magic link, invite/email reliability, MFA, account lockout, httpOnly-cookie sessions, private storage buckets) are recorded in `docs/auth-improvements-backlog.md` for later , explicitly OUT of scope here.

## Locked decisions

1. **Layout = Shape B (split screen), collapsing to a plain card on mobile.**
   - **Desktop (`md`+):** two columns. Left = a **brand panel** filled brand blue (`bg-brand-600` / `#0150FC`) with the **all-white nexxus lockup** near the top, a headline tagline, a subline, subtle circle motifs, and a small "Cleaning Solutions" footer. Right = the **warm canvas** with the white form **card**.
   - **Mobile (`< md`):** the brand panel is **not** shown. The black nexxus lockup sits centered above the white form card on the warm canvas (the quiet "plain card" collapse , the user's pick). No blue band on phones.
2. **Shared tagline = "Cleaning, handled."** with subline **"Booked, tracked, and paid in one place."** The login/forgot/reset screens are role-agnostic (the role is unknown until after sign-in), so the copy stays neutral , never "your home" / "your business". The **accept-invite** brand panel may use a context-aware headline **"Welcome to the team."** since the invitee's org + role are known.
3. **Real logo, from existing assets.** Use the real `public/brand/logo-black.svg` (mark + `nexxus` wordmark) on light backgrounds. For the blue panel, render an **all-white lockup** , the raw `logo-white.svg` keeps its mark in blue (invisible on blue), so we derive white from `logo-black.svg`. Bake this into the `Logo` primitive as a reusable **on-dark variant** rather than a per-page hack (see Components).
4. **Restyle in place, not a new route group.** Auth is shared by all roles and hit before any user/flag context exists, so there is no A/B to gate , the pages at `src/app/{login,forgot-password,reset-password,accept-invite}/page.tsx` are restyled directly, and the shared `AuthShell` is rebuilt. (The redesign flag gates dashboards, not auth.)
5. **Light mode only.** Auth is pre-login; there is no user theme yet. Render on the light warm canvas regardless of system theme (do not read/apply `next-themes` here).
6. **No new auth flows.** Still invite-only (no public signup page), no social login, no "remember me". Same fields, same routes, same redirects.

## Screens

All four render inside the rebuilt `AuthShell` (split on desktop, plain card on mobile). Only the card contents differ.

### 1. Login (`/login`)
- Card: heading **"Welcome back"**, subline "Sign in to your account to continue."
- Fields: **Email address**, **Password** (with a show/hide eye toggle). A right-aligned **"Forgot your password?"** link. Primary **"Sign in"** button (full width) with the existing loading states ("Signing in...", "Please wait..." during cleanup).
- Inline **error alert** (design-system critical treatment) when `signIn` returns an error.
- Redirect logic unchanged: on `user` present, route via `getDashboardPath(role, { redesign })`; platform admins to `/owner` once `isPlatformAdmin` resolves.

### 2. Forgot password (`/forgot-password`)
- Card: heading **"Reset your password"**, subline "Enter your email and we'll send you a link to set a new one."
- Field: **Email address**. Primary **"Send reset link"**. A **"Back to sign in"** link.
- **Success state:** after submit, swap the form for a confirmation ("Check your email" + the address), keeping the shell. Preserve the existing send-reset behavior.

### 3. Reset password (`/reset-password`)
- Card: heading **"Set a new password"**, subline "Choose a new password for your account."
- Fields: **New password** (with the password helper text from `PASSWORD_HELPER_TEXT`), **Confirm password**. Primary **"Update password"**. Preserve the existing token-validity / recovery-session handling and success -> redirect behavior.

### 4. Accept invite (`/accept-invite`)
The richest screen; it is the product's "sign up" for invited team members + customers, and (per the user) is **most often opened on a phone by cleaners**, so the mobile plain-card layout must handle the tall form gracefully.
- **Panel states** (all on the same shell): **loading** ("Verifying your invite..."), **invalid**, **expired** (styled error card with the existing copy + the "ask an admin for a new invite" guidance), and **valid** (the form).
- **Valid form:** heading "Welcome to {organizationName}", subline "Complete your profile to access your dashboard." Fields: **Email** (disabled, pre-filled), **Role** (read-only design-system badge), **First name** + **Last name** (two-up), **Phone** (optional), **Create a password** (+ helper text), **Confirm password**. Primary button **"Create account"** (shortened from the legacy "Complete Profile & Go to Dashboard") with the existing "Setting up your account..." loading state.
- Preserve **all** invite logic: the `onAuthStateChange` / `getSession` token exchange, `preview` + `accept` route calls, password validation (`validatePassword`), the `pagehide` `form-closed` beacon, and the `mark-expired` fire-and-forget on `otp_expired`.

## Password policy hardening (the one behavior change)

The app already enforces a strong policy at the form layer (`validatePassword`: 8+ chars, upper + lower + number + symbol), but two gaps make it weaker than it looks:

1. **Supabase's own floor is 6 with no rules** (`config.toml` `minimum_password_length = 6`, `password_requirements = ""`) , a mismatched backstop. **Raise the floor to 8** (and, if the Supabase version supports it, set a matching `password_requirements`) so the server enforces at least the app's minimum. Config change, applied to dev + prod projects.
2. **No breached/common-password check** , "Qwerty123!" passes today. Add an **async breached-password check** on the two "create a password" surfaces (accept-invite + reset-password). **Recommended:** the Have I Been Pwned k-anonymity range API (send only the first 5 hex of the SHA-1, never the password) , privacy-preserving and catches real breaches. It runs on submit, **after** the sync `validatePassword` rules pass, and **fails open** (if HIBP is unreachable, do not block , this is an enhancement, not a gate). Surface a clear inline message ("This password showed up in a data breach. Please choose another.") on a hit. Keep the sync `validatePassword` unchanged; add a separate `checkPasswordNotBreached(password): Promise<{ breached: boolean }>` helper with its own unit test (mock the API) so the logic is covered without a network call in CI.

Everything else in auth behavior is unchanged.

## Components

- **`AuthShell` (rebuilt, shared).** The split-screen shell. Renders the brand panel (desktop only) + the form card, and accepts the form as `children`. Props for the panel copy so accept-invite can pass "Welcome to the team." while the others use the neutral default. Built entirely from design-system tokens (`bg-brand-600`, `text-*`, `rounded-card`, `shadow-soft-*`, warm canvas). Replaces the legacy `src/components/auth/AuthShell.tsx` (which uses `text-primary-600` + `bg-gray-100`).
- **`Logo` on-dark variant.** Extend `src/components/ui/logo.tsx` with a way to render the **all-white** full lockup for dark/blue backgrounds (e.g. `tone="onDark"` or an `onDark` boolean). Implementation: either the CSS filter (`brightness(0) invert(1)` on the `logo-black` image) or , preferred for crispness , inline the SVG and set every fill to white. This is reused by the brand panel and is available for any future on-dark placement. (Follow-up nicety, not required: export a true all-white lockup asset.)
- **Design-system primitives reused:** `Button` (primary, full-width, `size="lg"`), `Input` + `Label` (or `form-field`), `Badge` (the role pill), the password show/hide toggle, and a small inline **error alert** built from `critical-*` tokens. Password helper text from `lib/passwordValidation`.

## UI implementation & styling source

The browser-companion mockups from this design are **UX/structure reference only**. Every screen is implemented from the design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC` via `brand-*` / semantic tokens, Plus Jakarta Sans, warm canvas, `rounded-card`/`rounded-pill`, soft shadows). Do **not** reproduce the mockups' inline hex/pixel values, and do **not** carry over any legacy auth styling (`.btn-primary`, `.input-field`, `primary-<number>` yellow ramp, `text-gray-*`, `rounded-xl`). No em dashes in any user-facing copy. Run `ui-ux-pro-max` at implementation for conformance (semantic tokens, 44px touch targets, contrast, focus states).

## Data & reuse (no backend work)

- **No migration, no new route, no RLS change, no auth-flow change.** All four pages keep their existing hooks/routes: `useAuth().signIn`, `getDashboardPath`, the forgot/reset Supabase calls, `/api/accept-invite/preview` + `/api/accept-invite`, `/api/invites/[id]/mark-expired` + `form-closed`, `validatePassword` / `PASSWORD_HELPER_TEXT`.
- **The `AuthDebugOverlay`** is unchanged , it is globally mounted and flag-gated (`NEXT_PUBLIC_AUTH_DEBUG`), off in production, so it never appears for real users. Out of scope.

## Accessibility & responsiveness

- Labels tied to inputs; the password toggle has an `aria-label`; the error alert uses `role="alert"`. Visible focus rings (design-system `focus-visible` rings). Inputs >= 44px tall; buttons `h-11`/`h-12`. Email/tel `type` + `autoComplete` preserved so mobile keyboards + autofill work (important for the phone-first accept-invite).
- Desktop split at `md`+; below that, brand panel hidden and the card is a comfortable single column with the black lockup on top. The tall accept-invite form scrolls naturally on a phone.

## Testing

- Behavior is preserved, so existing coverage (password validation unit tests; any accept-invite route integration tests) stays green , no logic changes.
- Add a light **E2E smoke** (or extend an existing auth spec) that the login page renders the redesigned shell and a bad-credentials error surfaces, if a cheap hook exists; otherwise rely on visual verification.
- **Visual verification** on dev at **both widths** for all four screens **and** the accept-invite loading/invalid/expired states + the forgot-password success state; screenshots to the user (mobile). Confirm no legacy yellow, correct all-white lockup on blue, and the plain-card mobile collapse.

## Out of scope

- The **onboarding wizard** (R4 sub-project C) and the other R4 **system states** (404, error boundary, toast plumbing, remaining empty/skeleton gaps , sub-project B).
- **All the deferred auth-behavior ideas** from the 2026-07-03 analysis, captured in `docs/auth-improvements-backlog.md`: social/Google login + magic link (with the org-membership gate), invite/email reliability (expires-in-X, verify-on-click, extend-expiry, auto-retry), MFA (TOTP), account lockout, httpOnly-cookie sessions, and private storage buckets. The user liked all of these but chose to defer them; only the password-policy hardening above is in this project.
- A public **signup** page (still invite-only). Note: `AuthContext.signUp` -> the non-existent `/api/auth/signup` is dead code and can be removed as a small cleanup (not required for this project).
- Dark-mode auth. Exporting a dedicated all-white lockup asset (nicety; the derived white works).
