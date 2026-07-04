# Slice 3 follow-up: cleaner bulk decline + homeowner grouped recurring view

Extends PR #125 (branch `feat/cleaner-series-accept`) per user feedback. **One combined PR.**

## What & why
1. **Cleaner "Decline all"** (not just Accept all), via a real **bulk route** (user approved building it).
2. **Homeowner** sees an admin-created recurring series as ONE grouped, expandable "Repeating cleaning" card on Home (today they only see it as N individual pending rows, because the operator's series is `homeowner_initiated = false` so it is filtered out of "Pending requests" entirely).
3. **Fix the awkward homeowner pending-request card layout.**

## Global constraints
- Bulk route is NEW and approved. Cleaner-facing copy says "office" not "operator"; no em dashes; design-system tokens only (`brand-*`/semantic, no raw hex, no `primary-<n>`). Build homeowner grouping from the cleaner pattern. Mobile (screenshots).

## Architecture decisions
- **Bulk route keyed by `seriesId`, not an occurrence list.** The server acts on whatever occurrences are still `awaiting` for the *caller cleaner* in that series. This makes "re-submit a resolved date" structurally impossible and powers both Accept all and Decline all.
- **Isolated offer-commit helpers** (`src/lib/appointments/respondToOffer.ts`) for the simple admin-direct single-slot case, reusing the shared `advanceAppointmentRouting` + notification libs. The production confirm route is NOT refactored (too risky); the helpers mirror its accept/decline for recurring occurrences. Follow-up: migrate the confirm route onto these helpers. Per-occurrence notifications preserved (parity with today's loop).
- **Homeowner grouped card is view + expand only** (no accept/decline; homeowners do not accept). Tapping a day opens the existing cleaning detail (`useOpenCleaning`), which already has cancel.

## Tasks
- **T1 `src/lib/appointments/respondToOffer.ts`** — `commitAcceptOffer(admin, {appointment, cleanerId, organizationId})` (approve + confirm + clear deadline + close pending routing_log + notify homeowner/admins) and `commitDeclineOffer(admin, {appointment, cleanerId, organizationId, reasonText})` (clear deadline + feedback + synthesize declined routing_log + `advanceAppointmentRouting` + notify). Mirrors `confirm/route.ts` for the single-slot admin-direct case.
- **T2 `src/app/api/appointments/confirm-series/route.ts`** — POST `{organizationId, seriesId, action:'accept'|'decline', declineReason?, declineReasonOther?}`; `requireOrgAuth` (cleaner/admin/owner/manager); fetch caller's `awaiting`+`pending` occurrences `where series_id=? and cleaner_id=auth.userId`; loop the T1 helper; return `{total, succeeded, failed}`. `maxDuration = 60`. + `route.integration.test.ts` (accept-all approves all with dates intact; decline-all routes all away; auth 401/403-404; only caller's awaiting affected; missing action 400; invalid declineReason 400).
- **T3 `useRespondToSeries` rework** — `acceptAll(seriesId)` + `declineAll(seriesId, reason, other)` POST to the bulk route; `SeriesAcceptResult` reused; toasts success/partial. Drop the occurrence-array signature.
- **T4 Cleaner UI** — `SeriesOfferCard`: keep Accept all N + Pick dates, add a de-emphasized **Decline all** (ghost, critical tint) opening a reason `Drawer` → `declineAll`. `SeriesOfferSheet`: add **Decline all** beside Accept all (uses the existing in-sheet reason step, "all" mode) → `declineAll`; per-occurrence accept/decline stays on the single confirm route. Accept all now calls `acceptAll(seriesId)`.
- **T5 Homeowner data** — add `series_id` to `useHomeownerData` appointments select + the `Appointment` type.
- **T6 `deriveHomeownerSeries`** (`src/components/redesign/homeowner/home/derive-homeowner-series.ts` + test) — group UPCOMING (`scheduled_date >= today`, status pending/confirmed/in_progress) appointments with a `series_id` into `HomeownerSeries[] = {seriesId, occurrences[], count, first, startDate, endDate, statusLabel}`; a lone remaining occurrence degrades to none (handled by the caller: only render groups with count >= 2). Standalone appointments are ignored here.
- **T7 `HomeownerRepeatingCard`** — mirror the cleaner card: "Repeating cleaning" eyebrow, service · property, "N cleanings", date range, a status pill; inline expand (chevron) → day list (date + time + per-day status badge), each row taps `useOpenCleaning(id)`. Wire a "Repeating cleanings" section into `HomeownerHome` above Pending requests.
- **T8 Layout fix** — `PendingRequestCard`: compact header (title + Awaiting badge), meta line (address · N preferred times), right-aligned subtle "Cancel request"; remove the tall gap.
- **T9** — gates (tsc/eslint on touched, unit + the new integration test), ui-ux-pro-max conformance, independent review, visual verify (cleaner Decline all + homeowner grouped card) on dev, update PR #125 title/body.
