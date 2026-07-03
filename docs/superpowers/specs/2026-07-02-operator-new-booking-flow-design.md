# Operator New-Booking Flow , Design

**Date:** 2026-07-02
**Surface:** Operator redesign (admin/manager), `(redesign)` route group, the operator shell (`OperatorShell`). Plus a companion change to the cleaner app.
**Status:** Design approved via the browser companion (shape, recurrence, and the cleaner offer/accept model confirmed with the user). Ready for per-slice implementation plans.

## Goal

Replace the legacy operator booking experience (the redesigned operator "New booking" button currently just `router.push("/admin-dashboard?tab=bookings")` into the legacy admin dashboard, which opens `AddAppointmentModal` , full of `primary-<number>` yellow and off-system controls) with a phone/desktop-aware, on-brand operator create-a-booking flow built from the redesign design system. Wire `OperatorShell`'s `onNewBooking` (used by `OperatorTopBar`, `OperatorMobileNav`, `CommandPalette`) to this new flow.

This is genuinely richer than the homeowner request flow: the operator books **on behalf of a customer** (or **org self-pay**), **schedules a specific date/time**, **offers the job to a cleaner**, sets **price (with override)**, and can make it **recurring**. All backend logic is reused unchanged; only the presentation is rebuilt. No migration, no new route.

## Structure (approved: Shape C , hybrid)

The flow opens as a **right-side slide-over panel** over the operator dashboard, reusing the operator's **existing** container pattern: the same right-anchored `Sheet` that `src/components/redesign/bookings/BookingDetailSheet.tsx` already uses (`<SheetContent side="right" className="w-full ... sm:max-w-*">`). One component, responsive by width , a **right-side slide-over on desktop** (the dashboard/bookings list stays visible and dimmed behind the scrim for context) and **full-screen on mobile** (`w-full`, no room for a side panel). No new container pattern is introduced. It is **one panel** (not a multi-step wizard) with progressive disclosure and a final review:

- The common case (bill the customer, one-time, pay by card) stays compact and fast for a high-volume operator.
- The less-common branches , **self-pay**, **recurrence**, and the **payment options** , reveal only when relevant, so the panel stays calm.
- A final **"Review & create"** step confirms before the (billable) booking is made.

## The percentage-contractor model (important framing)

We are building for the **percentage-contractor** cleaner model: cleaners have **no availability calendar**; they are offered work and **accept or decline**. Therefore:

- **Assigning a cleaner = making an OFFER, never a hard-book.** The cleaner accepts (it becomes theirs) or declines / lets it time out, and it **routes to the next cleaner** down the ranked chain, then back to the admin. This is the existing routing (`response_deadline`, `routing_log`, `advanceAppointmentRouting`, `rankCleanersByAvailability` , which here ranks candidates by scheduling **conflicts**, not declared availability).
- A future **team / availability model** (employees the office schedules directly, hard-book) is explicitly **out of scope** here, but the design stays **model-aware** so it can layer in later (mirrors the cleaner app's existing model-awareness).

## Slices (implementation staging)

One cohesive feature, shipped in three reviewable slices (each its own plan + PR):

- **Slice 1 , Operator single booking.** The full create panel for a one-time booking (bill-to + self-pay, customer, property, service, price + override, date/time + up to 2 alternates, cleaner offer, notes, payment, review & create). No cleaner-app dependency (a single job is confirmed by the cleaner exactly as today). Gets operators off the legacy modal for the bulk of bookings.
- **Slice 2 , Operator recurring.** The reimagined recurrence UI + series creation (via `POST /api/recurring-appointments`).
- **Slice 3 , Cleaner series-accept.** The cleaner-app experience for a recurring offer: see all occurrences, **Accept all** in one tap **or cherry-pick** individual accept/decline; declined/timed-out occurrences route independently. Completes the recurring loop.

## Locked decisions

1. **Shape C** , one right-side slide-over panel, progressive disclosure, final Review & create.
2. **Bill-to** , a toggle: "Bill the customer" vs "Company pays (self-pay)". Self-pay hides the recurrence block (no self-pay recurring endpoint) and the homeowner field when the property is org-owned.
3. **Cleaner = offer** (contractor model), not hard-book. Declines route down the existing chain. Model-aware for a future team model.
4. **Alternates** , keep the primary time + up to 2 alternates (`SlotPicker` logic) so the cleaner has options to accept.
5. **Price override** , operators can override the service price (the field is operator-only; it already is in the legacy).
6. **Recurrence** , in scope (Slice 2), reimagined (below).
7. **Recurring offer = accept-all OR cherry-pick** (Slice 3): the contractor sees every occurrence and can accept all at once or accept only the dates they can; the rest are declined and route to other cleaners **independently** (one bad date never sinks the series). Fits the backend natively (a series is N independent appointments sharing a `series_id`; accept-all is a bulk confirm, per-occurrence uses the existing per-appointment accept/decline + routing).

## Recurrence, reimagined (Slice 2)

Replace the legacy build-it-yourself form (type + interval + days + end) with a preset-driven, legible design:

- **One-tap cadence presets** for the common cleaning cadences: **Weekly, Every 2 weeks, Every 4 weeks**, plus **Custom** for the rest. (Maps to `recurrenceType` + `interval`.)
- **Day** , carried from the picked booking date (editable for weekly), shown as day chips.
- **Ends** , three friendly options: **After N** (an editable count; the resulting end date is shown live next to it , there is no hard-coded default count), **On a date**, or **Keep going** (generates as far as the system allows today, a rolling ~6-month / 50-occurrence cap; true never-ending auto-extension would need a background job and is a follow-up).
- **A live plain-language recap** , e.g. "Every 2 weeks on Saturdays at 10:00 AM. 12 cleanings, Jul 5 to Dec 27."
- **A real date preview** , the first ~5 generated dates as chips + the total count, so a dozen appointments are never generated blind.
- The **assigned cleaner carries across the whole series** (offered as one; see Slice 3).

## Screens / sections in detail

### Slice 1 , Operator single-booking panel
Sections, top to bottom, in one scroll with a sticky total + primary action:
- **Bill to** , segmented control: "Bill the customer" | "Company pays (self-pay)".
- **Customer** (hidden for org-owned self-pay) , a searchable picker of the org's homeowners/customers.
- **Property** , a searchable picker filtered to the chosen customer's properties (or org-owned properties for self-pay).
- **Service** , picker of active services (name + price + duration).
- **Checklist** , the service's checklist (required; the legacy loads it after the service).
- **Price** , the service price with an **override** affordance (operator-only) to set a custom total.
- **Date & time** , the primary slot + "Add alternate" for up to 2 more (rebuild `SlotPicker` logic into a focused calendar/time sheet, as in the homeowner flow).
- **Cleaner** , a searchable, conflict-ranked list (`rankCleanersByAvailability`); selecting one makes them the **first offer**. Copy sets the expectation: this is an offer that routes if declined.
- **Notes** , optional special requests.
- **Payment** , reuse `AppointmentPaymentSection` (saved card / send a link / collect later) for customer-billed, or `OrgPaymentMethodPicker` for self-pay , rebuilt from the design system (do not copy their legacy styling).
- **Review & create** , a compact confirmation (who, where, what, when, cleaner, total) then the primary "Create booking".

### Slice 2 , Recurrence
The "Repeat" section (revealed by a "Repeat this cleaning" toggle on the panel), as designed above. On create, posts the series to `POST /api/recurring-appointments` (series row + N appointments, each with the offered cleaner and its own `response_deadline`).

### Slice 3 , Cleaner series-accept (cleaner app)
When a recurring series is offered to a cleaner, the cleaner app shows it as **one grouped offer** listing every occurrence (date + time + pay). Actions:
- **Accept all** , bulk-confirms every occurrence in the series to this cleaner.
- **Cherry-pick** , per-occurrence accept/decline; accepted ones become theirs, declined/timed-out ones route to the next cleaner **independently**.
- The admin's booking view reflects the series filling in (which occurrences are locked vs re-routing).

## Data & reuse (no backend surgery)

- **Single booking create** , the legacy `AddAppointmentModal` inserts an `appointments` row directly: `{ organization_id, homeowner_id (or null for org-owned self-pay), cleaner_id (the offered cleaner), property_id, service_type_id, checklist_id, scheduled_date, scheduled_time, duration_minutes, total_price, price_override_enabled, price_override_total, special_requests, payment_method_id (or null for self-pay), is_self_pay, status: 'pending', cleaner_confirmation_status: 'awaiting', response_deadline }` + up to 2 alternates into `appointment_requested_slots`. The redesign builds the same insert (via the existing admin helper) , no schema/route change.
- **Recurring create** , `POST /api/recurring-appointments` (existing) with `{ organizationId, homeownerId, cleanerId, propertyId, serviceTypeId, checklistId, startDate, startTime, durationMinutes, totalPrice, priceOverrideEnabled, priceOverrideTotal, recurrenceType, interval, daysOfWeek, endDate | maxOccurrences, specialRequests, status, paymentMethodId }`. Creates the series + N appointments (each with `series_id`, the offered cleaner, its own deadline).
- **Reused logic (rebuild UI):** `SlotPicker` slot rules, `rankCleanersByAvailability`, `computeResponseDeadlineISO`, `computeSelfPayAmounts` (self-pay itemization), `BookingTotalSummary` (charge breakdown), `AppointmentPaymentSection` + `OrgPaymentMethodPicker` (payment flows), `useDismissGuard` / `useFormDraft` (unsaved-changes + draft restore).
- **Reused hooks/data:** `useAdminAppointments` (list + realtime), `updateAppointment`, the admin customer/cleaner/service/property data hooks, `useAuth` (org + role).
- **Cleaner accept (Slice 3):** the existing per-appointment confirm/decline + routing (`/api/appointments/confirm`, `advanceAppointmentRouting`); "Accept all" is a bulk confirm over the `series_id`. The cleaner app already renders and confirms jobs , this adds the series grouping + accept-all/cherry-pick UI.
- **Design-system primitives:** the operator shell + `src/components/ui/*` (Sheet for the desktop slide-over / `MobileTakeover` for narrow, `Calendar`, `Select`, `RadioGroup`/segmented control, `Command`/searchable pickers, `Textarea`, `Button`, `Badge`), tokens in `tailwind.config.js` + `globals.css`.

## Self-pay path

`is_self_pay = true`: `payment_method_id = null` (the org's Customer is charged), `homeowner_id = null` for an org-owned property or the real homeowner id when comping a customer. The offered cleaner must be **payout-ready** (Stripe onboarded + a payout percent), enforced as it is today. Recurrence is hidden in self-pay (no self-pay recurring endpoint). Reuse `computeSelfPayAmounts` for the itemized total.

## Empty / edge cases

- **No customers / no properties for the chosen customer** , the pickers offer an "Add" path (reuse existing create) or a clear empty state; create stays disabled until valid.
- **No payout-ready cleaner (self-pay)** , surface why a cleaner is ineligible; block create for that cleaner.
- **Price override** , clearing it restores the service price; the total and any self-pay split recompute.
- **Draft restore** , reuse `useFormDraft` so a reload does not lose an in-progress booking (as the legacy does).
- **Recurrence caps** , respect the ~6-month / 50-occurrence cap; the recap + preview always reflect the real count.

## UI implementation & styling source

The browser-companion mockups from this design are **UX/structure reference only**. Every screen is implemented from the design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft shadows, the rounded scale). Do **not** copy ad-hoc colors, raw hex, or bespoke classes from a mockup or from the legacy `AddAppointmentModal` / `AppointmentPaymentSection` / `OrgPaymentMethodPicker` , reuse their **logic only**. Run `ui-ux-pro-max` at implementation. No em dashes in user-facing copy. "Operator" is internal jargon , this is an operator-facing surface, so "operator" is fine here, but any copy the **cleaner** sees (Slice 3) must say "office", never "operator".

## Out of scope

- The **team / availability** cleaner model (hard-book, office-scheduled). Design stays model-aware; build later.
- **Editing or skipping a single occurrence after creation** (series management , e.g. "skip the holiday week"). Follow-up.
- **True never-ending recurrence** (auto-extending series via a background job). Follow-up; "Keep going" generates to the current cap.
- The legacy admin dashboard itself (this only replaces the create-booking entry point; the legacy remains reachable until fully retired).

## Testing

- Pure presenters get co-located `*.test.ts`: the recurrence recap + date-preview generator (cadence -> occurrence dates, count, end date, cap), the plain-language recap string, self-pay/override total math (delegating to `computeSelfPayAmounts` / `BookingTotalSummary`), and booking validation ("can create").
- The create paths reuse the existing admin insert + `/api/recurring-appointments` (already covered); add focused tests only where the redesign shapes a new payload.
- Slice 3: a presenter for the series-offer view-model (grouping occurrences, accept-all vs per-occurrence state) with tests.
- Visual verification on dev at both widths (desktop slide-over + narrow takeover), screenshots to the user per slice.
