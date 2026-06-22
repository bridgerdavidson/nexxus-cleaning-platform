# Redesign: Operator Bookings screen

Second operator screen of the dashboard redesign (Phase 2), following the
operator shell + Overview reference screen (PR #79). Same approach: a from-scratch,
flag-gated screen on the owned primitive kit that REUSES the existing headless
hooks unchanged, built in parallel with the 100%-live legacy app.

## Scope (this PR)

The data-dense operator Bookings cockpit: the full appointment roster with
search, time-based segments, status/cleaner filters, multi-select bulk actions,
a detail slide-over, and live updates. Complements (does not duplicate) the
Overview "Needs you now" exception-triage queue.

- Route: `/app/admin-dashboard/bookings` under `src/app/(redesign)/`. Nav repointed
  from the legacy fallback to this route.
- Container/View split mirroring the Overview:
  - `OperatorBookings` (container) wires `useAdminAppointments`, `useAdminCleaners`,
    `useManagerPermissions`, `useAuth`, `useToast`; owns filter/selection/detail/
    confirm state; maps `AdminAppointment` to view models; runs reuse-only mutations.
  - `OperatorBookingsView` (pure) renders header + filters + segment tabs +
    desktop table / mobile cards + states + bulk bar.
- Pure, unit-tested derivation (`deriveBookings.ts` + `.test.ts`): time segments
  (Today / Upcoming / Active / Past / All) mirroring the legacy predicates, plus
  free-text search, status filter, cleaner filter, and per-segment counts.
- Detail Sheet (`BookingDetailSheet`) with reuse-only actions: assign/reassign
  cleaner, accept a cleaner counter-proposal, mark started, mark complete (gated
  by manage-payments), cancel, delete (privileged), reschedule (legacy fallback).
- Bulk cancel/delete via the existing chunked `bulkAppointments` helpers, behind a
  ConfirmDialog. Selection is pruned to the visible rows so bulk actions never hit
  a hidden booking.
- Dev-only preview at `/bookings-preview` (under `(dev)`) renders the View + Sheet
  with mock data for no-login fidelity iteration.

## Reuse / gating notes

- Realtime comes for free: `useAdminAppointments` already wires
  `useSupabaseRealtimeSync`.
- Money is dollars (`total_price`), not cents.
- Payments are gated: `currentOrgRole === 'owner' || 'admin' || can_view_payments`
  (because `useManagerPermissions` returns all-false for admins). Mark-complete is
  additionally gated by manage-payments since completion triggers the charge.
- Status pill maps `confirmed` to the `scheduled` visual.

## Deferred (legacy fallback for now)

- New booking, reschedule, and the full create/edit flow fall back to the legacy
  bookings tab. Calendar view, and unassigning a cleaner, are out of scope here.

## Verification

- `npx tsc --noEmit`: no type errors in the new files.
- `npm run lint`: clean.
- `npm run test:unit`: 401 passing (incl. 13 new `deriveBookings` tests).
- Playwright: desktop table, mobile cards, and the detail Sheet screenshot-verified
  against the redesign house style; zero console errors.
