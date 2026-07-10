# Reschedule + Edit Booking (Operator Redesign) — Design

**Date:** 2026-07-09
**Audit gaps:** R2 (reschedule flow) + R3 (edit booking after creation) from `docs/redesign/2026-07-09-functionality-audit.md`
**Approach chosen:** Split surfaces — a focused Reschedule dialog + a light "Edit details" body-swap in the booking detail sheet (approach B of the brainstorm; browser-companion mockups reviewed and approved).

## Problem

The redesigned `BookingDetailSheet`'s Reschedule button is the last §2 escape besides the Fix card: `OperatorBookingDetailHost.handleReschedule` does `router.push('/admin-dashboard?tab=bookings&appointment=<id>')`. After cutover there is no reschedule at all, and the sheet is read-only apart from assign/status/cancel (no post-creation editing of service, checklist, price, requests, or notes).

Legacy "reschedule" is actually three divergent write paths:

1. `RescheduleAppointmentModal` (only reachable for cleaner-declined/timed-out jobs): resets the cleaner to awaiting with a fresh SLA deadline, notifies them, auto-approves when the operator picks a time the cleaner suggested.
2. Calendar drag-to-move: silently rewrites `scheduled_date`/`scheduled_time`; the cleaner stays "approved" for a time they never agreed to.
3. `AppointmentSidePanel` edit-in-place (the R3 field set): also silently moves the schedule, no cleaner notification.

Known latent bugs this design fixes in passing: rescheduling never cleans `appointment_requested_slots` (a cleaner can later accept a stale slot and overwrite the operator's new time); editing the service never updates `duration_minutes` (conflict math uses stale durations); legacy deletes the cleaner's suggestions *before* the update, so a failed save loses them.

## Product decisions (settled with Bridger, 2026-07-09)

1. **Re-confirmation policy: always re-ask, with smart skips.** A schedule or cleaner change puts the job back to `pending`/`awaiting` with a fresh `response_deadline` and a cleaner notification, EXCEPT: (a) picking a time the same cleaner suggested (exact time match or inside a suggested window) auto-approves instantly, and (b) employee-model orgs (no offer loop) stay `confirmed`/`approved` and the cleaner is just notified.
2. **Series scope: this occurrence only.** Editing an occurrence of a recurring series touches only that appointment row. Both surfaces show an informational line: "Part of a repeating series. This change applies to this cleaning only." Series-wide editing is out of scope.
3. **Edit gates: pending + confirmed only.** In-progress, completed, and cancelled bookings are read-only in these surfaces (tighter than today, where in-progress jobs can be "rescheduled" and stranded mid-checklist). The existing Cancel action keeps its current looser gate; this spec does not change Cancel.
4. **Homeowner notification: notify when settled.** New homeowner event `appointment_time_changed`, fired only when the reschedule lands in a settled state (auto-approve, employee org, or unassigned). The re-ask path stays silent for the homeowner until the cleaner accepts, which already fires the existing "X is confirmed for your cleaning" notification. Net effect: the homeowner hears the final time exactly once, never a provisional one.
5. **No fee logic on reschedule.** Rescheduling never charges or warns about the cancellation-fee window (status quo). Fee policy stays with R8/homeowner work.

## UI implementation & styling source

The browser-companion mockups for this feature are UX/structure reference ONLY. Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css`. Do not copy ad-hoc colors, raw hex, or bespoke classes from a mockup. If a needed pattern has no primitive yet, build it as a reusable primitive that matches the system, never an inline one-off. No em dashes in any user-facing copy. Run ui-ux-pro-max at implementation time for design-system conformance.

## Surface 1: Reschedule dialog

A dialog (`src/components/ui/dialog`) stacked over the booking detail sheet, exactly like `ConfirmDialog` today. Opened from:

- the sheet's **Reschedule** button;
- tapping a **proposed exact-time row** (prefills that date + time; the existing one-click Accept button on those rows stays and keeps using `/api/appointments/accept-counter-proposal`);
- a new **"Pick a time"** affordance on each proposed-window row, replacing the current dead-end hint copy ("Use Reschedule to pick a time inside one of these windows."). Prefills the window's date and constrains the time options to inside the window.

Contents, top to bottom:

1. **Context line:** property · service · current schedule ("currently Thu, Mar 5 at 10:00am").
2. **Cleaner suggestions** (only when `cleaner_availability_feedback` rows exist): exact times and windows as prefill chips. Chips prefill the pickers; they never submit.
3. **Date + time pickers:** the Calendar-in-Popover + hourly pill pattern from the new-booking flow (`TimePickerPopover` internals, `bookableTimeOptions` 8:00–18:00). Chips may set off-grid times (e.g. 9:30) that the pills cannot; the pickers display whatever is set. When a window constrains the choice, only pills inside the window are offered, using the same inside-window check as `/api/appointments/accept-counter-proposal` so a constrained pick always auto-approves.
4. **Cleaner picker:** `EntityPickerField` with availability ranking via `useRankedCleaners`, which gains an `excludeAppointmentId` param so the booking does not conflict with itself. Rendered read-only (current cleaner, not a picker) when the viewer lacks `can_handle_requests`.
5. **Conflict warning** (soft): amber note naming the conflicting job when the target cleaner is already booked at the new time. Saving stays possible; the primary button label flips to "Reschedule anyway".
6. **Outcome line** — the semantics made visible. Always states what the save will do, derived by the same pure module the server uses:
   - "Matches Maria's suggestion. Confirms instantly, no re-confirmation needed." (auto-approve)
   - "Maria will be asked to re-confirm this time by Thu 6:00am." (contractor re-ask, same cleaner)
   - "James will be asked to confirm this time by Thu 6:00am." (cleaner changed)
   - "Maria will be notified of the new time." (employee org)
   - "No cleaner is assigned yet. The new time takes effect right away." (unassigned)
   - Additional line when `series_id` is set: "Part of a repeating series. This change applies to this cleaning only."
7. **Footer:** Cancel + primary button. Label follows the outcome: "Confirm reschedule" (settles instantly), "Send to Maria" (re-ask), "Reschedule anyway" (over a conflict).

Dismissing with changed fields asks before discarding (ConfirmDialog). The dialog has its own busy state; it does not share the sheet's single `busy` flag.

## Surface 2: Edit details (body swap in the sheet)

`BookingDetailSheet` gains a local `view | edit` page state (same pattern as the new-booking form's `form | review` pages). An **Edit details** button next to Reschedule swaps the sheet body to a small form:

- **Service** (`EntityPickerField`; changing it clears the checklist selection, matching the create flow),
- **Checklist** (`EntityPickerField`, nullable),
- **Price**: system total (service base + checklist adder) with an explicit override input, seeded from `price_override_enabled`/`price_override_total` so opening the form never silently flips the override on. Helper copy: "Changing the service updates the price and duration unless you override."
- **Special requests** (textarea, visible to the cleaner),
- **Internal notes** (textarea).

Header includes the schedule as read-only context with a pointer: "use Reschedule to change". This surface never touches schedule or cleaner, so saving never re-asks or notifies anyone. Footer: Cancel + "Save changes"; dirty guard on dismiss; success toast; back to view mode on save.

### Entry-point gating (both surfaces)

`editable = (status === 'pending' || status === 'confirmed') && canEdit` (`can_edit_bookings` or owner/admin). Both buttons render only when `editable`. The cleaner picker inside Reschedule additionally requires `canHandleRequests`. All other sheet actions keep their existing gates.

## Server route 1: POST `/api/appointments/[appointmentId]/reschedule`

Body: `{ organizationId, scheduledDate: 'YYYY-MM-DD', scheduledTime: 'HH:MM', cleanerId: string | null, force?: boolean }`.

1. **Authorize:** `requireManagerPermission(..., 'can_edit_bookings')`; if `cleanerId` differs from the current `cleaner_id`, additionally require `can_handle_requests` (mirrors `/api/appointments/reassign-cleaner`).
2. **Validate:** appointment belongs to the org; status is `pending` or `confirmed`, else 409 (`stale: true`). `cleanerId: null` is allowed only when the booking is currently unassigned (reschedule cannot unassign).
3. **Conflict check** (when `cleanerId` set): target cleaner's `pending`/`confirmed`/`in_progress` appointments on the new date, overlap by `duration_minutes` (60-minute fallback), excluding this appointment → 409 `{ conflict: true, details }` unless `force`.
4. **Decide the outcome** via a pure module `src/lib/appointments/rescheduleOutcome.ts` (unit-tested; also consumed by the dialog for the outcome line and button label):
   - auto-approve (same cleaner + time matches a suggested time or falls inside a suggested window, using the exact matching rules of `accept-counter-proposal`): `confirmed` / `approved` / `response_deadline: null`;
   - employee org (org payout model is not `percentage_contractor`, the same signal `deriveToday` uses) with a cleaner: `confirmed` / `approved` / deadline null;
   - unassigned: status unchanged (`pending`), confirmation fields untouched, deadline null;
   - otherwise (re-ask): `pending` / `awaiting` / `response_deadline = computeResponseDeadlineISO(newDate, newTime)`.
5. **Write the appointment first** (fixing legacy's delete-before-update trap): `scheduled_date`, `scheduled_time` normalized to `HH:MM:SS`, `cleaner_id`, status fields per outcome, `updated_at`.
6. **Clean up stale state:** delete the appointment's `cleaner_availability_feedback` rows (suggestion chips disappear everywhere) and its `appointment_requested_slots` rows (fixes the stale-slot-accept bug).
7. **Notify (best-effort, never fails the save):**
   - cleaner changed (including assigned-from-unassigned): `cleaner_assigned` to the new cleaner (consistent with reassign);
   - same cleaner, re-ask or settled: `appointment_rescheduled` to the cleaner;
   - settled outcomes only (auto-approve, employee, unassigned-with-homeowner): new `appointment_time_changed` to the homeowner when `homeowner_id` is set.

Response: `{ success: true, outcome: 'confirmed' | 'awaiting' }`. The client toast mirrors the outcome ("Booking rescheduled" vs "Sent to Maria to confirm").

## Server route 2: PATCH `/api/appointments/[appointmentId]/details`

Body: `{ organizationId, serviceTypeId, checklistId: string | null, priceOverrideEnabled: boolean, priceOverrideTotal: number | null, specialRequests: string | null, notes: string | null }`.

1. **Authorize:** `can_edit_bookings`. **Validate:** org match; status `pending` or `confirmed`; service (and checklist, when set) belong to the org.
2. **Recompute server-side:** `total_price` = override total when `priceOverrideEnabled`, else service `base_price` + checklist `price_adder`; `price_override_total` written null when override is off (keeps the column pair consistent); `duration_minutes` from the new service (fixes the stale-duration quirk).
3. **Guard:** reject with 409 when a `paid` or `processing` completion-charge revenue row exists for the appointment (belt and braces; the status gate mostly prevents this).
4. No confirmation reset, no notifications.

## Data layer and wiring

- New mutation hooks `useRescheduleBooking` / `useEditBookingDetails` (colocated with their surfaces, `useMutation` + `Authorization: Bearer accessToken` like `useCreateOperatorBooking`), invalidating `keys.appointments.byOrg(orgId)` and the action-items key on success. The host's existing `refetch()`-after-mutation pattern stays as backstop alongside the org realtime subscription.
- `OperatorBookingDetailHost` owns the dialog open state (local state, like `ConfirmDialog`; the sheet itself remains URL-driven via `?booking=`), passes the **raw `AdminAppointment`** into the new surfaces (the display VM `toDetailVM` stays display-only), and deletes `handleReschedule`'s legacy `router.push` — the escape hatch dies in the same commit that wires the dialog.
- `useAdminAppointments`' select already joins `cleaner_availability_feedback` with times/windows, so the dialog needs no extra fetch.

## File map

```
src/components/redesign/bookings/reschedule/
  RescheduleDialog.tsx            presentational dialog (ui/dialog)
  deriveReschedule.ts (+ .test)   chips prefill, window constraint, outcome message/button label
  useRescheduleBooking.ts         mutation hook
src/components/redesign/bookings/edit/
  EditBookingDetailsForm.tsx      body-swap form
  seedEditDetails.ts (+ .test)    AdminAppointment -> form state (override-safe seeding)
  buildDetailsPatch.ts (+ .test)  form state -> PATCH body
  useEditBookingDetails.ts        mutation hook
src/lib/appointments/
  rescheduleOutcome.ts (+ .test)  shared outcome decision (dialog + route)
src/app/api/appointments/[appointmentId]/
  reschedule/route.ts (+ .integration.test)
  details/route.ts   (+ .integration.test)
Modified:
  BookingDetailSheet.tsx          Edit details button, view|edit pages, tappable proposal rows,
                                  editable gate for both buttons
  OperatorBookingDetailHost.tsx   dialog state + handlers; legacy escape deleted
  useRankedCleaners.ts            excludeAppointmentId param
  src/lib/notifications/{eventTypes,labels,navigation}.ts   appointment_time_changed (homeowner)
  docs/redesign/2026-07-09-functionality-audit.md           mark R2/R3 + the §2 Reschedule row
```

## Errors and edge cases

- Booking accepted/cancelled/started while a surface is open: route status gate 409s; UI toasts "This booking changed. Refresh and try again." and refetches.
- Conflict 409: inline warning + "Reschedule anyway" (resubmits with `force: true`).
- Network/RLS failure: error toast, form state preserved.
- Notification failures are swallowed (matches `recordNotificationEvent` semantics everywhere).
- Suggestions absent: no chips section; dialog is just pickers + outcome line.
- Off-grid existing times (e.g. legacy 9:30 bookings) display correctly; manual re-picks are hourly, chips can restore exact suggested times.

## Testing

- **Unit:** `rescheduleOutcome` (all five outcome variants + series line + button label), `deriveReschedule` (chip prefill, window constraint parity with the accept route's check), `seedEditDetails` (override seeding), `buildDetailsPatch`.
- **Integration (both routes, using `tests/helpers/`):** permission matrix (owner/admin/manager with and without flags, cleaner-change flag escalation), status gates, conflict + force, auto-approve path, employee-org path, unassigned path, feedback + requested-slots cleanup, notification rows (cleaner event per path; homeowner event on settled paths only), details reprice/duration recompute, paid-charge price guard.
- **Gates per repo rules** before each push: `npm run test`, `npx tsc --noEmit`, `npm run lint` (clean on changed files).

## Out of scope (explicit)

Series-wide editing; homeowner self-serve reschedule; cancellation-fee logic on reschedule; the sheet's payment-method section and Fix-card repoint (R6); fee-aware cancel repoint (R8); property/customer/bill-to editing; manual duration editing; counter-propose in the redesign cleaner shell; any change to the legacy dashboard (it keeps working until cutover).
