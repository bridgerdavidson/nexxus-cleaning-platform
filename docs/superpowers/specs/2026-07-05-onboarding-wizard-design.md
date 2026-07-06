# Onboarding Wizard (R4-C) — Design Spec

**Date:** 2026-07-05
**Status:** Approved in brainstorm; ready for implementation plan.
**Sub-project:** R4 launch polish, item C (last known R4 build item before the redesign gate closes).
**Supersedes:** the paused 2026-06-25 brainstorm (never committed; decisions reset in this session).

## Goal

Give every redesign role a warm, guided first-run: a short welcome, then a persistent
"finish setup" checklist that routes into the screens that already exist, plus consistent
on-system empty states. Serve both brand-new users and already-set-up users from one adaptive
system. Scope the actual setup work to the **percentage-contractor** payout model, which is the
only workflow currently built.

## Scope and non-goals

**In scope**
- Three onboarding surfaces: **Welcome moment**, **Setup checklist**, **Empty-state nudges**.
- Roles: **Operator** (admin + owner), **Cleaner**, **Homeowner** — the three built redesign
  experiences.
- The percentage-contractor setup path for each role.

**Explicit non-goals (deferred, not this project)**
- **Guided product tour** (spotlight/coach-marks). Deferred as unnecessary weight for now.
- **White-label branding** (logo upload, brand-color theming). The app keeps the locked Nexxus
  identity (`#0150FC`). White-label becomes its own post-pilot project.
- **Manager and Platform-owner onboarding.** Managers have no redesign dashboard to host it and do
  no setup; Platform-owner is deferred per the roadmap.
- **Other operating models** (cleaning-company / employee model with availability, flat-rate,
  hourly). Not built yet. See "Model scope" for how they slot in later.
- **A model-picker step** in owner onboarding. There is only one model today, so nothing to pick.

## Model scope: percentage-contractor only, but model-aware by construction

The percentage-contractor model is the merchant-of-record flow already in production: the tenant
company is the merchant, a card is saved at booking and charged at completion, and each cleaner
earns a **percent of gross** paid out via Stripe Connect. What each role must do to make that work
is fixed and known.

The forward-compatibility requirement (owner will eventually pick a model, which changes role
setup): **the per-role step definitions live in a model-keyed config, not hardcoded into the
components.** Today the config has exactly one model key, `percentage_contractor`, resolved from
the org's `organizations.default_payout_model`. When the employee model is built later, it adds its
own step definitions (e.g. cleaner availability) under a new key, plus a "choose your model" step in
owner onboarding — the checklist machinery, welcome, empty states, and completion engine do not
change. This mirrors the existing "model-aware" pattern in the cleaner app.

For this project we implement only the `percentage_contractor` step-sets. Any org whose model is
unset defaults to `percentage_contractor`.

## Surface 1 — Welcome moment (adaptive, thin, per role)

A brief branded first-run screen shown **once per user**, on first entry to their redesign
dashboard, then it drops them onto the real dashboard (with the checklist visible). It does **not**
collect setup input — every real setup task lives behind the checklist and opens an existing screen.

**Adaptive copy, no separate "existing user" flag.** The variant is chosen from whether the user's
required setup is already complete at first view:
- **Setup variant** (required steps incomplete): "Welcome to Nexxus, {name}" + a preview of the
  steps + "Let's get started" / "I'll do this later". This is the new-user path.
- **Reorientation variant** (required steps already complete): "Welcome to the new Nexxus" + a short
  "same tools, fresh look, nothing you set up has changed" + "Take a look". This is what already-set-up
  users (the pilot operators, existing cleaners/homeowners) see at cutover, with no backfill needed.

**Form factor.** Operator welcome is a full-screen takeover sized for desktop; cleaner and homeowner
welcomes are full-screen mobile takeovers (reuse the established mobile-takeover pattern). All three
are a single thin card, not a multi-step wizard.

Dismissing or completing the welcome sets `welcome_seen_at` so it never shows again for that user.

## Surface 2 — Setup checklist (per role, pinned, derived completion)

A dismissible card **pinned at the top of each role's dashboard home** (Operator Overview, Cleaner
Today, Homeowner Home), above the normal content. It shows a title, a subtitle with the count of
required steps remaining, a progress bar, an "X/Y" required count, a dismiss control, and a list of
step rows. Each step row has: a state icon (done / next / upcoming), a title, a one-line
description, an optional "Optional" tag, and an action (a primary button for the next actionable
required step; a chevron for later steps; a "Done" marker for completed ones). **Every action routes
to the screen that already owns that task; no setup forms are rebuilt.**

**Completion is derived from real data** (like today's `OwnerSetupChecklist`), except for the one
step a default value can't distinguish (operator "Set cleaner pay"), which uses an explicit marker.

**Visibility rule:** show the checklist when `requiredRemaining > 0` **and** not dismissed. When all
required steps complete, show a brief "You're all set" state, then it auto-hides on the next load.
For an already-set-up user it is derived-complete from the first render, so it never appears.

**Scope by owner concept:** the operator checklist tracks **org-level** setup (shared across the
org's owner/admins), so its completion is org-derived and its dismissal is org-level. The cleaner
and homeowner checklists track **per-user** setup (their own payouts/profile, their own
property/card), so per-user completion and dismissal.

### Per-role steps — percentage_contractor

Operator (org-scoped). Required count Y = 4; business hours/policy is an extra optional row.

| Step | Req? | Completion signal | Routes to |
|---|---|---|---|
| Connect payments | Required | `organizations.stripe_connect_charges_enabled === true` | Settings `?section=payments` |
| Add your services & pricing | Required | `service_types` count for org > 0 | Services screen |
| Set cleaner pay | Required | `organizations.payout_configured_at` not null (new marker) | Settings `?section=payout` |
| Invite your cleaners | Required | **≥1 outstanding cleaner invite (sent)** or ≥1 `organization_members` role `cleaner`. Sending the invite completes the step; acceptance is not required. | Cleaners screen (invite) |
| Business hours & cancellation policy | Optional | **Shows a done-state once configured**: derived from a customized business-hours row where distinguishable, otherwise an `organizations.hours_policy_configured_at` marker stamped when that section saves. | Settings `?section=business-hours` |

Cleaner (per-user). Required count Y = 1.

| Step | Req? | Completion signal | Routes to |
|---|---|---|---|
| Connect payouts | Required | `cleaner_profiles.stripe_connect_onboarding_complete === true` | Cleaner Earnings (Connect embed) |
| Complete your profile | Optional | `user_profiles.avatar_url` set (photo). Bio is not editable in the redesign cleaner UI, so avatar is the signal. | Cleaner Profile |

Homeowner (per-user). Required count Y = 2.

| Step | Req? | Completion signal | Routes to |
|---|---|---|---|
| Add your home | Required | `properties` count for the homeowner > 0 | Account -> Properties (add) |
| Add a payment method | Required (when card UI enabled) | **≥1 saved card / default payment method** for the homeowner's customer | Account -> Payment methods |

The "Add a payment method" step appears only when `stripeNewChargeFlowUiEnabled()` is on, because the add-card UI itself lives behind that flag. With the flag off, the homeowner checklist has one required step (Add your home); a step must never point to a destination that does not exist.

Exact column/param names for `payout_configured_at`, `hours_policy_configured_at`, the saved-card
source, and each route's query params are confirmed during plan-writing against current code; the
signals above are the contract.

## Surface 3 — Empty-state nudges

Make the first-run empty states consistent and on-system using the existing `EmptyState` primitive,
with onboarding-aware, action-forward copy. Most redesign screens already have empty states (the
system-states pass added the paired error states); this surface is an audit-and-fill pass, not new
machinery. Examples: homeowner Cleanings empty -> "Request your first cleaning"; operator Bookings
empty -> "New booking"; cleaner jobs empty -> "Once the office assigns you work, it shows up here."

## Behavior and triggers (summary)

- **Welcome:** gated by `welcome_seen_at` null. Shown on first dashboard entry. Copy variant by
  derived setup-completeness. Any exit sets `welcome_seen_at`.
- **Checklist:** visible when `requiredRemaining > 0 && !dismissed`. Auto-hides on completion. Dismiss
  sets the role-appropriate dismissal flag. Realtime/refetch on the underlying data keeps
  completion live (the signals come from data the dashboards already subscribe to).

## Data model

New, additive columns and one marker. All nullable; no backfill required.

- `user_profiles.welcome_seen_at timestamptz` — per-user welcome gate (all roles).
- `user_profiles.setup_checklist_dismissed_at timestamptz` — cleaner/homeowner per-user dismissal.
- `organizations.setup_checklist_dismissed_at timestamptz` — operator org-level dismissal.
- `organizations.payout_configured_at timestamptz` — set when the owner saves the payout-settings
  section (the "Set cleaner pay" completion marker; a default percent can't be distinguished from an
  intentional one, so this step needs an explicit signal).
- `organizations.hours_policy_configured_at timestamptz` — the "business hours & cancellation policy"
  done-state marker, stamped when that section saves. Only add this column if the plan confirms the
  done-state cannot be derived from existing business-hours data; prefer derivation.

One migration adds these. `payout_configured_at` (and `hours_policy_configured_at`, if used) are
stamped by the existing settings PATCH routes (no new write path for them).

## Architecture and components

Follow the redesign conventions (Container wires hooks/state; pure View takes props; pure logic in a
colocated file with a Vitest test). New code under `src/components/redesign/onboarding/`.

- **`onboardingConfig.ts` (pure):** `getSetupSteps(role, model): SetupStepDef[]`. `SetupStepDef =
  { key, title, description, icon, required, ctaLabel, href, completionKey }`. Model-keyed map with
  one key today (`percentage_contractor`). Unit-tested.
- **`useOnboardingStatus(role)` (hook):** resolves the org model, fetches the completion signals for
  the role (reuse existing queries where possible; a small dedicated query like `OwnerSetupChecklist`
  otherwise), reads the flags, and returns `{ steps: (SetupStepDef & { done })[], requiredRemaining,
  allRequiredComplete, welcomeSeen, dismissed, welcomeVariant }`.
- **`SetupChecklist` (View) + container:** the pinned card. Pure `deriveChecklist` for progress and
  next-step selection, unit-tested.
- **`WelcomeMoment` (View) + container:** the once-per-user full-screen card; variant by
  `welcomeVariant`. Operator = desktop takeover; cleaner/homeowner = mobile takeover.
- **Flag writes:** a minimal `PATCH /api/user/onboarding` (sets `welcome_seen_at` /
  `setup_checklist_dismissed_at` on the caller) and org-level dismissal via the org settings PATCH
  (or a tiny `PATCH /api/organizations/[orgId]/onboarding`). `payout_configured_at` piggybacks on the
  existing payout-settings save.
- **Reuse:** `Button`, `Card`, `EmptyState`, `Progress` (`src/components/ui/progress.tsx`), the
  overlay/takeover pattern, and the role dashboards' existing data hooks. No new primitives.

**Placement wiring:** insert the checklist container at the top of `OperatorOverview`, `CleanerToday`,
and the homeowner Home view; render `WelcomeMoment` from each dashboard when `!welcomeSeen`.

**Legacy:** the legacy `OwnerSetupChecklist` (legacy admin dashboard) is left untouched; it is
deleted with the rest of legacy at cutover. The redesign checklist supersedes it conceptually.

## Copy guidelines

- No em dashes in any product copy (labels, buttons, descriptions, toasts).
- Cleaner- and homeowner-facing copy says "the office", never "operator".
- Brand identity is locked; no per-tenant colors or logos.

## UI implementation and styling source

The browser-companion wireframes produced in this brainstorm (committed at
`docs/redesign/mockups/onboarding/`) are **UX/structure reference only**. Every screen is implemented from the design system: the primitives
in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand
`#0150FC`, Plus Jakarta Sans, warm canvas, soft "pillowy" shadows, the rounded scale). Do not copy
ad-hoc colors, raw hex, or bespoke classes from a mockup. If a needed pattern has no primitive yet,
build it as a reusable primitive that matches the system. Run `ui-ux-pro-max` at the implementation
phase for design-system conformance.

## Testing

- Pure logic (`onboardingConfig`, `deriveChecklist`, welcome-variant selection) gets colocated Vitest
  unit tests. No component-render harness exists in the repo, so presentational pieces are verified
  via tsc + lint + Playwright visual.
- New API route(s) get a colocated `*.integration.test.ts` using the test helpers.
- The migration is verified with `npx supabase db reset`.
- Live verification: with a test login, confirm the checklist appears for an unset-up state, each
  step routes correctly and marks done from real data, dismissal persists, and the welcome shows once
  and picks the correct variant.

## Proposed decomposition (for the plan)

- **Slice 1 — Foundation + Operator:** migration (flags + `payout_configured_at`), `onboardingConfig`,
  `useOnboardingStatus`, flag route(s), `SetupChecklist` + `WelcomeMoment`, wired for the Operator
  experience (supersede `OwnerSetupChecklist` in the redesign). Independently shippable.
- **Slice 2 — Cleaner + Homeowner:** their checklists and welcomes on the same machinery, with the
  per-user completion signals and dismissal.
- **Slice 3 — Empty-state unification:** audit the redesign screens and fill onboarding-aware empty
  states from the `EmptyState` primitive.

## Resolved in review (2026-07-05)

- **Homeowner "Add a payment method"** completes when the homeowner has ≥1 saved card / default
  payment method.
- **"Invite your cleaners"** completes on **invite sent** (an outstanding cleaner invite is enough;
  cleaner acceptance is not required).
- **"Business hours & cancellation policy"** shows a **done-state** once configured (not a pure nudge).

## To confirm during planning (implementation detail only)

- Exact source/column backing the saved-card signal (homeowner payment method).
- Whether the business-hours done-state is derivable from existing data or needs the
  `hours_policy_configured_at` marker (prefer derivation).
