# Mobile operator calendar (mini month + day list)

**Date:** 2026-07-16
**Status:** Approved by Bridger (brainstorm session, visual companion)
**Scope:** Operator (admin + manager) calendar at widths below Tailwind `md` (768px). Desktop is untouched. Cleaner and homeowner calendars are out of scope.

## Problem

The redesigned operator calendar (`src/components/redesign/calendar/`) was built desktop-first. At phone widths the Week grid compresses 7 day columns into ~44px slivers, Month cells shrink to ~53px with truncated pills, the toolbar stacks into ~300px of chrome with a duplicated New-booking CTA (toolbar button + shell FAB), and drag-to-reschedule fights touch scrolling. Only the Agenda view holds up.

## Product decisions (made in the brainstorm)

1. **Mobile job:** quick glance + light actions. See what's happening, tap into a booking, reschedule through the booking sheet. Heavy planning (dragging jobs around a week) stays desktop.
2. **Structure:** mini month grid + selected-day list (iOS Calendar pattern). Chosen over a week-strip+list and a full-width day timeline.
3. **Landing view on mobile:** the mini month, with today pre-selected (replaces the current default-to-Agenda-on-mobile behavior). Upcoming (the existing agenda) is the second view.
4. **No Week or Day views on mobile.** No drag-and-drop on touch.
5. **Workload dots are status-colored**, using the existing `calendarStatus()` vocabulary: amber pending, warm-gray confirmed, blue in-progress, green completed, red overdue.
6. **Days with 4+ bookings** swap the dots for a small bold count (dots only for 1-3).
7. **Today** renders as a full brand-blue chip: white number, white dots/count. (Today's per-status colors are sacrificed knowingly; today is the default selection so its statuses are spelled out in the list below.) Selected non-today days get a subtle on-system selected treatment instead.

## Design

### Mobile header (two compact rows)

- Row 1: bold month label left ("July 2026"; reads "Upcoming" in the agenda view), prev/Today/next controls right.
- Row 2: the two-option Month/Upcoming segmented toggle left, filter button (funnel) right.
- Total header height stays under ~100px (versus ~300px of stacked toolbar today).
- All controls have >=44px hit areas (visuals may be smaller; extend hit area via padding).
- The toolbar "New booking" button does not render on mobile. The shell FAB (`OperatorMobileNav`) owns creation and stays generic (no date prefill).
- Navigation is chevrons + Today. No swipe gestures in v1 (visible controls; horizontal swipe conflicts with vertical scroll).

### Mini month grid

- Grid from the existing `monthMatrix()`; 7 equal columns; each day cell is a `<button>` >=44px tall.
- Cell content: date number; below it the workload signal:
  - 1-3 bookings: that many status dots, colors from `calendarStatus().dotClass`, in start-time order.
  - 4+ bookings: a small bold count instead of dots.
  - 0 bookings: empty space (fixed-height slot so rows don't jiggle).
- Today: full brand-blue rounded chip wrapping number + dots/count, all white.
- Selected (non-today): muted chip + ring from system tokens.
- Outside-month days: dimmed, tappable; tapping navigates to that month and selects the day.
- a11y: each cell gets an aria-label ("Wednesday, July 22, 5 bookings") and selected state semantics, so color/dots are never the only channel.
- Month paging: chevrons step months; Today returns to the current month and selects today. On month change, selection = today when visible, else the 1st.

### Day list (under the grid)

- Header: "Today · Thu, Jul 16" (or weekday + date).
- Rows reuse `AgendaRow` unchanged: same card, status pill, tap opens the booking detail sheet. Reschedule happens in the booking sheet / `RescheduleDialog`, never by dragging.
- Empty day: compact empty state ("Nothing scheduled"), plus a "Book this day" button gated by the existing `canEdit` (privileged roles or `can_edit_bookings`) that opens the new-booking flow with the selected date prefilled (existing `openNewBooking(date)` path).
- List scrolls with the page; bottom padding clears the FAB + bottom nav.

### Upcoming view

- The existing `AgendaView`, unchanged. Header label becomes "Upcoming"; chevrons/Today still step the anchor date.

### Filter sheet

- Funnel button opens a bottom sheet (existing sheet primitive) containing the same cleaner + status selects, full width, >=44px targets.
- Active filters show a badge dot on the funnel button.
- Filters apply to grid dots and both lists (same `filtered` array as desktop).

## Architecture

New files, all in `src/components/redesign/calendar/`:

| File | Responsibility |
|------|----------------|
| `MobileMonthView.tsx` | Mini grid + selected-day list |
| `MobileCalendarBar.tsx` | Compact mobile header row |
| `CalendarFilterSheet.tsx` | Bottom-sheet filters |
| `monthCellSummary.ts` | Pure helper: events -> per-day {dots, count} model |

`OperatorCalendar` keeps owning all state (navigation, filters, selected day, dialogs) and branches on the existing `useIsMobile()`. Shared, not duplicated: `useAdminAppointments`, `deriveCalendarEvents`, `calendarStatus`, `useCalendarNavigation`, `RescheduleDialog`, `useOpenBookingDetail`, `AgendaView`/`AgendaRow`. No new data fetching, no schema changes, no route changes. The `useEffect` that forces Agenda on mobile is removed; mobile defaults to the mini month.

Rejected approaches: (B) CSS-responsive retrofit of `MonthView` (forked tap semantics and styling in one component; desktop regression risk); (C) building on `ui/calendar.tsx` / react-day-picker (a date-picking primitive whose fixed cell sizing and selected/today styling fight the chip + dots design; grid math already exists in `monthMatrix`).

## UI implementation & styling source

The browser-companion mockups from this session are UX/structure reference ONLY. Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand blue, Plus Jakarta Sans, warm canvas, soft shadows, the rounded scale). Do not copy ad-hoc colors, raw hex, or bespoke classes from a mockup. Dot colors come from the existing semantic status classes exposed by `calendarStatus().dotClass`; the today chip uses brand tokens. If a needed pattern has no primitive yet (the mini-month day cell), build it as a reusable component that matches the system, never an inline one-off. Run ui-ux-pro-max at implementation for design-system conformance.

## Testing

- Unit tests for `monthCellSummary`: dot ordering by start time, the 4+ count swap, 0-booking days, month boundaries/outside days, filter interaction.
- Existing `deriveCalendar` / `calendarStatus` tests keep covering the shared layer; no changes expected to existing tests.
- Verification: Playwright screenshots at 390px (month grid with seeded multi-status data, a 4+ day, an empty day, the filter sheet, Upcoming) and at desktop width to prove `md`+ is unchanged. No em dashes in any user-facing copy.

## Out of scope / follow-ups

- Cleaner and homeowner calendar mobile work.
- Swipe gestures between months/days (possible v2 polish).
- Date-aware shell FAB (FAB stays generic; "Book this day" covers prefill).
- Tablet-specific (768-1024px) tuning; desktop layout serves `md`+ as today.
