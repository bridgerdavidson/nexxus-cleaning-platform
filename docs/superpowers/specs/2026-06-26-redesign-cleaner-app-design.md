# Redesign: Cleaner (field-worker) app, phone-first

- **Date:** 2026-06-26
- **Status:** Design approved (mockups + decisions); spec under review
- **Branch (planned):** `feat/redesign-cleaner-app` (worktree off current `origin/master`)
- **Owner:** Bridger
- **Predecessors:** Operator experience complete (#79-#92). This is the first non-operator surface of the redesign (roadmap item **R3**).

## 1. Context and goal

The operator (admin) experience is fully redesigned and shipped behind the redesign flag. The next surface is the **cleaner**: the field worker who does the actual jobs. This is the highest daily-use non-operator surface and, per the AI Second Brain, the cleaner UX directly feeds the pre-sell demo and differentiates Nexxus from ZenMaid / Jobber. The redesign is a hard gate before outside customers pay, so this is on the critical path.

This is a **UI rebuild on existing behavior (Approach B)**: we reuse the existing headless hooks, mutations, and API routes and rebuild only the presentation, phone-first, on the redesign foundation. No new data layer.

### Goals
- A phone-first cleaner experience that covers feature parity with the legacy cleaner dashboard for the **contractor** operating model.
- Match the established redesign architecture, design system, and mobile patterns exactly.
- Be **model-aware**: build the contractor experience fully; leave clean placeholders for the not-yet-built **employee** model so it drops in later without restructuring.

### Non-goals (deferred)
- The full **employee operating model** functionality (availability-driven scheduling + direct admin assignment). Placeholder-only here; its own brainstorm later (Brain target: Aug-Sep 2026).
- **Counter-propose times** when responding to an offer (Accept / Decline only for MVP).
- **Calendar / month view** of jobs (date-grouped list instead).
- Desktop-specific layout beyond a graceful centered/constrained column (cleaner app is phone-first).

## 2. The two operating models (the core constraint)

`organizations.default_payout_model` selects the model:

1. **`percentage_contractor`** (BUILT, the MVP target): cleaners are 1099-style, receive job **offers**, **accept / decline** (counter-propose deferred), and are paid a **% of the job** (`organizations.default_cleaner_payout_percent`, snapshotted per payout).
2. **`hourly_external`** (employee model, NOT BUILT): cleaners set **availability**; the admin/manager **assigns** them directly with no back-and-forth.

**Model-aware principle:** the cleaner app reads the org's model and renders the right surface. For MVP only the contractor surface is functional; employee-only surfaces are rendered as clear "coming soon" placeholders gated on the model. The owner-facing toggle already lives in the operator Payout settings; the cleaner app only *reads* the model, it does not set it.

Where the model shows up:
- **Today / Schedule:** contractor sees an "Needs your response" offers section; employee sees assigned jobs only (offers section hidden; a placeholder explains assignment is owner-managed).
- **Profile:** an **Availability** section is a placeholder (employee model); functionality deferred.
- **Active-Job flow:** identical in both models (the work is the work). No branching.

## 3. Architecture

Mirror the operator redesign conventions exactly.

- **Route group + flag:** new pages under `src/app/(redesign)/app/cleaner-dashboard/**`. Gating is the existing `(redesign)/layout.tsx` (`NEXT_PUBLIC_REDESIGN_ENABLED`, always on in dev/preview, 404 in prod unless flag set).
- **Role routing:** the cleaner-dashboard pages check `useAuth()` role; the post-login destination + any "go to dashboard" routing sends `role === 'cleaner'` users to the redesign cleaner path when the flag is on (mirror the operator entry's auth/role check). Legacy `/cleaner-dashboard` remains for the un-flagged path.
- **Component tree:** new components under `src/components/redesign/cleaner/**`, one folder per screen, following the established convention:
  - `Cleaner<Screen>.tsx` (Container: hooks + state + mutations)
  - `Cleaner<Screen>View.tsx` (pure presentation)
  - `derive<Screen>.ts` (pure logic + co-located `derive<Screen>.test.ts`)
  - `<screen>-presenters.tsx` and `<screen>-types.ts` as needed
- **Shell:** a new `CleanerShell` (+ `CleanerTopBar`, `CleanerBottomNav`) under `src/components/redesign/cleaner/shell/**`. It reuses the operator shell's primitives and patterns (active-state derivation from pathname, safe-area handling, notification bell, the `MobileThreadOverlay` full-screen takeover, the `ui/drawer.tsx` vaul drawer) but is its own phone-first chrome (no left rail).
- **Data layer:** reuse existing hooks/routes (Section 8). No new tables except two small, optional additions (Section 8.3).
- **Design system:** the existing tokens and `src/components/ui/*` primitives. Identity is locked (brand `#0150FC`, Plus Jakarta Sans, warm canvas, pillowy soft shadows, generous rounded corners). No new visual language.

## 4. Navigation and shell

- **Bottom nav, 5 top-level tabs** (icon + label, active state = brand color + indicator bar): **Today, Schedule, Earnings, Messages, Profile**. Top-level only; never nest sub-navigation inside it.
- **Top bar:** greeting + name on the left; notification **bell** (reuse the wired `NotificationBell`) and avatar on the right. Tapping avatar opens Profile.
- **Mobile takeover:** job detail, the active-job sub-screens, and message threads use the full-screen white-surface slide-in takeover that hides the shell chrome (reuse the `MobileThreadOverlay` pattern, `bg-card`, `100dvh`, `env(safe-area-inset-*)`, `overscroll-contain`, iOS `visualViewport` keyboard handling).
- **Deep-linking:** job detail is URL-addressable (`?job=<id>`), so notifications and the bell can deep-link into it; back navigation restores list scroll/state.

## 5. Screens

### 5.1 Today (home) — `cleaner-dashboard/page.tsx`
Open-the-app-and-know-what-to-do feed:
- **Active job** pinned at top (brand card, big "Continue job" CTA) when a job is `in_progress`.
- **Needs your response** (contractor model): offer cards with inline **Accept / Decline** and the response deadline. Hidden in employee model.
- **Today** timeline: today's jobs as rows (time, address, service, customer, status pill). Tap opens job detail.
- **Tomorrow** one-line peek; tap goes to Schedule.
- Empty state when nothing is scheduled.

Reuses `useCleanerAppointments`, `useCleanerStats`. Derivation (`deriveToday.ts`): split active / offers / today / tomorrow, sort by time, status-badge mapping (reuse the operator badge vocabulary: amber = needs you, blue-spin = in progress, gray = upcoming, green = done).

### 5.2 Schedule — `cleaner-dashboard/schedule/page.tsx`
Full job list: date-grouped (Today / Tomorrow / This week / Later), search, status filter, and an Upcoming / Past toggle. List only (no calendar). Tap opens job detail. Reuses `useCleanerAppointments`; pure `deriveSchedule.ts`.

### 5.3 Active-Job flow (the heart) — full-screen takeover from a job
Layout **C, hybrid section cards**:
- **Overview:** job context (customer, service, duration, the special-requests note, **Directions** = maps link from property address, **Message** = thread with the operator scoped to this appointment), then three **section cards** (Before photos, Checklist, After photos) each showing status + progress and opening a focused sub-screen. A persistent bottom bar shows remaining steps and the **Complete job** button.
- **Photos sub-screen** (Before / After): camera-first tile, "choose from library" fallback, **live upload progress**, tap × to remove (with confirm). Uploads use `useImageUpload` (HEIC convert, compress, retry).
- **Checklist sub-screen:** big 48px tap rows, progress on top, auto-saved; Done returns to overview.
- **Complete confirmation** (bottom sheet): verifies requirements, surfaces the customer charge and the cleaner's cut, primary "Complete job". On success: green check + "added to earnings" feedback, then back to Today.

**Lifecycle wiring (reused):** start = `updateAppointmentStatus(id, 'in_progress')` + lifecycle notification; stage moves = `updateJobProgress(id, stage)`; complete = `updateAppointmentStatus(id, 'completed')` + lifecycle notification + charge-at-completion (`STRIPE_NEW_CHARGE_FLOW_ENABLED`). `job_progress` values unchanged (`not_started | before_photos | checklist | after_photos | completed`).

**Step order (decided: loose):** cards are tappable in any order; only **Complete** is gated (on all required steps). Strict ordering is out of scope (revisit only if operators ask for it).

**Photo gate policy (decided):**
- Default **requires** at least 1 before photo and 1 after photo to unlock Complete.
- **Skip-with-reason escape:** a "Can't add photos" action captures a reason (customer declined / no signal / other), records it for the operator, and unlocks Complete so the cleaner is never stranded (and the charge is never blocked).
- The gate checks a photo is **added/queued**, not that the upload has confirmed (background retry handles delivery).
- The requirement is a per-org policy: surface a **"Require job photos"** owner setting (default = required). MVP may ship with the column + default and a placeholder setting; full settings UI can follow.

### 5.4 Earnings — `cleaner-dashboard/earnings/page.tsx`
Reuse the standardized Stripe embed. Sections:
- **Payouts to your bank** (reuse `PayoutsSection` variant `cleaner` wrapping `ConnectPayouts`) with embedded Connect onboarding/status (`useStripeConnect`, `useCleanerConnect`, `/api/stripe/connect/*`).
- **Awaiting customer payment** (reuse `useCleanerAwaitingPayments`): jobs where ACH is still clearing.
- A simple earnings summary header (this week / this month) from `useCleanerStats` / `useCleanerPayouts`.
- Connection status card when not onboarded; empty state when no earnings yet.

### 5.5 Messages — `cleaner-dashboard/messages/page.tsx`
Reuse the operator Messages components and the mobile thread takeover. Cleaner converses with the operator (admins/managers), not homeowners. Reuse `useConversations`, `useMessages`, `useSendMessage`, `useStartConversation`. The "Message" action in a job opens a thread scoped to that appointment (`messages.appointment_id`, already supported, additive). Unread badge on the nav tab. Messaging is available to cleaners by default (they must be able to reach the operator); confirm at build time that no cleaner-side permission flag gates it (the operator's `can_view_messages` is a manager-side permission and is expected not to apply here).

### 5.6 Profile — `cleaner-dashboard/profile/page.tsx`
Sectioned settings:
- **Profile:** name, phone, avatar upload (`/api/user/upload-avatar`).
- **Availability (placeholder):** "coming soon" section, gated on / framed for the employee model. Functionality deferred.
- **Services (read-only):** browse the org's service catalog + checklists (reuse the services read path; the one optional capability kept in scope).
- **Notifications** and **Security**: link into the shared role-scoped settings shell built in R2 (the redesigned `/settings`); do not rebuild settings inside Profile. Profile stays the cleaner's personal hub; account/notification/security live in the one shared settings system. Confirm the exact redesign settings route at build.
- **Sign out** visually separated from normal items.

### 5.7 Employee-model placeholders (cross-screen)
Gated on `default_payout_model === 'hourly_external'`: hide contractor offers, show an "assigned by your manager" framing on Today/Schedule, and the Availability placeholder in Profile. All clearly non-functional "coming soon" until the employee-model brainstorm lands.

## 6. Cross-cutting UX (ui-ux-pro-max verified)

Baked into every screen:
- **Touch:** all targets >= 44px, >= 8px spacing, `touch-action: manipulation`, primary actions reachable one-handed (bottom third / sticky bars).
- **Multi-step:** progress indicator + completion gating + predictable back; confirm before the destructive/irreversible Complete.
- **Feedback:** skeletons for loads > 300ms, success feedback (checkmark/toast) on complete and accept, error states with a retry path, optimistic where safe.
- **Empty states** for every list (no jobs, no offers, no messages, no earnings).
- **Safe areas:** sticky top/bottom bars use `env(safe-area-inset-*)`; `min-h-dvh`/`100dvh`; content insets so lists clear fixed bars.
- **Navigation:** bottom nav <= 5, active state, deep-linkable screens, state preservation on back, badges cleared on visit.
- **Motion:** 150-300ms, transform/opacity only, sheets animate from source, `prefers-reduced-motion` respected.
- **Numbers:** tabular figures for money and times.
- **Accessibility:** labeled icon buttons, focus order, color never the only signal, contrast AA in both themes.

## 7. Design system

Tokens and primitives only. Brand `#0150FC`; Plus Jakarta Sans; warm off-white canvas (`#F7F6F3`) with white cards; soft pillowy shadows; rounded scale (`chip`/`control`/`field`/`card`/`pill`). Status badge vocabulary reused from the operator screens. Both light and dark themes supported via the existing CSS-variable tokens. SVG icons (Lucide), no emoji.

## 8. Data reuse map (no new data layer)

### 8.1 Hooks (reused)
`useCleanerAppointments`, `useCleanerStats`, `useCleanerPayouts`, `useCleanerAwaitingPayments`, `useCleanerPhotos`, `useChecklist`, `useJobPhotosForAppointment`, `useConversations`, `useMessages`, `useSendMessage`, `useStartConversation`, `useStripeConnect`, `useCleanerConnect`, `useImageUpload`. Realtime via the existing `useSupabaseRealtimeSync` channels (`appointments:${userId}`, `payouts:${userId}`, `job_photos:${userId}`, message channels).

### 8.2 Mutations / routes (reused)
`POST /api/appointments/confirm` (accept/decline), `updateAppointmentStatus` + `POST /api/appointments/[id]/lifecycle`, `updateJobProgress`, `POST /api/jobs/[appointmentId]/photos`, charge-at-completion (`/api/appointments/[id]/charge` / client helper, flag-gated), `/api/stripe/connect/{account-status,cleaner/start,login-link}`, `/api/user/upload-avatar`.

### 8.3 Minor additions (small, optional)
- **`organizations.require_job_photos boolean default true`** + a placeholder owner setting (per-org photo policy). MVP can ship the column + default and defer the settings UI.
- **Photo skip-with-reason record:** store the reason + a flag when a cleaner completes without photos (e.g., on the appointment, or as an operator notification). Keep minimal; surface to the operator.
- Both are additive migrations following the established migration workflow; tests required for any touched route.

## 9. Slicing and PR plan (ship in slices, operator precedent)

Each slice is its own PR off `master`, flag-gated, Codex-reviewed before push:
1. **Shell + Today** — `CleanerShell`, bottom nav, top bar, role routing into the redesign cleaner path, Today feed (contractor) + empty states.
2. **Schedule + job detail** — list + the active-job overview takeover (read + start), deep-linking.
3. **Active-Job flow** — photo sub-screens, checklist sub-screen, complete confirmation, photo gate + skip-with-reason, lifecycle + charge wiring. (Migration: `require_job_photos` + skip-reason.)
4. **Earnings** — Stripe embed, payouts, awaiting-payment.
5. **Messages** — reuse operator Messages + thread takeover, job-scoped threads.
6. **Profile + placeholders + Services** — profile edit, notifications/security, read-only services, employee-model placeholders (Availability).

(Order can flex; 1 and 3 are the highest-value.)

## 10. Testing

Follow the `create-tests` skill:
- **Unit** (`*.test.ts`): every `derive*.ts` (Today split/sort/badge, Schedule grouping/filter, completion-gating logic incl. photo-gate + skip).
- **Presenters** tests where formatting is non-trivial.
- **Integration**: any touched/new API route (photo skip-reason, settings) gets a co-located `*.integration.test.ts`.
- **E2E** (Playwright): the core field flow (start -> photos -> checklist -> complete) at 375px, plus reduced-motion and large Dynamic Type.
- Visual verification via Playwright MCP screenshots + the ui-ux-pro-max review pass before each PR.

## 11. Open questions / deferred
- Full employee model (availability + direct assignment) — separate brainstorm.
- Counter-propose times; calendar/month view.
- Exact storage for the photo skip-reason (appointment field vs notification vs both) — settle during slice 3.

### Decided
- Step order: loose (only Complete is gated).
- Settings: Notifications/Security link into the shared R2 settings shell; Profile is the personal hub only.
