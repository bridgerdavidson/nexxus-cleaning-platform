# Redesign — Homeowner experience (design)

> Status: design direction approved (forks resolved 2026-06-29); written spec pending user review. Next: implementation plan via writing-plans (Slice 1 first).
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
  - Actions: **Message office** (persistent thread), **Message about this cleaning** (the per-cleaning job thread with the assigned cleaner, §4 Messages — available while the cleaning is active; lights up with Slice 3), **Cancel cleaning** (reuse the existing homeowner cancel/confirm path; late cancels trigger the cancellation-fee off-session charge already built into charge-at-completion).
  - Read-only details: property/address, special requests, price/receipt.
- **No reschedule** (deferred — see §8). **No after-the-fact editing.**

### Messages
The homeowner Messages tab has two kinds of thread, built on the cleaner Slice 5 inbox + operator `ChatThread.tsx` in a `MobileTakeover`, with an unread badge on the nav tab (`messagesUnread` from `useConversations`):
1. **Office** (persistent) — the existing homeowner↔operator thread, always available. Unchanged from today.
2. **Per-cleaning job threads** (new, scoped) — see "Job messaging" below. They appear contextually while a cleaning is active and as read-only history after.

There is **no compose-to-a-person entry point** for cleaners. Job threads are reachable only from a cleaning, so a homeowner can never start a conversation with an arbitrary cleaner (and vice versa).

#### Job messaging (homeowner ↔ assigned cleaner) — cross-cutting feature
Original stakeholder stance was homeowner↔operator and cleaner↔operator only (no direct homeowner↔cleaner). This adds a **tightly-scoped** direct channel for real coordination (cleaner running late, homeowner pre-job info) without opening arbitrary contact.

- **Model:** a thread is a property of an **appointment**, not a contact. It exists only because a specific homeowner + assigned cleaner share that job, so arbitrary contact is impossible by construction. One thread per appointment (incl. each instance of a recurring series).
- **Lifecycle (send window):** send-enabled from **cleaner-assigned** until **completed + a short grace window (default 24h)** for immediate follow-ups; a cancelled appointment closes immediately. After the window the thread is **archived read-only** (sending disabled, history preserved) — never deleted. Temporary *access*, permanent *record*.
- **Visibility:** homeowner + assigned cleaner + **the office (org staff, read-only)**. The parties know it is not fully private — supports oversight, dispute resolution, and discourages taking the relationship off-platform.
- **Org control (kill switch):** a per-org toggle `organizations.homeowner_cleaner_messaging_enabled` (**default `true`** / opt-out) in operator Settings → "Cleaner experience" (owner/admin only), reusing the existing org-settings update path. When **off**: no job-thread entry points render, and the **send-gating guard rejects sends server-side** (defense in depth, not just hidden UI); existing job threads go read-only with history retained. Scope is messaging only — the persistent **Office** threads and **live tracking** are unaffected, so an org can disable cross-party chat while still letting homeowners watch progress + photos.
- **Reassignment:** the active thread follows the appointment's current `cleaner_id`; a reassigned-away cleaner keeps read access to messages from their assignment but cannot send.
- **PII minimization:** first names + in-app only; no phone/email exchanged. Keeps comms on-platform.
- **Quick presets** layered on free text for the common cases: cleaner "On my way" / "Running ~15 min late"; homeowner pre-job "access & notes". (Presets can be a fast-follow if they balloon the slice.)
- **Entry points:** homeowner reaches the thread from the cleaning (Home hero / Cleanings detail "Message about this cleaning") while active; the cleaner reaches it from the job — a **companion update to the already-merged, office-only cleaner Messages**.
- **Backend shape:** `conversations` is currently a pure user-pair table (`participant_1_id`/`participant_2_id`; no `appointment_id`/`organization_id`); `messages` already carries `appointment_id` (PR #88). Migration: add nullable `appointment_id` (+ index, FK cascade) to `conversations` (NULL = standing office/user threads; set = job thread keyed by appointment); add `organizations.homeowner_cleaner_messaging_enabled boolean NOT NULL DEFAULT true`; RLS for participant + org-staff read; **send-gating** (server route + guard) allowing inserts only when the appointment is active, the org flag is on, and the sender is the current homeowner/assigned cleaner; realtime is already on `conversations`/`messages`. Add a `message_received` notification to the counterparty via the existing `notification_events` outbox.
- **Cross-cutting note:** this is a backend-bearing feature consumed by the homeowner Messages tab AND a cleaner-app update AND office read-only visibility — not a homeowner-only screen.

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
| **In progress** | `appointments.job_progress` enum + `checklist_item_completions` count | Cleaner + **stage label** (before-photos → cleaning → after-photos) + **live checklist progress bar** ("8 of 14 tasks done") + elapsed time + a **before-photo peek**, updating in **real time**. |
| **Complete** | `appointments.status` + `job_photos` + payment | "Cleaning complete" recap: **after-photos**, checklist-done summary, and **receipt** (charge-at-completion amount/status). |

**Why this combination:** `appointments.job_progress` (`not_started → before_photos → checklist → after_photos → completed`) gives the coarse stage label and is already homeowner-readable + realtime. The fine **"X of Y"** granularity (the actual wow) comes from counting `checklist_item_completions` against the appointment's checklist line-item total (the checklist structure is already joined into `useHomeownerAppointments`). Enum-only was considered and rejected — it loses the per-task progress that makes the feature feel alive.

### Data access — one small migration required

Today a homeowner **cannot** read `checklist_item_completions` or `job_photos` (RLS is cleaner/org-staff only), and `checklist_item_completions` is not in the realtime publication. The job-photos storage bucket **is public** (verified: `storage.buckets.public = true` for `job-photos`), so `photo_url` renders directly — **no signed-URL route needed**.

New migration (next sequential number, e.g. `097`):
1. **Homeowner SELECT RLS on `checklist_item_completions`** — scoped to appointments the user owns (`EXISTS (SELECT 1 FROM appointments a WHERE a.id = checklist_item_completions.appointment_id AND a.homeowner_id = auth.uid())`). Add alongside the existing `cic_cleaner_rw` / `cic_org_read` policies (do not modify those).
2. **Homeowner SELECT RLS on `job_photos`** — same own-appointment scoping. Add alongside the existing cleaner-only policies.
3. **Realtime**: add `checklist_item_completions` to the `supabase_realtime` publication + `ALTER TABLE ... REPLICA IDENTITY FULL` (template: `048_invites_realtime.sql`). `job_photos` is already realtime-enabled; `appointments` realtime already drives the homeowner appointments hook.

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
- **Homeowner↔cleaner messaging IS in scope** (per the brainstorm) as the scoped per-cleaning job thread in §4 — not deferred.
- **Backend changes** — two migrations: the live-tracking RLS+realtime migration (§5) and the job-messaging migration (§4 Messages). No others.

## 9. Slice plan (one PR per slice, like the cleaner app)

**Slice 1 — Shell + Home + Live cleaning tracking (the headline).**
Route group + `HomeownerShell` + `HomeownerBottomNav`; `getDashboardPath` homeowner case + notification href routing; Home greeting + `NotificationBell`; the **lifecycle hero** (all three states) + `LiveCleaningProgress` + `CompletedCleaningRecap`; pending-request cards + cancel; "Request a cleaning" button + FAB → legacy modal; **the migration** (homeowner RLS on `checklist_item_completions` + `job_photos`, realtime on completions) + `useHomeownerJobProgress` + photo read. *(Large slice by the user's choice — lands the demo "wow" in PR 1. If PR size balloons in planning, the migration + progress engine may be a stacked sub-PR.)*
Tests: `useHomeownerJobProgress` unit (count/percent/stage derivation), migration `db reset` + RLS integration (homeowner can read own completions/photos, cannot read others').

**Slice 2 — Cleanings.** List (Upcoming/Past) + deep-linkable detail takeover (`?appointment=`) reusing the hero/tracking/recap; cancel + message actions. Tests: list grouping/sort derive; detail deep-link.

**Slice 3 — Messages + job messaging (cross-cutting, backend-bearing).** Migration (`conversations.appointment_id` + index/FK, `organizations.homeowner_cleaner_messaging_enabled` default true, RLS incl. office read-only, send-gating guard) + get-or-create job thread + `message_received` counterparty notification; homeowner Messages tab (persistent Office thread + active/archived per-cleaning job threads) with entry points from Home/Cleanings; **companion cleaner-app update** so the cleaner can read/send the per-job thread (today's cleaner Messages is office-only); **org kill-switch toggle** in operator Settings → "Cleaner experience" (owner/admin). The biggest backend slice — the migration + send-gating + cleaner-app wiring may stack as a sub-PR under the homeowner UI. Tests: send-gating (blocked after complete/cancel, blocked when org flag off, only current participants can send), RLS negatives (non-participant / non-org-staff cannot read), reassignment access, thread derivation.

**Slice 4 — Account.** Properties (CRUD), payment methods (Stripe-gated), payment history/receipts, browse services, profile/settings. Tests: per existing route coverage; presentation built fresh.

Each slice: branch off current master, build from the design system, Playwright MCP screenshots vs. mockup + `ui-ux-pro-max` conformance pass, one Codex review right before push, PR with green CI.

## 10. Verification items / risks
- **Notification deep-links** for homeowner must resolve to `/app/homeowner-dashboard?appointment=` (confirm `navigation.ts` href building covers homeowner; add if missing — Slice 1).
- **`appointments` realtime for `job_progress`** drives the in-progress stage label; the homeowner appointments hook already subscribes, so stage changes invalidate. Confirm `job_progress` column changes propagate (it's on the appointments row).
- **RLS correctness** — the new homeowner SELECT policies must be own-appointment-scoped only; integration test the negative case (cannot read another homeowner's completions/photos).
- **Charge-at-completion receipt** — the completed recap reads payment state; reuse `useHomeownerPayments` rather than a new query.
- **Job-thread send-gating** must be enforced server-side (route + RLS), not just hidden in the UI — a homeowner/cleaner could otherwise POST to a closed, non-owned, or org-disabled thread. Integration-test the closed-window, org-flag-off, and non-participant cases.
- **Reassignment** — decide whether the job thread's cleaner participant is stored (and rebound on reassignment) or derived from the appointment's current `cleaner_id`; the reassigned-away cleaner must retain read-only access to their own messages but lose send. Resolve in the plan.
- **Office read-only** — operators can read job threads but should not inject into the homeowner↔cleaner thread (their channel is the separate Office thread); enforce read-vs-write in RLS/route.

## 11. Gates (per repo workflow)
`ui-ux-pro-max` at implementation (design-system conformance), Playwright MCP fidelity loop vs. mockup, one Codex review per slice before push, `npm run test` + `npx tsc --noEmit` + `npm run lint`, `npx supabase db reset` for the migration slice. No em dashes in user-facing copy.
