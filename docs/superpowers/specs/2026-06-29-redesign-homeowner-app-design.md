# Redesign — Homeowner experience (design)

> Status: design approved + reviewed (spec-review corrections applied 2026-06-29). Job-messaging extracted to its own brief (`2026-06-29-job-messaging-design.md`). Slice 1 split into 1a/1b. Next: implementation plan via writing-plans (Slice 1a first).
> Surface: the third of four redesign experiences. Operator + Cleaner are complete and merged. This is the **Homeowner** app. Per the redesign roadmap (set 2026-06-28): operator + cleaner done → **Homeowner [this doc]** → New-booking flow redesign → R4 launch polish.

## 1. Goal

Rebuild the homeowner view layer in the flag-gated `(redesign)` route group as a warm, calm, **consumer-grade phone-first app**, reusing the existing headless data hooks unchanged. Mental model: **book → watch → pay**. The role stays deliberately simple (manage requests + view cleanings); we "go big" only on the **watch it's handled** loop, headlined by **live cleaning tracking**.

## 2. Locked direction (from `docs/redesign/2026-06-19-redesign-decisions.md`, "Homeowner app — shell")

- Consumer vibe: warm, calm, reassuring; not enterprise. Phone-first, single column.
- Home centerpiece = **"Your next cleaning"** reassurance hero (date · service · cleaner face · status pill).
- **One creation action**: "Request a cleaning" (clear button + persistent FAB). The only thing a homeowner makes.
- Status, not management: pending requests + history as glanceable cards. No tables, no triage.
- Bottom nav (4): **Home · Cleanings · Messages · Account**. Properties, payment methods, payment history, browse-services live under **Account**.
- Build architecture = **Approach B** (same as operator/cleaner): new screens under `src/app/(redesign)/app/homeowner-dashboard/*`, presentational components under `src/components/redesign/homeowner/*`, built on `src/components/ui/*` primitives. Legacy `src/app/homeowner-dashboard/*` is never edited and stays live until cutover.

## 3. UI implementation & styling source (boundary contract — read before building any screen)

The homeowner mockup (`docs/redesign/mockups/homeowner-shell.html`) and any companion sketches are **UX/structure reference ONLY**. Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft "pillowy" shadows, the rounded scale). Do **not** copy ad-hoc colors, raw hex, or bespoke classes from the mockup (e.g. the mockup's literal `#0150FC`/`#fdf3e2` values or one-off borders). Status and urgency are expressed through the **badge/pill vocabulary**, never decorative side-accents or stripes. If a needed pattern has no primitive yet, build it as a reusable primitive that matches the system. `ui-ux-pro-max` runs again at implementation for design-system conformance (the catch-net for off-system leaks).

## 4. Experience map (the four bottom-nav surfaces)

### Home
- Greeting header ("Hi, {firstName}" + "Your home, handled.") + **notifications bell** (reuse `useNotifications` + redesign `NotificationBell`).
- **"Your next cleaning" lifecycle hero** (see §5) — the centerpiece.
- **Pending request** cards (`useHomeownerRequests`, with inline cancel via `cancelRequest`).
- **"Request a cleaning"** primary button + persistent **FAB** → opens the existing legacy `RequestAppointmentModal` (the deep request flow is deferred to the dedicated New-booking step; only the entry is redesigned here).
- Recently completed cleanings glance (links into Cleanings detail).

### Cleanings
- List of cleanings grouped **Upcoming** / **Past** (from `useHomeownerAppointments`), each a glanceable status card (descriptive badge, date in a pill, service, cleaner).
- Tap → **deep-linkable detail takeover** (`?appointment=<id>`, via `MobileTakeover`) carrying the **same lifecycle hero/live-tracking + completed recap** as Home, plus:
  - Actions: **Message office** (persistent thread), **Message about this cleaning** (the per-cleaning job thread from the Job-messaging feature — available while active), **Cancel cleaning** (reuse the existing homeowner cancel/confirm path; **the confirm must disclose any cancellation fee before charging** — late cancels trigger the off-session cancellation-fee charge in charge-at-completion).
  - Read-only details: property/address, special requests, price/receipt.
- **No reschedule** (deferred — see §8). **No after-the-fact editing.**

### Messages
The homeowner Messages tab, built on the cleaner Slice 5 inbox + operator `ChatThread.tsx` in a `MobileTakeover` (unread badge from `useConversations`), shows two kinds of thread:
1. **Office** (persistent) — the existing homeowner↔operator thread, always available. Unchanged from today.
2. **Per-cleaning job threads** — provided by the separate, cross-cutting **Job messaging** feature (own brief: `2026-06-29-job-messaging-design.md`). They appear while a cleaning is active and as read-only history after. There is **no compose-to-a-person entry point**: job threads are reachable only from a cleaning, so neither party can start a conversation with an arbitrary counterpart.

The job-messaging feature is designed and planned **separately** (it also touches the cleaner app + operator office-read + DB migrations + a guarded send route + a per-org kill-switch). The homeowner-side work consumed here is: render the Office thread + active/archived job threads in the inbox, and the "Message about this cleaning" entry points. **This slice depends on that feature existing.**

### Account
- **Properties** — list/add/edit/delete (reuse the existing properties components + `useHomeownerProperties`; `PATCH/POST/DELETE /api/properties*`). Rebuilt presentation; same hooks/routes.
- **Payment methods** — saved Stripe cards (add/remove), gated behind `stripeNewChargeFlowUiEnabled()` (reuse `GET/DELETE /api/stripe/my-payment-methods` + the card field).
- **Payment history / receipts** — `useHomeownerPayments`, shown as friendly receipt cards (tabular figures for money).
- **Browse services** — read-only service catalog (`service_types`).
- **Profile / settings** — name, avatar, sign out. (Reuse legacy logic; build presentation fresh from the design system — do NOT import legacy AvatarUpload's yellow styling.)

## 5. Headline feature: live cleaning tracking

The hero (on Home and in the Cleanings detail) reads the appointment state and morphs across the cleaning's lifecycle:

| State | Source | What the homeowner sees |
| --- | --- | --- |
| **Confirmed / scheduled** | `appointments.status` | Date · service · cleaner face · "Confirmed" pill. "It's handled." |
| **In progress** | `appointments.job_progress` enum + `checklist_item_completions` count + `started_at` | Cleaner + **stage label** (before-photos → cleaning → after-photos) + **live checklist progress bar** ("8 of 14 tasks done") + **elapsed time** (from the new `started_at`) + a **before-photo peek**, updating in **real time**. |
| **Complete** | `appointments.status` + `job_photos` + payment | "Cleaning complete" recap: **after-photos**, checklist-done summary, and **receipt** (charge-at-completion amount/status). |

**Why this combination:** `appointments.job_progress` (`not_started → before_photos → checklist → after_photos → completed`) gives the coarse stage label (RLS-readable by the homeowner). The fine **"X of Y"** granularity (the actual wow) counts `checklist_item_completions` against the appointment's checklist line-item total. **Correction (verified):** `useHomeownerAppointments` joins only checklist *metadata* (name/price), **not** line items, completions, or `job_progress`; `checklist_line_items` is homeowner-readable but isn't currently selected. So the new `useHomeownerJobProgress` hook does its **own targeted selects** (`job_progress` + line-items + completions) rather than bloating the shared appointments query. Enum-only was considered and rejected — it loses the per-task progress that makes the feature feel alive.

### Data access — one small migration required

`job_photos` homeowner read **already exists** (verified live policy `"Homeowners can view photos for their appointments"`, `homeowner_id = auth.uid()`), and the `job-photos` bucket is **public** (`storage.buckets.public = true`), so before/after `photo_url`s render directly — no signed-URL route. `checklist_line_items` is already homeowner-readable. The **only** missing access is `checklist_item_completions` (cleaner/org-staff only today) and its realtime membership.

New migration (next sequential number, e.g. `097`):
1. **Homeowner SELECT RLS on `checklist_item_completions`** — scoped to appointments the user owns (`EXISTS (SELECT 1 FROM appointments a WHERE a.id = checklist_item_completions.appointment_id AND a.homeowner_id = auth.uid())`). Add alongside the existing `cic_cleaner_rw` / `cic_org_read` policies (do not modify those).
2. **Realtime**: add `checklist_item_completions` to the `supabase_realtime` publication + `ALTER TABLE ... REPLICA IDENTITY FULL` (template: `048_invites_realtime.sql`). `job_photos` + `appointments` realtime already work for the homeowner.

**Timestamps (decided):** `appointments` has no job-start/complete timestamp today, so Slice 1b **adds `started_at` + `completed_at`**, stamped by the lifecycle route on job start / completion. These power the in-progress **elapsed time** here and the job-messaging **grace window** (which reuses them — see `2026-06-29-job-messaging-design.md` §4.3).

### New homeowner read hooks (mirror the cleaner's, read-only)
- `useHomeownerJobProgress(appointmentId)` — reads `appointments.job_progress`/`status` + `checklist_item_completions` count + checklist total; subscribes to completions + appointment changes via `useSupabaseRealtimeSync` (invalidate/patch). Returns `{ stage, doneCount, totalCount, percent, isLoading }`.
- Reuse a read-only photo read mirroring `useJobPhotosForAppointment` (before/after arrays) against the now-readable `job_photos`.
- Presentation: reuse `checklistProgressLabel(done, total)` from `active-job-presenters.ts` for the "N of N done" copy.

### New presentational components (`src/components/redesign/homeowner/`)
- `HomeownerCleaningHero` — the lifecycle hero (confirmed/in-progress/complete states), built from `ui/*` (Card, Badge/Pill, Avatar, Progress). Used by Home and the Cleanings detail.
- `LiveCleaningProgress` — the progress bar + "X of Y" + stage label + before-photo peek (skeleton while loading; reserve space to avoid layout shift; tabular figures; respect `prefers-reduced-motion`).
- `CompletedCleaningRecap` — after-photos gallery + checklist summary + receipt.

## 6. Reused infrastructure (build on these, don't reinvent)

| Need | Reuse | Path |
| --- | --- | --- |
| Shell wrapper (phone-first `max-w-lg` column) | mirror `CleanerShell` → build `HomeownerShell` | `src/components/redesign/cleaner/shell/CleanerShell.tsx` |
| Bottom nav (`activeId`, `messagesUnread`, safe-area) | mirror `CleanerBottomNav` → build `HomeownerBottomNav` | `src/components/redesign/cleaner/shell/CleanerBottomNav.tsx` |
| Full-screen detail/thread takeover (white surface, keyboard-aware) | `MobileTakeover` | `src/components/redesign/shared/MobileTakeover.tsx` |
| Notifications hook + bell (popover desktop / drawer mobile) | `useNotifications` + `NotificationBell` (`role`) | `src/hooks/useNotifications.ts`, `src/components/redesign/notifications/NotificationBell.tsx` |
| Collapsing office-inbox + chat thread | `deriveOfficeInbox.ts`, `deriveMessages.ts`, `ChatThread.tsx` | `src/components/redesign/cleaner/messages/`, `src/components/redesign/messages/` |
| Messaging hooks (incl. `appointmentId` seam) | `useConversations`, `useMessages`, `useSendMessage` | `src/hooks/` |
| Progress copy helper | `checklistProgressLabel` | `src/components/redesign/cleaner/job/active-job-presenters.ts` |
| Request-a-cleaning entry (legacy, opened as-is) | `RequestAppointmentButton` + `RequestAppointmentModal` (+ optional `ScrollAwareRequestFab`) | `src/components/`, `src/components/homeowner/` |
| Flag + routing | `redesignUiEnabled()`, `getDashboardPath()` | `src/lib/redesign/flags.ts`, `src/lib/redesign/dashboardPath.ts` |

**Routing wiring:** add a `homeowner` case to `getDashboardPath()` returning `/app/homeowner-dashboard` when `redesign` is on (mirrors cleaner/admin). Ensure notification deep-link href building (`navigation.ts`) routes homeowner notifications into `/app/homeowner-dashboard?appointment=<id>`.

## 7. Reused data hooks (unchanged)
`useHomeownerAppointments` (`keys.appointments.byHomeowner`), `useHomeownerProperties`, `useHomeownerPayments`, `useHomeownerStats`, `useHomeownerRequests` (+ `cancelRequest`), `useConversations`. Shared `QueryClient` keeps cache + realtime coherent with legacy.

## 8. Out of scope / deferred (explicit)
- **Deep "Request a cleaning" flow** — only the entry (button + FAB) is redesigned; it opens the legacy `RequestAppointmentModal`. The full redesigned booking flow is the next roadmap step (shared by operator + homeowner).
- **Reschedule / request-change** — deferred (net-new route; revisit later). Ship cancel + message only.
- **Rate / favorite cleaner** — deferred (no ratings/favorites backend today; outside the "simple homeowner" goal).
- **Homeowner↔cleaner messaging** is **extracted to its own cross-cutting feature** (`2026-06-29-job-messaging-design.md`) and consumed by the Messages tab here; not built inside this spec.
- **Backend changes (this spec)** — one migration: the live-tracking `checklist_item_completions` RLS + realtime + `appointments.started_at`/`completed_at` (§5, Slice 1b) + lifecycle-route stamping. The job-messaging migrations live in that feature's brief.

## 9. Slice plan (one PR per slice, like the cleaner app)

**Slice 1a — Shell + Home (static, no migration).** Route group + `HomeownerShell` + `HomeownerBottomNav`; `getDashboardPath` homeowner case + **notification href fix** (add the missing homeowner branch so taps route to `/app/homeowner-dashboard?appointment=`); Home greeting + `NotificationBell`; the lifecycle hero **Confirmed** + **Complete** states (after-photos + receipt — both already homeowner-readable) + an **empty/no-upcoming state**; pending-request cards + cancel (with fee disclosure); "Request a cleaning" button + FAB → legacy modal. Tests: hero state derivation, notification href routing (homeowner).

**Slice 1b — Live cleaning tracking (the headline).** The migration (`checklist_item_completions` homeowner RLS + realtime; **`appointments.started_at` + `completed_at`** + stamping them in the lifecycle route) + `useHomeownerJobProgress` (targeted selects of `job_progress` + line-items + completions; realtime via `useSupabaseRealtimeSync`) + the **in-progress** hero state + `LiveCleaningProgress` (progress bar + X/Y + stage + **elapsed time** + before-photo peek) + the checklist-done count in `CompletedCleaningRecap`. Tests: `useHomeownerJobProgress` unit (count/percent/stage), migration `db reset` + RLS integration (homeowner reads own completions, not others'). *(The `started_at`/`completed_at` columns are also a dependency for the job-messaging grace window.)*

**Slice 2 — Cleanings.** List (Upcoming/Past) + deep-linkable detail takeover (`?appointment=`) reusing the hero/tracking/recap; cancel (fee disclosure) + Message-office actions. The "Message about this cleaning" entry renders once the Job-messaging feature ships. Tests: list grouping/sort derive; detail deep-link.

**Slice 3 — Messages (consumes the Job-messaging feature).** Homeowner Messages tab: persistent Office thread + active/archived per-cleaning job threads, reusing the operator/cleaner chat. The job-messaging **backend, migrations, send-gating, office-read, kill-switch, and cleaner-app companion update live in that feature's own plan** (`2026-06-29-job-messaging-design.md`). Tests: inbox derivation (Office + N job threads), read-only archived rendering.

**Slice 4 — Account.** Properties (CRUD), payment methods (Stripe-gated), payment history/receipts, browse services, profile/settings. Tests: per existing route coverage; presentation built fresh.

> **Dependency:** Slice 3 consumes the Job-messaging feature, so that feature's brainstorm → plan → build should land around/before Slice 3.

Each slice: branch off current master, build from the design system, Playwright MCP screenshots vs. mockup + `ui-ux-pro-max` conformance pass, one Codex review right before push, PR with green CI.

## 10. Verification items / risks (this spec)
- **Notification deep-links** — *confirmed gap*: `notificationHref` (in `deriveNotifications.ts`) has no homeowner branch and falls through to `operatorNotificationHref` → `/admin-dashboard`. Add a homeowner branch → `/app/homeowner-dashboard?appointment=` (Slice 1a). `NotificationRole` already includes `'homeowner'` and `notificationTab` returns `'home'`.
- **`job_progress` is not currently selected** by `useHomeownerAppointments` (only checklist metadata is joined); the new `useHomeownerJobProgress` does its own targeted selects. `appointments` realtime already fires for the homeowner.
- **RLS correctness** — the new homeowner SELECT policy on `checklist_item_completions` must be own-appointment-scoped only; integration-test the negative case (cannot read another homeowner's completions). (`job_photos` homeowner read already exists — no change.)
- **Charge-at-completion receipt** — the completed recap reads payment state via `useHomeownerPayments` / the `paymentStatusMap` (both available); no new query.
- **Empty/skeleton states** — the hero's no-upcoming-cleaning state + basic per-screen empty states are in scope per slice, not deferred wholesale to R4.
- **Cancel fee disclosure** — the cancel confirm must surface any cancellation fee before charging.
- **Timestamps** — Slice 1b adds `started_at`/`completed_at` (lifecycle-stamped); these power elapsed-time here and the job-messaging grace window.
- **Job-messaging** — all six open decisions are now closed in `2026-06-29-job-messaging-design.md` §4 (per-stint threads, booking-context office-read, timestamp grace, job-thread-only notifications, sectioned inbox, kill-switch in Cleaner experience).

## 11. Gates (per repo workflow)
`ui-ux-pro-max` at implementation (design-system conformance), Playwright MCP fidelity loop vs. mockup, one Codex review per slice before push, `npm run test` + `npx tsc --noEmit` + `npm run lint`, `npx supabase db reset` for the migration slice. No em dashes in user-facing copy.
