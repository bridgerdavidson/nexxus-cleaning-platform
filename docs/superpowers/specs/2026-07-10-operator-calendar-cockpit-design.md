# Operator Calendar Cockpit (R1) — Design Spec

**Status:** approved-in-brainstorm 2026-07-10 (Bridger). Feeds `writing-plans` → `subagent-driven-development`.
**Audit gap:** R1 in `docs/redesign/2026-07-09-functionality-audit.md` — "the single biggest missing surface."
**Branch:** `feat/operator-calendar-cockpit`.
**Companion mockups (UX/structure reference ONLY):** `.superpowers/brainstorm/52210-1783707329/content/{calendar-week-v2,calendar-views-mda}.html`.

---

## UI implementation & styling source (read first, binding)

The browser-companion mockups referenced above are **UX/structure reference ONLY**. Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (redesign ramps: brand `#0150FC` = `brand-600` on the warm canvas `#F7F6F3`, Inter with tabular numerals, soft "pillowy" shadows `shadow-soft-{sm,md,lg}`, radius scale `rounded-card` 22px / `rounded-control` 14px / `rounded-pill`). Do **not** copy ad-hoc colors, raw hex, or bespoke classes from a mockup into shipped code. Status and urgency are expressed in our **badge/pill vocabulary** (`src/components/ui/badge.tsx` variants), never as decorative left-edge accent bars or stripes. If a needed pattern has no primitive yet, build it as a reusable primitive that matches the system, not an inline one-off. Run `ui-ux-pro-max` at both the design and implementation phases.

The mockups' hex values exist only so the reference *looks* like our brand; the shipped components must consume the real tokens/primitives, which render the same look through the system.

---

## Goal

Give operators (owner/admin/manager) a redesign-shell **calendar cockpit** to see and manage the org's cleanings across Month / Week / Day / Agenda views, with drag-to-reschedule, click-to-open-detail, and click-empty-slot-to-create — built entirely in our design system, on the **same appointment data and behaviors** the legacy `CalendarCockpit` used. It closes the last big legacy-parity gap and removes the final reason an operator would drop back into the legacy dashboard.

## Architecture (2-3 sentences)

A new **view layer** under `src/components/redesign/calendar/` renders four calendar views from our design system, consuming the **already-built, tested pure logic** in `src/lib/calendar/*` and `src/lib/appointmentConflicts.ts` (business-hours derivation, overlap lane-packing, date ranges, display-name resolution, conflict detection) plus the existing realtime data hook `useAdminAppointments`. All mutating interactions **reuse shipped surfaces**: a drag pre-seeds the existing `RescheduleDialog` (R2), a click opens the existing `?booking=` detail host, and an empty-slot click opens the existing `?newbooking=` sheet. Model-specific dispatch behaviors (per-cleaner lanes, cross-cleaner drag-assign, availability shading) are designed as **dormant seams keyed on `organizations.default_payout_model`** and stay off until the hourly model + a cleaner-availability system ship.

## Tech stack

Next.js 16 App Router (redesign route group), React 19, TypeScript, Tailwind v3 (redesign tokens), `@dnd-kit/core` + `@dnd-kit/utilities` (already dependencies; legacy used the same), TanStack Query via `useAdminAppointments`, Supabase realtime (existing org channel). No new dependencies, no new API routes, no migrations.

## Global Constraints

- **Design system only** for all visuals (see the binding section above). No legacy styling, no raw hex in components, status via badge vocabulary.
- **Same data + behaviors as legacy**, different look. Reuse `src/lib/calendar/*`, `src/lib/appointmentConflicts.ts`, and `useAdminAppointments` rather than re-deriving.
- **No em dashes** in any user-facing copy (labels, toasts, empty states). Use periods, commas, parentheses, or "to" for ranges.
- **Reuse mutating surfaces** — never write a new reschedule/create/cancel path; drive `RescheduleDialog`, the `?booking=` host, and the `?newbooking=` sheet.
- **Now-indicator uses brand blue** (`brand-600` / `#0150FC`), not red. Red is reserved for `critical`/Overdue in this same calendar.
- **Model seam is `organizations.default_payout_model`.** First cut supports `percentage_contractor` (the only shipped model). The `hourly_external` (and future "cleaner-sets-pay") behaviors are documented dormant seams, not built.

---

## Background: why the calendar is model-aware

Payment model is downstream of the real question a calendar answers: **how does a job get onto a cleaner?** Our shipped `src/lib/appointments/rescheduleOutcome.ts` already splits the world:

- **`percentage_contractor` (offer-based, the only built model):** a job is *offered*. The operator routes it; the cleaner accepts / counter-proposes / declines against a response deadline (the R10 SLA machinery). A reschedule *re-asks* the cleaner on a tiered deadline unless the new time matches one they already suggested.
- **Anything else (dispatch-based; `hourly_external` enum exists, flow not built):** the job is *dispatched*. `decideRescheduleOutcome` settles it instantly — no offer loop, no deadline.
- The future "cleaner-sets-own-pay" model is a payout variant of contractor and behaves offer-based for scheduling.

Consequence: the calendar's **viewing** value is universal, but its **dispatch** value (free drag-to-assign across people) is muted in the contractor model (every drag fires an offer loop) and only fully pays off in the hourly/employee model (instant dispatch + availability lanes). So we build the universal half now and architect the dispatch half as a dormant, model-gated seam.

---

## Scope

### In scope (first cut)

1. **Own nav destination** in the operator shell: a "Calendar" sidebar item, route `/app/admin-dashboard/calendar` (redesign group), deep-linkable. Gated on `can_view_bookings`.
2. **Four views**: Month, Week, Day (single-day time grid), Agenda. Agenda is the mobile default.
3. **Event rendering** in our design system: full card (time, property, service, status badge, cleaner avatar, recurring marker) with a **compact variant** for short jobs, all text truncated (nothing spills the card).
4. **Status vocabulary** mapped to our badge variants (below), including a derived **Overdue** overlay that reuses R10's predicate for cross-consistency with the Overview queue.
5. **Now-indicator** (brand-blue line + dot) on today's column in Week/Day, updating ~every 60s, within the derived business-hours window.
6. **Drag-to-reschedule** (same-cleaner time/date change): drag → drop on a new slot → opens `RescheduleDialog` pre-seeded with the target date/time. The operator sees the outcome preview (contractor: "re-asks Cleo, 4h deadline"; hourly: settles) and the conflict warning, then confirms. Reuses `useRescheduleBooking` and the shipped outcome logic. Terminal-status jobs (completed/cancelled) are read-only (not draggable) but still clickable.
7. **Click a job** → opens the booking detail sheet in place via the existing `?booking=` host (`OperatorBookingDetailHost`).
8. **Click an empty slot** → opens the existing `?newbooking=` sheet, pre-seeded with the clicked date (and time in Week/Day). Requires extending `operatorBookingParams` to carry optional `date`/`time`.
9. **Filters**: cleaner filter + status filter in the toolbar (client-side over the loaded appointment set).
10. **Navigation**: prev/next (granularity per view), Today, and the four-view segmented control. Responsive; Agenda default under the `md` breakpoint, without clobbering an explicit view choice on resize.

### Dormant seams (designed now, built when the models ship) — NOT implemented

- **Day-view per-cleaner lanes (dispatch board):** the Day view's layout strategy is a swappable input (`'time-grid'` now; `'cleaner-lanes'` later) chosen from `default_payout_model`. Legacy's `src/lib/calendar/dispatchColumns.ts` (column building) is reused when this lights up.
- **Cross-cleaner drag-to-assign + hard conflict enforcement:** only meaningful in dispatch mode. In the contractor cut, changing the cleaner happens through the reschedule dialog's picker, not a drag.
- **Availability shading:** per-cleaner working-hours overlay in Day/Week, dependent on a cleaner-availability system that does not exist yet.

### Out of scope

- Per-attempt routing/decline history (the other half of R10; a booking-sheet section, tracked separately).
- Recurring-series editing UI beyond the existing recurring marker.
- Any new API route, migration, or Stripe change.
- The legacy `CalendarCockpit` and `src/components/calendar/*` are left untouched (still used by legacy dashboards until cutover).

---

## Placement & routing

- New route `src/app/(redesign)/app/admin-dashboard/calendar/page.tsx` (thin wrapper) rendering `<OperatorCalendar />`.
- New nav item "Calendar" in the operator shell sidebar, between "Bookings" and "Customers", gated on `can_view_bookings` (mirrors how the booking-detail host is gated). Icon from `lucide-react` (`CalendarDays`), consistent with sibling nav items.
- The `?booking=` and `?newbooking=` hosts already mount at shell level, so opening a detail sheet or the new-booking sheet from the calendar works in place with no navigation away.

---

## Design language & components

### Status → badge vocabulary (matches the rest of the redesign's hierarchy)

The hierarchy mirrors the Overview/bookings presenters: amber = needs you, gray = settled, blue = live, green = done, red = problem.

| Appointment state | Badge variant | Label | Dot color (compact) |
|---|---|---|---|
| pending, awaiting cleaner | `caution` | Pending | `caution` amber |
| pending + `response_deadline` passed (R10 predicate) | `critical` | Overdue | `critical` red |
| confirmed | `secondary` (warm-gray) | Confirmed | `warm-400` |
| in_progress | `info` | In progress | `info` sky |
| completed | `positive` | Completed | `positive` green |
| cancelled | `secondary` muted, event de-emphasized + read-only | Cancelled | `warm-400` |

- **Counter-proposed** (a pending job carrying `cleaner_availability_feedback` suggestions) renders as **Pending** in the calendar; the suggestions surface when the job is opened (the `RescheduleDialog` already shows suggestion chips). No calendar-specific status is introduced.
- **Overdue** is derived, not stored: reuse the exact predicate from `deriveOverview` (`status === 'pending' && cleaner_id != null && cleaner_confirmation_status === 'awaiting' && response_deadline < now`) so the calendar and the Overview "Response overdue" bucket always agree. Extract a shared `isResponseOverdue(appt, nowMs)` helper that both `deriveOverview` and `deriveCalendar` call, so the two can never drift.

### Event block anatomy

- **Full card** (blocks tall enough): time (tabular) → property/customer (bold, truncated) → service (muted, truncated) → footer pinned to the bottom with the status badge + cleaner avatar; recurring series marked with a small `Repeat` icon (`lucide-react`) next to the name. `overflow-hidden` + ellipsis on every text line; footer never clipped.
- **Compact card** (short jobs, below a height threshold): one row of status dot + name (truncated) + avatar, with time + service on a micro-line. Full detail on click. This prevents the clip Bridger flagged; short blocks never try to render four lines.
- **Month pill**: a compact tinted pill (status `-50` tint bg + `-700` text) with a leading status dot and truncated "`time` `property`"; "+N more" (brand-700) when a day overflows its visible pill count.
- **Agenda row**: a `rounded-control` card — time+duration column, property + service, status badge, cleaner avatar+name.
- All of the above are built from `Badge`, our avatar treatment, and design-system tokens. No accent stripes.

### Now-indicator

Brand-blue (`brand-600`) 2px line spanning today's column with a left dot, positioned by current time within the derived business-hours window, refreshed on a ~60s interval, only rendered when "now" falls inside the visible window and only on today (Week/Day).

---

## The four views (behavior)

- **Month:** 5-6 week grid (Mon-start, consistent across views), today's date numeral in a brand circle, other-month days dimmed. Up to 3 status pills per cell + a "+N more" affordance (which switches to that Day). Empty-cell click → create for that date (no time). Event pill click → open detail.
- **Week:** 7 day columns + left time gutter, business-hours window derived from the week's events (`deriveBusinessHours`, 7am-7pm floor/ceiling like legacy). Overlapping events lane-packed via `packEventsIntoLanes`. Now-line on today. Drag a job to a new slot → reschedule dialog. Empty-slot click (15-min snap) → create for that date+time.
- **Day:** single-day time grid, wider column so full cards show the service line and full cleaner name. Same overlap packing, now-line, drag, and empty-slot create (date+time). **Dormant seam:** the column is a single lane now; `default_payout_model === 'hourly_external'` would render one lane per cleaner (`dispatchColumns.ts`) with availability shading.
- **Agenda:** flat chronological list grouped by day (Today / Tomorrow / weekday · date), each row a card. Mobile default. Row click → open detail. No drag or empty-slot create in Agenda (matches legacy).

---

## Interactions & reuse

| Interaction | Reuses |
|---|---|
| Drag job → new day/time | `@dnd-kit/core` context in the cockpit shell; on drop, open `RescheduleDialog` with `init={{ date, time }}` and the job's appointment; the dialog runs `useRescheduleBooking` + the shipped `rescheduleOutcome`/`conflictFor` logic (outcome preview + conflict warning + force path already built). |
| Click job | `OperatorBookingDetailHost` via `?booking=<id>` (already shell-mounted). |
| Click empty slot | `?newbooking=` sheet; extend `operatorBookingParams` to accept `{ date?, time? }` so the new-booking form seeds. |
| Realtime updates | `useAdminAppointments` (org `appointments:${orgId}` channel; invalidate-and-refetch). Calendar is purely derived from its appointment array. |
| Business hours / overlap / conflicts / display names / date ranges | `src/lib/calendar/{businessHours,overlapLayout,dateRange,groupEvents,resolveDisplayName,timeGrid}.ts` + `src/lib/appointmentConflicts.ts` (pure, already tested). |

Drag is disabled for terminal-status jobs and for users without `can_edit_bookings` (calendar becomes read-only viewing for them). Keyboard drag via `@dnd-kit` `KeyboardSensor` for accessibility; every event block is a labelled control (status + customer + time + service in the accessible name), status conveyed by label text, not color alone.

## The model seam (explicit, for the future build)

A single derived value gates dispatch behavior:

```ts
type CalendarMode = 'schedule' | 'dispatch';
// schedule  = offer-based (percentage_contractor, future cleaner-sets-pay): view + reschedule-dialog
// dispatch  = dispatch-based (hourly_external): per-cleaner lanes, drag-assign, availability shading
const mode: CalendarMode =
  org.default_payout_model === 'hourly_external' ? 'dispatch' : 'schedule';
```

First cut hard-codes `'schedule'` behavior and documents each `dispatch` branch as a TODO seam at its call site (Day-view layout, drag-drop target semantics, availability overlay). When the hourly model + availability system ship, lighting up `dispatch` is additive, not a rewrite: the Day view swaps its column-builder to `dispatchColumns.ts`, the drop handler gains a cross-cleaner assign path, and an availability layer renders behind events. No change to the four views' chrome, the event components, or the data layer.

## Permissions

- **See the Calendar tab / view:** `can_view_bookings` (privileged owner/admin always).
- **Drag-to-reschedule:** requires `can_edit_bookings` (same gate as the reschedule dialog's same-cleaner path). Without it, the calendar is read-only: jobs open for viewing, but drag is disabled and empty-slot create is hidden.
- **Create from empty slot:** `can_edit_bookings` (the new-booking sheet enforces its own gate too).

## Architecture / file structure

New, under `src/components/redesign/calendar/`:
- `OperatorCalendar.tsx` — hook-backed container: pulls `useAdminAppointments`, derives events, owns view + focused-date state and the `@dnd-kit` context; renders the view.
- `CalendarToolbar.tsx` — date nav + Today, four-view segmented control (`SegmentedControl`), cleaner + status filters, New-booking primary.
- `MonthView.tsx`, `WeekView.tsx`, `DayView.tsx`, `AgendaView.tsx`.
- `EventBlock.tsx` (full + compact), `MonthEventPill.tsx`, `AgendaRow.tsx`, `NowIndicator.tsx`.
- `deriveCalendar.ts` — pure: appointment[] → `CalendarEvent[]` (reusing `resolveDisplayName`, parsing to `startMin`/duration), status classification + Overdue overlay (shared with `deriveOverview`'s predicate), badge-variant mapping. **Fully unit-tested.**
- `useCalendarNavigation.ts` — view + focused-date + prev/next stepping.
- `calendarDrop.ts` — pure encode/decode of drop targets (`slot:<date>:<min>`, `day:<date>`) + drop→reschedule-init mapping. **Unit-tested.**

Route: `src/app/(redesign)/app/admin-dashboard/calendar/page.tsx`. Nav item added to the operator shell sidebar. Extend `operatorBookingParams` for slot-create prefill. Reuse `src/lib/calendar/*` and `src/lib/appointmentConflicts.ts` as-is (no changes to those files beyond what a new consumer needs).

## Testing strategy

- **Unit (pure, co-located `*.test.ts`):** `deriveCalendar` (event mapping, status classification incl. the Overdue predicate matching `deriveOverview`, compact-threshold selection), `calendarDrop` (encode/decode, drop→init), `useCalendarNavigation` stepping. The existing `src/lib/calendar/*` and `appointmentConflicts` tests already cover business hours, overlap packing, and conflicts.
- **No new integration tests** (no new API route; the reschedule/create/detail routes keep their existing suites).
- **Browser smoke** at implementation: each view renders, a drag opens the pre-seeded reschedule dialog, a click opens the detail sheet, an empty-slot click opens the seeded new-booking sheet, now-line is brand blue and positioned correctly.
- **ui-ux-pro-max** conformance pass at implementation (design-system tokens, no raw hex, touch targets, contrast).

## Follow-ups (not this build)

- Hourly-model dispatch board (lanes, drag-assign, availability) — lights up the dormant seam.
- Per-attempt routing/decline history section (R10 remainder).
- Retire the legacy `CalendarCockpit` + `src/components/calendar/*` at cutover once this replaces it everywhere.
