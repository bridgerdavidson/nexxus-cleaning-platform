# Homeowner New-Booking ("Request a cleaning") Flow , Design

**Date:** 2026-07-02
**Surface:** Homeowner redesign app (`(redesign)` route group, `/app/homeowner-dashboard`)
**Status:** Design approved (shape + key decisions confirmed with the user via the browser companion). Ready for implementation plan.

## Goal

Replace the legacy `RequestAppointmentModal` (off-system: `primary-<number>` yellow ramp, `#F7C41E`, portal modal) with a phone-first, on-brand "Request a cleaning" flow built entirely from the redesign design system. It is the last major legacy surface a homeowner touches and the actual booking-creation path.

The **backend is a request model, not instant self-serve booking**: the homeowner offers up to 3 preferred times; the office assigns a cleaner who confirms or counter-proposes. This flow reuses that plumbing unchanged and only rebuilds the presentation.

## Structure (approved: Flow C , hybrid)

A full-screen takeover with **two internal pages** plus focused sheets for the heavy inputs:

- **Page 1 , Picks:** Home (property), Service, up to 3 Preferred times, Notes (optional). Home and Service are tappable rows that open picker sheets. Preferred times render as removable chips, each added via a focused calendar sheet. Primary button: "Review request".
- **Time picker sheet:** opens over Page 1 for each preferred time. A real month calendar (`ui/calendar`) + a time selection, then "Add this time". Max 3 preferred times.
- **Page 2 , Review & send:** a summary (home, service, preferred times, notes), the payment method, and the total with a "you are not charged now, charged when the job is completed" reassurance. Primary button: "Send request".
- **Success moment:** "Request sent" confirmation explaining what happens next, then the flow closes and the request appears under Cleanings as pending.

Rationale for C over a full 5-step wizard: the request is lightweight (5 short fields); a wizard would turn trivial single-selects into extra screens and slow repeat bookers. C keeps one deliberate commit moment (review + card) where isolation genuinely helps (money + confirming times), while the two heavy inputs (calendar, card) still open as focused sheets.

## Locked decisions

1. **Flow C (hybrid)**, two pages + focused sheets, as above.
2. **Card required when card payments are on.** When `homeownerCardPickerAvailable()` is true (i.e. `stripeNewChargeFlowUiEnabled()` + publishable key), a selected card is required to send the request (matches today's behavior; guarantees a payment method for charge-at-completion). When card payments are off, the payment step is omitted entirely and the request sends without one.
3. **"Book again"** on a completed cleaning (the `RecentCleaningCard` and the cleaning detail) opens this flow **pre-filled with the same home + service**; the homeowner just picks new times.
4. **Entry points open the same flow:** every "Request a cleaning" button + the Home FAB (currently open the legacy modal); a service's detail "Request this cleaning" opens it with that service pre-filled; Book again pre-fills home + service.
5. **Scope:** single-appointment request with **1 to 3 preferred times**. No recurrence (the homeowner path never supported it; the recurring endpoint is admin-only). **Service only**, no checklist-tier step (keep it lean; a service carries its default checklist).
6. **Single property** is pre-selected; the row stays tappable to change. **No saved property** , the Home picker offers "Add a home" that opens the existing add-property sheet, so the homeowner never dead-ends.

## Screens in detail

### Page 1 , Picks (`BookingPicksView`)
- Header: back (closes flow), title "Request a cleaning", step indicator "1/2".
- Sub-hint: "Tell us what and when. The office confirms a time and assigns your cleaner."
- **Home** row: property name + address; tap opens `PropertyPickerSheet`. Pre-selected when there is exactly one property (or when pre-filled).
- **Service** row: service name + "$<price> · about <duration>"; tap opens `ServicePickerSheet`.
- **Preferred times**: 0 to 3 chips ("1st / 2nd / 3rd" + "Sat, Jul 5 · 10:00 AM", removable). "Add a backup time" (or "Add a time" when empty) opens `TimePickerSheet`. At least the first time is required to proceed.
- **Notes** (optional): a compact textarea ("Anything specific they should know?"), trimmed; sent as `null` when empty.
- Footer CTA: "Review request" (enabled when home + service + >=1 time are set).

### Time picker sheet (`TimePickerSheet`)
- Bottom sheet (vaul `Drawer`) titled "Pick a preferred time".
- `ui/calendar` month grid, min date = today; select a date.
- Time selection for the chosen date (time pills / list). Keep it schematic and reuse existing time formatting (`formatTimeTo12h`).
- "Add this time" appends `{ scheduled_date, scheduled_time }` to the slots array (max 3; the add entry hides at 3).

### Page 2 , Review & send (`BookingReviewView`)
- Header: back (returns to Page 1, state preserved), title "Review & send", step "2/2".
- Sub-hint: "One last look. You can still go back and change anything."
- **Summary** card: Home, Service, Preferred (all offered times), Notes (if any).
- **Payment method** (only when card payments are on): selected card row ("Visa •••• 0341", "Charged when the job is done"); tap opens `CardPickerSheet`. Required to send.
- **Total** box: service price, method-aware processing fee when applicable, "Total when completed", and the reassurance "You are not charged now" + a "No upfront hold" badge (reuse `BookingTotalSummary` logic; rebuild UI).
- Footer CTA: "Send request" (disabled until a card is selected when payments are on).

### Card picker sheet (`CardPickerSheet`)
- Reuses the Slice 4 brand payment components: a saved-cards radio list + "Add a card" via the brand Stripe Elements panel (`AccountAddCardPanel`, brand `#0150FC`), `create-setup-intent` -> `confirmSetup(off_session)`. **Not** the legacy `HomeownerCardPicker`/`AddPaymentMethodPanel` (which bake in `#F7C41E` / `primary-<number>`). Reuse only their logic (saved-card fetch, SetupIntent, set-default).

### Success (`BookingSentView`)
- "Request sent" with a check, one line on what happens next ("The office will confirm a time and assign your cleaner. You will get a notification."), and a "Done" button that closes the flow and routes to Cleanings.

## Entry points, routing, pre-fill

- **Opener hook** `useOpenBooking()` (write-only, sets query params, reads none , no Suspense needed, mirrors `useOpenCleaning`): `open({ serviceTypeId?, propertyId? })` sets `?book=1` plus optional `&bookService=<id>` / `&bookProperty=<id>`.
- **`BookingFlowHost`** mounted in the homeowner layout (like `HomeownerCleaningDetailHost`) reads `?book` via `useDetailParam('book')` and the prefill params, and mounts `<BookingFlow>` as a `MobileTakeover` when present. Opening from any tab works; closing restores the underlying screen.
- Replace the current `RequestAppointmentButton` usages in the redesign (`HomeownerHome` inline button + FAB, `HomeownerServiceDetail` "Request this cleaning", any other redesign entry) with calls to `useOpenBooking()`. `HomeownerServiceDetail` passes `serviceTypeId`; Book again passes both ids. Legacy (non-redesign) call sites keep the legacy modal untouched.

## Data & reuse

- **Submit route (reuse unchanged):** `POST /api/appointments/request` with `{ organizationId, propertyId, serviceTypeId, checklistId?, slots: [{ scheduled_date, scheduled_time }] (1-3), specialRequests?, paymentMethodId? }`. Creates one `appointments` row (`status=pending`, `flow_type=homeowner_request`, `request_state=awaiting_admin`, `cleaner_id=null`, `homeowner_initiated=true`) + 1-3 `appointment_requested_slots`. No migration, no new route, no RLS change.
- **New mutation hook** `useSubmitBookingRequest()` , wraps the route, on success invalidates `keys.appointments.requestsByHomeowner(userId)` + `keys.appointments.byHomeowner(userId)` so the pending request appears under Cleanings/Home immediately.
- **Reused logic (rebuild UI):** `SlotPicker` slot rules (min-date, up to 3, each slot needs date+time), `BookingTotalSummary` fee math (`src/lib/payments/processingFee`, method-aware), the Slice 4 brand card components.
- **Reused hooks/data:** `useHomeownerProperties`, `useServices` (active), `useServices` price/duration formatting (`redesign/services/deriveServices`), `useAuth` (`user`, `currentOrganizationId`, `accessToken`), `useHomeownerRequests` (already drives Home's `PendingRequestCard`).
- **Design-system primitives:** `MobileTakeover` (full-screen flow), `Drawer`/`Sheet` (pickers), `ui/calendar` + `ui/date-picker`, `radio-group`, `textarea`, `input`, `button`, `badge`, `empty-state`, `skeleton`, tokens in `tailwind.config.js` + `globals.css`.

## Empty / edge cases

- **No properties:** Home picker shows "Add a home" -> existing add-property sheet; on save, select the new property.
- **No services (org has none):** Service picker empty state; "Request request" disabled with a gentle explanation (rare).
- **No saved card (payments on):** Card picker leads with "Add a card"; Send stays disabled until one is added/selected.
- **Card payments off:** no payment step, no card requirement; Send enabled on home + service + >=1 time.
- **One property:** pre-selected; row still opens the picker to change.
- **Pre-filled service no longer active / property deleted:** ignore the stale prefill, fall back to unselected (validation blocks send).
- **Slot in the past by submit time:** client min-date guard + the route's own validation.

## UI implementation & styling source

The browser-companion mockups produced during this design are **UX/structure reference only**. Every screen is implemented from the design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft "pillowy" shadows, the rounded scale). Do **not** copy ad-hoc colors, raw hex, or bespoke classes from a mockup or from the legacy modal/card-picker. Run `ui-ux-pro-max` at implementation for design-system conformance. No em dashes in any user-facing copy; the homeowner never sees the word "operator" (use "office"). Do not reuse the legacy `RequestAppointmentModal`, `HomeownerCardPicker`, or `AddPaymentMethodPanel` presentation , logic only.

## Out of scope

- Recurring/frequency requests (backend homeowner path does not support it).
- Checklist-tier selection inside booking.
- Operator "create booking" redesign (separate surface; this is homeowner-facing only).
- Reschedule (net-new, previously cut).

## Testing

- Pure presenters (`bookingValidation` "can submit", slot add/remove/limit, total/fee) get co-located `*.test.ts`.
- The submit path reuses the existing `/api/appointments/request` integration coverage; add a focused test only if the mutation hook shapes a new payload.
- Visual verification on a phone viewport on dev (build screens, not mockups): full happy path (picks -> time sheet -> review -> send -> pending in Cleanings), Book again pre-fill, and the payments-off variant.
