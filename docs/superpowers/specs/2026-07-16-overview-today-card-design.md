# Overview "Today" card — unify Today's schedule + Active now

**Date:** 2026-07-16
**Status:** Approved (Bridger, via browser-companion option A + terminal confirmation)
**Surface:** Operator Overview (`/app/admin-dashboard`), shared by admin and manager roles.

## Problem

The Overview's right-hand dispatch column (`TodayActivePanel.tsx`) does not speak the
design system's language, while the "Needs you now" queue beside it does:

- Rows are bare middot-joined text strings ("Pine St · Standard clean · Marco D.")
  with hairline separators; the queue uses bordered row-cards with semibold title +
  muted subtitle and badge pills.
- Times render in brand blue and read as hyperlinks, but nothing in either card is
  clickable. Queue rows deep-link to the booking sheet.
- Status ("Unassigned") hides inside the text string instead of using the badge
  vocabulary.
- The green `animate-ping` dot is a foreign status idiom. The system communicates
  status with tinted pills, and the motion guideline reserves infinite animation for
  loaders. With one active job the column shows two green dots 40px apart.
- Active jobs appear twice in the same column (schedule list + Active now list).

## Decision (UX)

Replace the two stacked cards with **one "Today" card**: a single time-sorted list of
today's jobs in the queue's row idiom, with live status carried by a tinted row + a
static-dot "Live" pill showing elapsed time. No blinking anywhere.

### Card

- Header: `Today` title. Right side: `positive` Badge with a static dot and
  "N live" (rendered only when N > 0), plus a `secondary` Badge "N jobs".
- Body: rows sorted by scheduled time. Long days: same overflow treatment as the
  queue (`max-h` + internal vertical scroll) so the card stays compact.
- Empty state: muted one-line text "Nothing scheduled today." (unchanged behavior).
- Loading: skeleton rows (unchanged behavior).

### Rows

Queue row idiom: bordered `rounded-control` row container, click target enlargement
on the row, semibold sm title, xs muted subtitle.

- Left: scheduled time, tabular numerals, neutral foreground (not brand blue).
- Middle: title "Property · Service"; subtitle: cleaner short name ("Marco D."), or
  "No cleaner yet" when unassigned.
- Right (status pill, only when the row is exceptional):
  - `completed` → `secondary` pill "Done"; row rendered slightly faded.
  - `in_progress` → row gets a soft positive tint + `positive` pill
    "Live · <elapsed>" with a **static** dot. Elapsed comes from
    `appointments.started_at` via the existing `formatElapsed` helper
    ("just started" / "42 min" / "1 hr 7 min"). When `started_at` is null the pill
    reads just "Live".
  - Unassigned (`cleaner_id == null`) → `caution` pill "Unassigned".
  - Ordinary upcoming (pending/confirmed with a cleaner) → no pill.
- Rows open the booking sheet via `useOpenBookingDetail` (`?booking=<id>`), passed
  down as `onOpenBooking` and **gated by `can_view_bookings`** exactly like the
  queue: restricted managers get informational-only rows (no pointer affordance).
  Follow the queue's nested-interactive pattern (single AT control per row).

### Merge semantics (edge case)

`activeNow` today means `status === 'in_progress'` **regardless of date**; `today`
means scheduled today. The merged list is **today's jobs ∪ all in-progress jobs**,
so a job still running from a previous day stays visible instead of vanishing. Such
rows get a short date hint in the subtitle (e.g. "Jul 15 · Marco D."). Sort order is
(scheduled_date, scheduled_time), so earlier-date live jobs naturally float to the top.
Cancelled rows are already excluded by `deriveOverviewSections`.

## UI implementation & styling source

The browser-companion mockups behind this decision are UX/structure reference ONLY.
Every visual is implemented from the design system: the primitives in
`src/components/ui/*` (`Card`, `Badge`, `Skeleton`, the queue's row pattern in
`NeedsYouNowQueue`) and the tokens in `tailwind.config.js` + `src/app/globals.css`.
Do not copy ad-hoc colors, raw hex, or bespoke classes from a mockup. The live-row
tint must be derived from the `positive` token ramp with a dark-theme-safe variant,
not a hardcoded light-mode hex. If a needed pattern has no primitive, build it as a
reusable primitive, not a one-off. No `animate-ping` / infinite animation.

## Implementation surface

- `src/components/redesign/overview/TodayActivePanel.tsx` → rewritten as the single
  `TodayPanel` (file renamed to `TodayPanel.tsx`; `LiveDot` deleted).
- `src/components/redesign/overview/overview-types.ts`: `ScheduleItem` + `ActiveItem`
  replaced by one `TodayItem` display type
  (`{ id, time, title, subtitle, status: 'done'|'live'|'unassigned'|'upcoming', elapsed? }`).
  Status precedence when flags overlap: live > done > unassigned > upcoming.
- New pure `buildTodayItems()` (own module beside `deriveOverview.ts`) that merges
  `sections.today` + `sections.activeNow`, derives per-row status, formats elapsed,
  and sorts. Unit-tested like `deriveOverview.test.ts`.
- `OperatorOverviewView`: `today` + `activeNow` props replaced by `todayItems`
  (plus `onOpenBooking` passthrough to the panel).
- `OperatorOverview.tsx`: maps via `buildTodayItems`; KPI strip unchanged.
- `src/hooks/useAdminData.ts`: add `started_at` to the appointments select and to
  the `AdminAppointment` interface (`started_at?: string | null`).
- `formatElapsed` imported from
  `src/components/redesign/homeowner/home/job-progress-presenters.ts` (pure, already
  tested; not relocated in this PR to keep the diff small).
- `src/app/(dev)/operator-preview/page.tsx`: mock data updated to the new prop shape
  (including a live row with `started_at` and a done row).

## Out of scope (follow-ups)

- Cleaner dashboard "Active Cleanings" and homeowner home still use the ping idiom;
  sweep them with the same treatment in a later small PR.
- Legacy `/admin-dashboard` (pre-redesign) pages: unreachable in prod, untouched.
- `PendingConfirmationsSection` amber ping (legacy surface): untouched.

## Testing

- Unit: `buildTodayItems` — merge/dedup (job both today + in_progress appears once),
  status mapping, unassigned vs declined nuance not re-derived here (queue owns
  triage), elapsed formatting passthrough, sort order, previous-day live job
  inclusion + date hint.
- Existing `deriveOverview.test.ts` untouched (no logic change there).
- Visual: Playwright against `/operator-preview` and the real `/app/admin-dashboard`,
  light + dark, before PR. ui-ux-pro-max conformance pass at implementation time.
- Gates: `npx tsc --noEmit`, `npm run lint`, targeted vitest run for the new unit
  file (full local suite is unreliable while sessions share local Supabase; CI
  arbitrates).
