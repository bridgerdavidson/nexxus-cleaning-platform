# Bookings Calendar Redesign -> "Scheduling Cockpit" - brainstorming session (2026-06-10)

Status: done (grill complete, 13 Qs); implementation plan written to the plan file

This is the grill-me **session log** (Q&A source of truth). The implementation plan is
derived from this and written separately to the plan file
(`~/.claude/plans/we-need-to-do-cheeky-beaver.md`).

---

## Context (why)

The Bookings "Calendar View" was built early on `react-big-calendar` and has drifted badly
from the rest of the app. The user wants it to look good and work much better for:
navigating the calendar, moving appointments around, clicking/viewing appointments, and
switching month/week/day/agenda. Open to restyle, library swap, or a custom rebuild. Also
rethinking **where** the calendar lives (currently a toggle in Bookings; maybe a "today's
agenda" belongs on Overview).

## Current-state findings (verified in code + live browser as admin@nexxus.com)

- **Component:** `src/components/CalendarView.tsx` (~770 lines) on **react-big-calendar
  v1.19.4** + `date-fns` v4 + the DnD addon, with heavy `<style jsx global>` overrides.
- **Wiring:** `src/components/BookingsPage.tsx` toggles list/calendar via `viewType`
  (List / CalendarDays icons). Calendar props: `appointments`, `onAppointmentClick`,
  `onDayClick`, `onSlotSelect`, `onReschedule`, `onLocalReschedule`, `canEdit`, `role`.
- **Views:** month / week / day / agenda via a `CustomToolbar`.
- **Click -> detail:** `onAppointmentClick` -> `AppointmentPanelHost` (URL `?appointment=<id>`,
  `useAppointmentPanel`). Month day-click -> `DayDetailSidebar` (right slide-in).
- **Drag-to-reschedule:** exists but fiddly: 300ms hold-to-distinguish-click + 750ms debounce
  deferred flush; no live preview. Calls `updateAppointment()` (`useAdminData.ts`) writing
  `scheduled_date` / `scheduled_time` (NOT duration; `duration_minutes` read-only).
- **Bugs / drift seen live:**
  - Most events render the customer as **"Unknown"** (title logic breaks for org-owned /
    self-pay properties with no homeowner).
  - Events hard-code a **60-min duration** (ignores `duration_minutes`) -> wrong heights.
  - Time grid hard-codes **year 2024, 6am-10pm**.
  - **Stale legend / colors** (pending/confirmed/in_progress/completed/cancelled), hard-coded
    + duplicated; `in_progress` painted **purple** in calendar vs **cyan** in `StatusBadge`.
    Calendar shows **no payment status** at all.
  - Switching to week view threw **5 console errors**.
  - Month density poor: ~1 event/cell then ambiguous "+N more" pale bars.
  - Week/day events are unreadable slivers; overlapping events collapse.
  - Agenda is the most usable (Date/Time/Event table) but redundant times, no
    cleaner/payment/actions, unstyled.
- **Roles:** admin, manager, cleaner all have a calendar (cleaner's is on its Jobs tab via the
  same `CalendarView`); homeowner has none. Overview "today" is a separate
  `TodayScheduleSection` (max 3 `CompactAppointmentRow`s).

## Design-system primitives to reuse

- `StatusBadge.tsx` (canonical status chips), `paymentStatusPill.ts` (payment chip),
  `StatTile.tsx`, `.card` class, `ToastContext` (`showToast`), `AppointmentPanelHost`
  (detail drawer), `AppointmentSidePanel`, `ConfirmModal`, `useDismissGuard`,
  `AddAppointmentModal` (create), `AssignCleanerModal` (assign). Tailwind: primary yellow
  #F7C41E; animations fade-in / slide-up / sheet-up / slide-in-right.
- Appointment row (admin): `scheduled_date`, `scheduled_time`, `duration_minutes`, `status`,
  `total_price`, `special_requests`, `series_id`, `cleaner_confirmation_status`,
  `response_deadline`, joined `homeowner` / `cleaner_profile` / `property` / `service_type`.
- **Deps already present:** `@dnd-kit/core` ^6.3.1, `@dnd-kit/sortable` ^10,
  `@dnd-kit/utilities` (drag; used today in `ServicesPage.tsx`), `motion` (Framer Motion v12,
  animation), `date-fns` v4. -> custom build adds **zero** new libs; removes rbc.
- **Reassign reality:** assigning a cleaner sets `status:'pending'` +
  `cleaner_confirmation_status:'awaiting'`. Canonical path `POST /api/appointments/assign-cleaner`
  (`forceAssign` conflict override, computes `response_deadline`, notifies). Direct helper
  `assignCleanerToAppointment` (`useAdminData.ts:1066`); decline auto-reroute `advanceRouting.ts`.

---

## Q&A

1. Q: Primary job of the calendar?
   A: **Scheduling cockpit** - admins/managers live here to run the week/day; read AND act
   (drag-reschedule, spot gaps/conflicts, assign cleaners). Most ambitious option.

2. Q: Where should the cockpit live in the nav?
   A: **Keep it in the Bookings list <-> calendar toggle** (rebuild the calendar into the
   cockpit there); no new nav item. Plus upgrade Overview's "Today" into a real agenda
   glance that deep-links into the Bookings calendar.

3. Q: Dispatch board (cleaners as columns) or a single status timeline?
   A: **Yes to the dispatch board** - add a "By cleaner" day view (cleaner columns); drag a
   job between cleaners = reassign, between times = reschedule. Biggest single build item.

4. Q: View set, dispatch placement, and default view?
   A: **Month / Week / Day / Agenda** (4 familiar tabs). **Day = the by-cleaner dispatch
   board**. Week = merged time-grid. Month = dense overview. Agenda = useful list (mirrors
   the Overview glance). **Default on open = Week.**

5. Q: Build vs library vs restyle?
   A: **Custom build + small DnD lib.** Own React components on the design system; delete
   react-big-calendar. Resolved by codebase: **@dnd-kit already installed + React 19** (used
   in `ServicesPage.tsx`); `motion` + `date-fns` already present. Net deps: ADD nothing,
   REMOVE rbc.

6. Q: What does an event's color primarily encode?
   A: **Status, layered.** Fill = appointment status (canonical StatusBadge palette); plus a
   cleaner avatar/dot, and a payment pill shown ONLY when there's a money problem.

7. Q: How should drag-to-reschedule behave?
   A: **Optimistic + instant save.** Live @dnd-kit DragOverlay preview, snap to 15-min grid,
   persist immediately on drop, toast confirm (Undo if supported), realtime to others. Drop
   the current 300ms-hold / 750ms-debounce model.

8. Q: What does dragging a job onto a DIFFERENT cleaner do (dispatch board)?
   A: **Full reassign + quick guard.** Runs canonical `/api/appointments/assign-cleaner`
   (status->pending, awaiting acceptance, notify, deadline); tiny inline confirm before
   firing; conflict surfaces a `forceAssign` "assign anyway?" override. Same-cleaner time
   drags stay instant (Q7).

9. Q: Mobile behavior?
   A: **Agenda-first, adapted views.** Phones default to the Agenda list; Month = tappable
   dots -> open day; Week = one day at a time / scroll; Dispatch "Day" = ONE cleaner at a
   time via a picker (no side-by-side columns), drag-time works, reassign = tap -> assign.
   Reuse MobileTopBar/Sidebar/FAB patterns.

10. Q: Which roles get the rebuilt calendar in this effort?
    A: **Admin + manager (full cockpit) + cleaner (scoped) now.** Cleaner gets the same
    rebuilt calendar scoped to their own jobs, WITHOUT the dispatch board. Homeowner
    unchanged (none). One consistent calendar everywhere it appears.

11. Q: How to deliver a build this size?
    A: **One big PR** (no feature flag). User accepted the larger-diff / single-cutover
    trade-off. Keep logically-grouped commits internally; de-risk with the full test suite +
    Playwright verification before merge. Replaces `CalendarView` directly.

12. Q: Dragging a recurring occurrence?
    A: **Move just that occurrence** (matches the independent-row model; shared `series_id`).
    Whole-series edits stay in the existing recurring-appointments flow.

13. Q: How should cross-cleaner reassign persist (Q8 correction, forced by the route reality)?
    A: **Add a proper `POST /api/appointments/reassign-cleaner` endpoint** - set the new
    cleaner, status->pending + confirmation->awaiting, compute `response_deadline`, fire the
    existing `cleaner_assigned` notification, optional server-side schedule-conflict check.
    Plus one integration test. Fully delivers Q8's original intent (new cleaner notified +
    must accept). The canonical `assign-cleaner` route stays for the routing/escalation flow.

---

## Decisions (settled)

- Core job = **scheduling cockpit** (read + act); drag-reschedule, conflict/gap visibility,
  cleaner assignment are first-class. Optimize for admin/manager on the week/day.
- Placement = **stays in Bookings** (list <-> calendar toggle); Overview's
  `TodayScheduleSection` becomes an agenda glance that deep-links into the calendar.
- **Dispatch board in v1**: "By cleaner" day view (columns). Drag between cleaners =
  reassign; drag between times = reschedule. (Largest build item.)
- Views = **Month / Week / Day(=dispatch) / Agenda**; default = **Week**.
- Engine = **CUSTOM build** on the design system. Remove `react-big-calendar` (+ types +
  CSS). DnD = **@dnd-kit** (already a dep). Animations = `motion`. Dates = `date-fns`.
- Event color = **status** (StatusBadge palette); cleaner = avatar/dot; payment pill only on
  money problems (reuse `paymentStatusPill`).
- Drag-reschedule = **optimistic + instant persist** (DragOverlay, 15-min snap, toast).
- Cross-cleaner drag = **full reassign via a NEW `POST /api/appointments/reassign-cleaner`**
  (Q13 correction): set cleaner + status:pending + confirmation:awaiting + response_deadline +
  `cleaner_assigned` notification + a real schedule-conflict check (inline confirm; "assign
  anyway?" overrides only the conflict). The canonical `assign-cleaner` route is NOT usable
  here (state-constrained; its `forceAssign` = accept-on-behalf). + integration test.
- Mobile = **agenda-first**, adapted views (no side-by-side columns; single-cleaner day).
- Roles = **admin + manager (full) + cleaner (scoped, no dispatch board)** this effort;
  homeowner unchanged.
- Delivery = **one big PR, no feature flag** (direct `CalendarView` replacement); grouped
  commits + full test + Playwright gate before merge.
- Recurring drag = **just that occurrence**.

## Verified risks / corrections (after Plan-agent + reading the route)

- **Q8 reassign route reality (CONFIRMED by reading `assign-cleaner/route.ts`):** the route
  only accepts `request_state in {awaiting_admin, needs_admin_attention, routing}` (`:63`),
  does NO schedule-conflict check, and `forceAssign` flips the job to `confirmed`/`approved`
  ("accept on the cleaner's behalf", `:158-171`). `AssignCleanerModal` also POSTs here
  (`:191`). => There is NO existing path to reassign a normal CONFIRMED job to a new cleaner
  with notify+deadline. The direct helper `assignCleanerToAppointment` (`useAdminData.ts:1066`)
  works on any job (sets cleaner_id + status:pending + confirmation:awaiting) but records NO
  notification and NO response_deadline. -> RESOLVED by Q13: build a new
  `POST /api/appointments/reassign-cleaner` endpoint instead.
- **Same-cleaner time drag does NOT reset confirmation** (`updateAppointment` leaves
  status/confirmation untouched). Default: keep that (moving a job's time does not force the
  cleaner to re-accept). Note for the plan; not re-grilling unless user objects.
- **Toast has no Undo/action button** (`ToastContext`). Ship reschedule confirm WITHOUT Undo
  ("if supported" in Q7); adding an action touches every call site -> out of scope.
- **Realtime channels do NOT dedupe** (`useSupabaseRealtimeSync` adds a `useId()` suffix). The
  cockpit must NOT add its own `appointments:{orgId}` subscription; it rides the existing
  `useAdminAppointments`/`useCleanerAppointments` cache invalidation. Optimistic = setQueryData
  on `keys.appointments.byOrg(orgId)` + rollback on error.
- **`canEdit` defaults true**; must default FALSE for `role==='cleaner'` (cleaners never drag).

## Resolved / implementation defaults (not user forks)

All grill questions resolved. Remaining items are implementation defaults to bake into the plan:
- Click event -> reuse `AppointmentPanelHost` (URL `?appointment=`).
- Click empty slot -> `AddAppointmentModal` prefilled (date/time, + cleaner on dispatch board).
- Month day-click -> open that date in Day view (replaces `DayDetailSidebar`).
- Fix the "Unknown" name (resolve org-owned/self-pay display: org name or property label).
- Event geometry from `scheduled_time` + `duration_minutes`; dynamic business-hours range.
- Realtime via `useSupabaseRealtimeSync` (patch the appointments channel).
- Overview glance = compact reuse of the new Agenda component, deep-linking into the calendar.
