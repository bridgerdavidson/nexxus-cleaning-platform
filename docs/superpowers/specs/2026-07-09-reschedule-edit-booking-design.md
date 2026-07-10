# Reschedule + Edit Booking (Operator Redesign) — Design

**Date:** 2026-07-09 (revised same day after adversarial review; see Review outcomes at the bottom)
**Audit gaps:** R2 (reschedule flow) + R3 (edit booking after creation) from `docs/redesign/2026-07-09-functionality-audit.md`
**Approach chosen:** Split surfaces — a focused Reschedule dialog + a light "Edit details" body-swap in the booking detail sheet (approach B of the brainstorm; browser-companion mockups reviewed and approved).

## Problem

The redesigned `BookingDetailSheet`'s Reschedule button is the last §2 escape besides the Fix card: `OperatorBookingDetailHost.handleReschedule` does `router.push('/admin-dashboard?tab=bookings&appointment=<id>')`. After cutover there is no reschedule at all, and the sheet is read-only apart from assign/status/cancel (no post-creation editing of service, checklist, price, requests, or notes).

Legacy "reschedule" is actually three divergent write paths:

1. `RescheduleAppointmentModal` (only reachable for cleaner-declined/timed-out jobs): resets the cleaner to awaiting with a fresh SLA deadline, notifies them, auto-approves when the operator picks a time the cleaner suggested.
2. Calendar drag-to-move: silently rewrites `scheduled_date`/`scheduled_time`; the cleaner stays "approved" for a time they never agreed to.
3. `AppointmentSidePanel` edit-in-place (the R3 field set): also silently moves the schedule, no cleaner notification.

Latent bugs this design fixes in passing: rescheduling never cleans `appointment_requested_slots` or `appointment_routing_log`, so a cleaner can accept a stale slot (overwriting the new time) and the auto-defer sweep can expire a stale routing row and re-route a job the operator just settled; editing the service never updates `duration_minutes` (conflict math uses stale durations); legacy deletes the cleaner's suggestions *before* the update, so a failed save loses them; the redesign create flows drop the checklist `price_adder` from `total_price` (legacy and the DB recompute trigger both include it); the sheet's Assign select uses a client write with no conflict check, no SLA deadline, and no notification.

## Product decisions (settled with Bridger, 2026-07-09)

1. **Re-confirmation policy: always re-ask, with smart skips.** A schedule or cleaner change puts the job back to `pending`/`awaiting` with a fresh `response_deadline` and a cleaner notification, EXCEPT: (a) picking a time the same cleaner suggested (exact time match or inside a suggested window) auto-approves instantly, and (b) employee-model orgs (no offer loop) stay `confirmed`/`approved` and the cleaner is just notified.
2. **Series scope: this occurrence only.** Editing an occurrence of a recurring series touches only that appointment row. Both surfaces show an informational line: "Part of a repeating series. This change applies to this cleaning only." Series-wide editing is out of scope.
3. **Edit gates: pending + confirmed only.** In-progress, completed, and cancelled bookings are read-only in these surfaces (tighter than today, where in-progress jobs can be "rescheduled" and stranded mid-checklist). The existing Cancel action keeps its current looser gate; this spec does not change Cancel.
4. **Homeowner notification: notify when settled.** New homeowner event `appointment_time_changed`, fired only when a schedule change lands in a settled state (auto-approve, employee org, or unassigned) — from the new reschedule route AND from `accept-counter-proposal` (which settles a time today without telling the homeowner). The re-ask path stays silent for the homeowner until the cleaner accepts, which already fires the existing "X is confirmed for your cleaning" notification. Net effect: the homeowner hears the final time exactly once, never a provisional one.
5. **No fee logic on reschedule.** Rescheduling never charges or warns about the cancellation-fee window (status quo). Fee policy stays with R8/homeowner work.
6. **Homeowner-initiated requests are reschedulable, with full state handling.** The route maintains `request_state` and `appointment_routing_log` (details in route 1) instead of excluding these bookings.
7. **Price recompute is change-driven.** The details route recomputes `total_price`/`duration_minutes` only when service, checklist, or the override pair actually changed; a notes-only save never reprices. The create-flow missing-adder bug is fixed in this same workstream.
8. **Auto-approve needs only `can_edit_bookings`.** A manager who can move a booking anywhere may also land it on the cleaner's own suggestion and settle instantly. The one-click Accept button keeps its stricter `can_handle_requests` gate unchanged; the asymmetry is deliberate and tested.
9. **The sheet's Assign select is repointed at the new reschedule route** (same date/time, new cleaner), gaining the conflict check, SLA deadline, and cleaner notification it silently lacks today.

## UI implementation & styling source

The browser-companion mockups for this feature are UX/structure reference ONLY. Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css`. Do not copy ad-hoc colors, raw hex, or bespoke classes from a mockup. If a needed pattern has no primitive yet, build it as a reusable primitive that matches the system, never an inline one-off. No em dashes in any user-facing copy. Run ui-ux-pro-max at implementation time for design-system conformance.

## Surface 1: Reschedule dialog

A dialog (`src/components/ui/dialog`) stacked over the booking detail sheet, exactly like `ConfirmDialog` today. Opened from:

- the sheet's **Reschedule** button;
- tapping a **proposed exact-time row** (prefills that date + time; the existing one-click Accept button on those rows stays and keeps using `/api/appointments/accept-counter-proposal`);
- a new **"Pick a time"** affordance on each proposed-window row, replacing the current dead-end hint copy. Prefills the window's **date and exact start time** (guaranteed in-window, so the dialog opens submittable and auto-approving even when the hourly grid has no pill inside the window) and constrains the time options to inside the window.

These row affordances (tap + "Pick a time"), like the two buttons, render only when `editable` (see gating). Accept keeps its existing `canHandleRequests` gate.

Contents, top to bottom:

1. **Context line:** property · service · current schedule ("currently Thu, Mar 5 at 10:00am").
2. **Cleaner suggestions** (prefill chips; they never submit): only suggestions whose `cleaner_availability_feedback.cleaner_id` equals the **currently assigned cleaner** are shown — stale suggestions left behind by prior cleaners (routing/reassign never deletes them) are hidden. Requires adding `cleaner_id` to the feedback join (see Data layer).
3. **Date + time pickers:** the Calendar-in-Popover + hourly pill pattern from the new-booking flow (`TimePickerPopover` internals, `bookableTimeOptions` 8:00–18:00). Chips may set off-grid times (e.g. 9:30). When a window constrains the choice, the pill list is: the window's exact start time, plus grid hours clipped to the window. Constrained pills call the same exported matching predicate as `rescheduleOutcome` so a constrained pick always auto-approves by construction.
4. **Cleaner picker:** `EntityPickerField` with availability ranking via `useRankedCleaners` + new `excludeAppointmentId` (see Data layer). Rendered read-only (current cleaner, no picker) when the viewer lacks `can_handle_requests`.
5. **Conflict warning** (soft): derived **client-side pre-submit** from `useRankedCleaners`' conflict data, with the conflicting job's name resolved from the `useAdminAppointments` cache by id. Once the warning is visible, submit carries `force: true` directly; the server's 409 is only the race backstop. Primary button label flips to "Reschedule anyway".
6. **Outcome line** — the semantics made visible, derived by the same pure module the server uses. Deadlines are shown as durations, not clock times (the server computes the real deadline at save time; a client-side absolute time could drift, especially across the 48h SLA-tier boundary):
   - "Matches Maria's suggestion. Confirms instantly, no re-confirmation needed." (auto-approve)
   - "Maria will be asked to re-confirm this time. They will have 24 hours to respond." (contractor re-ask; "4 hours" when the new slot is under 48h away)
   - "James will be asked to confirm this time. They will have 24 hours to respond." (cleaner changed)
   - "Maria will be notified of the new time." (employee org)
   - "No cleaner is assigned yet. The new time takes effect right away." (fresh unassigned)
   - "The new time is saved. This booking still needs a cleaner." (escalated unassigned — see route 1 outcome table)
   - Additional line when `series_id` is set: "Part of a repeating series. This change applies to this cleaning only."
7. **Footer:** Cancel + primary button. Label follows the outcome: "Confirm reschedule" (settles instantly), "Send to Maria" (re-ask), "Reschedule anyway" (over a conflict).

Post-save behavior: on success the dialog closes and the sheet stays open showing the refetched booking; on a stale 409 the dialog closes, the sheet stays, and the stale toast shows; on a conflict 409 the dialog stays open with the warning. Dismissing with changed fields asks before discarding (ConfirmDialog). The dialog has its own busy state, not the sheet's `busy` flag.

Dialog lifecycle: the host resets the dialog's open state whenever the sheet's `open` prop goes false (browser back / navigation clears `?booking=` while HostInner stays mounted; without the reset the dialog would orphan over an unrelated page). Opening a *different* booking remounts HostInner (`key={lastId}`) and discards dialog state without the dirty guard — accepted.

## Surface 2: Edit details (body swap in the sheet)

An **Edit details** button next to Reschedule swaps the sheet body to a small form. The form and its `view | edit` page state live in a **child component rendered inside `SheetContent`** so it unmounts on close and mounts fresh each open (the new-booking form's freshness comes from this mount structure; state on `BookingDetailSheet` itself would survive close/reopen and land the user back in edit mode).

- **Service** (`EntityPickerField`; changing it clears the checklist selection, matching the create flow),
- **Checklist** (`EntityPickerField` with an explicit "No checklist" item, since the primitive has no clear affordance),
- **Price**: system total (service `base_price` + checklist `price_adder`, adder 0 when no checklist) with an explicit override input, seeded from `price_override_enabled`/`price_override_total`; the inconsistent legacy pair `enabled=true, total=null` seeds as override OFF from `total_price`. Helper copy: "Changing the service or checklist updates the price, and the service updates the duration, unless you override."
- **Special requests** (textarea, visible to the cleaner),
- **Internal notes** (textarea).

Picker options come from the existing `useServices()` and `useChecklists(serviceTypeId)` hooks, exactly as `OperatorBookingForm` does; the booking's current service/checklist is always included even when inactive, labeled "(inactive)". Header shows the schedule read-only with a pointer ("use Reschedule to change"). This surface never touches schedule or cleaner, so saving never re-asks or notifies anyone. Footer: Cancel + "Save changes"; dirty guard on dismiss; success toast; back to view mode on save.

### Entry-point gating (both surfaces)

`editable = (status === 'pending' || status === 'confirmed') && canEdit` (`can_edit_bookings` or owner/admin). Both buttons AND the proposal-row tap/"Pick a time" affordances render only when `editable`. The cleaner picker inside Reschedule additionally requires `canHandleRequests`. All other sheet actions keep their existing gates.

## Server route 1: POST `/api/appointments/[appointmentId]/reschedule`

Body: `{ organizationId, scheduledDate: 'YYYY-MM-DD', scheduledTime: 'HH:MM', cleanerId: string | null, force?: boolean }`.

1. **Authorize + load:** `requireManagerPermission(..., 'can_edit_bookings')`, then fetch the appointment (org match). If `cleanerId` differs from the current `cleaner_id` (the check needs the fetched row), additionally require `can_handle_requests` — a deliberately tighter posture than `reassign-cleaner` (which checks only `can_handle_requests`). Auto-approve needs no extra flag (decision 8). Note: appointments RLS (migration 106) still lets a `can_edit_bookings` manager change `cleaner_id` client-side via the legacy surfaces; the escalation is route-level defense, consistent with today, and tightening RLS is deferred.
2. **Validate:** status is `pending` or `confirmed` (pre-check for a clean error; the write itself re-checks atomically). `cleanerId: null` is allowed only when the booking is currently unassigned (reschedule cannot unassign).
3. **Conflict check** (when `cleanerId` set): the target cleaner's `pending`/`confirmed`/`in_progress` appointments on the new date, overlap using the **candidate's** `duration_minutes` (60-minute fallback on the candidate side; existing rows at face value), excluding this appointment → 409 `{ conflict: true, details: { appointmentId, scheduledTime, durationMinutes, customerName } }` unless `force` (server joins the property/homeowner for `customerName`).
4. **Decide the outcome** via `src/lib/appointments/rescheduleOutcome.ts` (pure, unit-tested; consumed by the dialog for the outcome line, button label, and constrained pills). Matching rules are defined HERE, not by reference (`accept-counter-proposal` has no exact-time rule, and its window check compares raw mixed-format strings — a known quirk this module deliberately fixes):
   - Normalize all times to HH:MM before comparing (DB values arrive as HH:MM:SS).
   - Exact match = `suggested_date` equals the new date AND normalized times equal (the legacy modal's rule).
   - Window match = `window_date` equals the new date AND `start <= t <= end` on normalized times (closed interval, legacy-modal parity; deliberately diverges from the accept route's half-open string compare).
   - A suggestion counts ONLY when its feedback row's `cleaner_id` equals the target `cleanerId` (mirrors `accept-counter-proposal`'s ownership check).
   - Outcomes: **auto-approve** (same cleaner + match) → `confirmed`/`approved`/deadline null. **Employee org** (`organizations.default_payout_model !== 'percentage_contractor'`, the signal `deriveToday` uses; read server-side via the admin client) with a cleaner → `confirmed`/`approved`/deadline null. Note: this branch is latent until `hourly_external` becomes settable in the product (the org-profile route's `ENABLED_PAYOUT_MODELS` currently rejects it); the per-cleaner `cleaner_profiles.payout_model` is deliberately ignored here. **Unassigned** → status stays `pending`, confirmation fields untouched, deadline null; the escalated shape (`cleaner_confirmation_status='rejected'` + null cleaner from chain exhaustion) keeps its declined badge and needs-attention card on purpose — the dialog's outcome line says so. **Otherwise (re-ask)** → `pending`/`awaiting`/`response_deadline = computeResponseDeadlineISO(newDate, newTime)`.
5. **Write the appointment first, atomically:** a conditional UPDATE (`.in('status', ['pending','confirmed'])`) writing `scheduled_date`, `scheduled_time` normalized to `HH:MM:SS`, `cleaner_id`, outcome fields, `updated_at`; 0 rows updated → 409 `{ stale: true }` (this makes the status gate atomic against a concurrent cancel/accept — migration 088's trigger does not forbid `cancelled → pending`, so the read-then-write version would silently resurrect a cancelled booking).
6. **Clean up stale sibling state:**
   - delete the appointment's `cleaner_availability_feedback` rows (suggestion chips disappear);
   - delete its `appointment_requested_slots` rows;
   - close any `response='pending'` rows in `appointment_routing_log` (set `response='expired'`, `responded_at=now`, mirroring the confirm route's accept-path closure) — otherwise the auto-defer sweep later expires them and **re-routes the booking over the operator's reschedule** (the sweep checks no appointment status; the confirm route documents this exact failure mode).
7. **Maintain `request_state`** when `usesRequestState()` (homeowner requests): settled outcomes (auto-approve, employee) → `'completed'`; re-ask with a cleaner → `'routing'` + insert an `appointment_routing_log` row mirroring `assign-cleaner` (so the SLA sweep governs the new deadline and a timeout advances the chain); still-unassigned → leave `awaiting_admin`/`needs_admin_attention` unchanged. Without this, a settled request leaves a phantom "Awaiting assignment" action card forever and keeps rendering as a cancellable pending request in the homeowner UI.
8. **Notify (best-effort, never fails the save):**
   - auto-approve → `cleaner_counter_accepted` to the cleaner (the existing success-toned "Your proposed time was accepted" event for exactly this semantic; NOT the warning-toned `appointment_rescheduled`);
   - re-ask, same cleaner → `appointment_rescheduled` with payload `{ requires_confirmation: true, response_deadline }`; labels.ts gains a re-confirm detail variant, and the employee FYI case reuses the event with `requires_confirmation: false` (update the `eventTypes.ts` comment, which currently says "must re-confirm" unconditionally);
   - cleaner changed, re-ask → `cleaner_assigned`; cleaner changed, settled (employee) → `cleaner_force_assigned` ("no confirmation needed", matching `assign-cleaner`'s convention);
   - settled outcomes with `homeowner_id` set → `appointment_time_changed` to the homeowner.

Response: `{ success: true, outcome: 'settled' | 'awaiting' }` — auto-approve/employee/unassigned map to `settled` (toast "Booking rescheduled"), re-ask maps to `awaiting` (toast "Sent to <cleaner> to confirm").

### Confirm-route hardening (same workstream)

Deleting slot rows alone does not fix the stale-accept race; it changes the failure mode (the confirm route silently ignores `slotIndex` when no rows exist and confirms the cleaner onto the rescheduled time they never saw). In `/api/appointments/confirm`'s accept branch: (a) 409 when `body.slotIndex` is provided but no slot row with that index exists (instead of silently ignoring it); (b) make the accept UPDATE conditional on the appointment being unchanged since its read (`.eq('updated_at', ...)`; the reschedule route always bumps `updated_at`), 409 on 0 rows — this closes the write-write window without reordering the reschedule route's write-then-delete sequence; apply the same conditional-update guard to the counter-propose branch (which could otherwise flip a just-auto-approved reschedule back to pending/rejected). A bare accept with no slot rows and no `slotIndex` remains "accept the appointment row as-is", now safe under (b).

## Server route 2: PATCH `/api/appointments/[appointmentId]/details`

Body: `{ organizationId, serviceTypeId, checklistId: string | null, priceOverrideEnabled: boolean, priceOverrideTotal: number | null, specialRequests: string | null, notes: string | null }`.

1. **Authorize + validate:** `can_edit_bookings`; org match; status `pending`/`confirmed` (atomic conditional UPDATE as in route 1 → 409 `{ stale: true }`); `serviceTypeId` belongs to the org; when `checklistId` is set, `checklist.service_type_id` must equal the submitted `serviceTypeId` (checklists have NO `organization_id` column — org scoping is transitive via the service; this also blocks cross-service adder corruption, mirroring `/api/appointments/request`); when `priceOverrideEnabled` is true, `priceOverrideTotal` must be a finite number >= 0 (400 otherwise); when false, any submitted total is ignored and `price_override_total` is written null (`total_price` is NOT NULL — an unvalidated null override would 500).
2. **Recompute, change-driven (decision 7):** only when `serviceTypeId`, `checklistId`, or the override pair differ from the stored row: `total_price` = override total when enabled, else `base_price + (checklist ? price_adder : 0)`; `duration_minutes` from the new service only when the service changed. A save with none of those changed writes only requests/notes and never touches price or duration. (The DB's `recalculate_totals_for_checklist` trigger uses the same base+adder formula; its ability to reprice even charged bookings when an adder is edited is a pre-existing hole, out of scope, tracked separately.)
3. **Paid-charge guard:** 409 `{ paidGuard: true }` when a `payments` row exists with this `appointment_id`, `payment_type = 'revenue'`, `status IN ('paid','processing')`, AND `charge_kind IS DISTINCT FROM 'cancellation_fee'` — NULL `charge_kind` must block (legacy Stripe charges and manual recorded payments carry no `charge_kind`; only the flag-gated new flow stamps `'completion'`). This is the same predicate shape `reconcile.ts` treats as "already collected or in flight". Manual payments can attach paid rows to pending/confirmed bookings today, so the status gate does NOT mostly prevent this.
4. No confirmation reset, no notifications. Success body `{ success: true }`.

## Create-flow price fix (same workstream, decision 7)

The redesign create paths write `total_price` from `base_price` only, dropping the checklist `price_adder` that legacy, this spec's details route, and the DB trigger all include (a checklist is mandatory in those flows, so every redesign-created booking with a nonzero adder is underpriced). Fix in the same workstream: `deriveOperatorBooking.ts` `effectiveTotalUsd` (+ the form's price display seeding), `buildRecurringPayload.ts`, and `/api/appointments/request`'s `total_price`. Existing underpriced rows are corrected only when an operator later changes service/checklist/override in Edit details (change-driven recompute), never by an unrelated save.

## Data layer and wiring

- New mutation hooks `useRescheduleBooking` / `useEditBookingDetails` (colocated with their surfaces, `useMutation` + `Authorization: Bearer accessToken` like `useCreateOperatorBooking`), invalidating `keys.appointments.byOrg(orgId)` AND `keys.appointments.actionItemsByOrg(orgId)` on success (they are sibling keys — invalidating `byOrg` does not cascade to action items). The host's `refetch()`-after-mutation pattern stays as backstop alongside the org realtime subscription.
- `useAdminAppointments`' feedback join gains `cleaner_id` (select + `AdminAppointment` type) so suggestion ownership is knowable client-side; with that, the dialog needs no extra fetch.
- `useRankedCleaners` gains `excludeAppointmentId`: include it in the queryKey and filter `row.id !== excludeAppointmentId` when grouping after the fetch (filtering inside a cache entry shared with the new-booking flow would poison it; no change to `cleanerAvailability.ts` needed).
- `OperatorBookingDetailHost` owns the dialog open state (local, like `ConfirmDialog`; reset when the sheet's `open` goes false), passes the **raw `AdminAppointment`** into the new surfaces (the display VM stays display-only), repoints `handleAssign` at the reschedule route (decision 9), and deletes `handleReschedule`'s legacy `router.push` — the escape hatch dies in the same commit that wires the dialog.
- `/api/appointments/accept-counter-proposal` is modified per decision 4: its appointment select adds `homeowner_id`, and a successful settle emits `appointment_time_changed` (best-effort), keeping both settle paths consistent.

## File map

```
src/components/redesign/bookings/reschedule/
  RescheduleDialog.tsx            presentational dialog (ui/dialog)
  deriveReschedule.ts (+ .test)   chips filtering/prefill, window pill constraint, outcome message +
                                  button label (wraps rescheduleOutcome), conflict warning shaping
  useRescheduleBooking.ts         mutation hook
src/components/redesign/bookings/edit/
  EditBookingDetailsForm.tsx      body-swap form (child of SheetContent; owns view|edit state)
  seedEditDetails.ts (+ .test)    AdminAppointment -> form state (override-safe; enabled+null-total -> OFF)
  buildDetailsPatch.ts (+ .test)  form state -> PATCH body
  useEditBookingDetails.ts        mutation hook
src/lib/appointments/
  rescheduleOutcome.ts (+ .test)  shared outcome decision + matching predicates (dialog + route)
src/app/api/appointments/[appointmentId]/
  reschedule/route.ts (+ .integration.test)
  details/route.ts   (+ .integration.test)
Modified:
  BookingDetailSheet.tsx          Edit details button, editable gate, tappable proposal rows +
                                  "Pick a time" window affordance
  OperatorBookingDetailHost.tsx   dialog state + reset-on-close; handleAssign repoint; legacy escape deleted
  src/hooks/useAdminData.ts       feedback join + AdminAppointment type gain cleaner_id
  new-booking/useRankedCleaners.ts        excludeAppointmentId (queryKey + post-fetch filter)
  new-booking/deriveOperatorBooking.ts    effectiveTotalUsd includes checklist adder (+ form seeding)
  new-booking/buildRecurringPayload.ts    same adder fix
  src/app/api/appointments/request/route.ts        same adder fix (total_price)
  src/app/api/appointments/confirm/route.ts        accept/counter-propose hardening (+ its integration test)
  src/app/api/appointments/accept-counter-proposal/route.ts   homeowner appointment_time_changed (+ test)
  src/lib/notifications/eventTypes.ts     appointment_time_changed; appointment_rescheduled comment
  src/lib/notifications/labels.ts         new event: build case + KNOWN_TYPES entry (missing KNOWN_TYPES
                                          silently degrades to the generic "Update" fallback); re-confirm
                                          payload variant for appointment_rescheduled
                                          (navigation.ts needs NO change: homeowner routing is generic)
  tests/helpers/fixtures.ts       WithTestOrgOptions gains defaultPayoutModel; createTestAppointment
                                  cleanerId becomes nullable
  docs/redesign/2026-07-09-functionality-audit.md  mark R2/R3 + the §2 Reschedule row
```

## Errors and edge cases

- Booking accepted/cancelled/started while a surface is open: the conditional UPDATE returns 0 rows → 409 `{ stale: true }`; UI toasts "This booking changed. Refresh and try again." and refetches (dialog closes, sheet stays).
- Conflict 409: dialog stays open with the warning + "Reschedule anyway" (resubmits with `force: true`).
- Stale one-click accepts: `cleaner_counter_proposed` notification payloads permanently embed `suggested_time_id`, so bell/action-center Accept buttons survive a reschedule that deleted the feedback rows; `accept-counter-proposal` then 404/409s. Map those failures to the same "This booking changed. Refresh and try again." toast at the sheet and action-center call sites instead of surfacing the raw server message.
- Network/RLS failure: error toast, form state preserved. Notification failures are swallowed (matches `recordNotificationEvent` semantics).
- Suggestions absent (or all owned by other cleaners): no chips section; dialog is pickers + outcome line.
- Off-grid existing times (e.g. legacy 9:30 bookings) display correctly; manual re-picks are hourly, chips and window-start prefills can set exact times.

## Testing

- **Unit:** `rescheduleOutcome` (all outcome variants incl. both unassigned shapes + series line + button label; matching boundary tests: pick exactly at window start and end, HH:MM vs HH:MM:SS equality, suggestion owned by a different cleaner), `deriveReschedule` (chip ownership filtering, window pill list incl. the no-grid-pill window, conflict shaping), `seedEditDetails` (override seeding incl. `enabled=true,total=null`), `buildDetailsPatch`.
- **Integration (both routes + the two modified routes, using `tests/helpers/`):** permission matrix (owner/admin/manager with and without each flag; cleaner-change escalation; auto-approve under `can_edit_bookings` alone per decision 8), atomic status gates (concurrent-cancel simulation: flip status between read and write), conflict + force, auto-approve/employee/unassigned/re-ask outcome writes, feedback + slots + routing-log cleanup (reschedule while a pending routing row exists, settled AND re-ask: sweep no longer re-routes), `request_state` transitions per starting state, notification rows per path (incl. `cleaner_counter_accepted` on auto-approve, `cleaner_force_assigned` on settled cleaner change, homeowner event on settled paths only — including via `accept-counter-proposal`), details change-driven reprice (a no-change save must NOT alter `total_price`/`duration_minutes`; a service change must), paid-charge guard (legacy NULL `charge_kind` row blocks; `cancellation_fee` row does not), confirm-route hardening (stale slotIndex 409; conditional-update 409 mid-reschedule).
- **Helpers:** extend `WithTestOrgOptions` with `defaultPayoutModel` and make `createTestAppointment.cleanerId` nullable (today it is required, and orgs are created with name only).
- **Gates per repo rules** before each push: `npm run test`, `npx tsc --noEmit`, `npm run lint` (clean on changed files).

## Out of scope (explicit)

Series-wide editing; homeowner self-serve reschedule; cancellation-fee logic on reschedule; the sheet's payment-method section and Fix-card repoint (R6); fee-aware cancel repoint (R8); property/customer/bill-to editing; manual duration editing; counter-propose in the redesign cleaner shell; tightening appointments RLS to distinguish cleaner-change permission (route-level defense only, as today); the DB checklist-adder trigger's ability to reprice charged bookings; any change to the legacy dashboard (it keeps working until cutover).

## Review outcomes (2026-07-09)

An 8-lens adversarial review (independent verification pass on the critical/major findings, all confirmed) reshaped this spec: routing-log closure + `request_state` maintenance (decisions 6), confirm-route hardening, `feedback.cleaner_id` ownership, concrete matching rules replacing the dangling accept-route reference, window-start pill guarantee, change-driven reprice + create-flow adder fix (decision 7), the reconcile-parity paid-charge predicate, notification event corrections (`cleaner_counter_accepted` on auto-approve, `cleaner_force_assigned`, KNOWN_TYPES), atomic status writes, dialog/body-swap lifecycle rules, and the Assign repoint (decision 9).
