# Landing hero: continuous booking-flow animation ("FlowShowcase")

Replaces the 4-phase hero triptych. One continuous choreographed loop showing a single
booking travel through the product across the three roles, mirroring the REAL redesign UX
(see the role/lifecycle research summarized below). Not a step slideshow: one master
timeline, elements physically travel between surfaces, the camera follows on mobile.

## UI implementation & styling source

Same contract as specs/landing-page.md: every visual comes from src/components/ui/*
primitives and the tokens in tailwind.config.js / globals.css. The miniature surfaces
mirror the redesign components (KpiStrip labels, Needs-you-now queue, cleaner JobRow,
homeowner gradient hero) in vocabulary and tone. No raw hex, no mockup styling, no em
dashes in copy.

## The true product story the animation must tell

1. Homeowner sends a cleaning REQUEST from her phone (service + preferred time). Card is
   saved. "You are not charged now." (No upfront hold.)
2. The request lands in the operator's "Needs you now" queue as Unassigned (caution pill).
   KPI reflects it.
3. Operator assigns Maria (one action). Status: pending -> confirmed. Maria's phone gets
   the job on her Today list.
4. Maria works the job: starts (in_progress, pulsing live dot on the operator side),
   photos + checklist tick by, then "Complete job".
5. Completion triggers the charge on the saved card: $180 collected. The split happens in
   one motion: $144 flows to Maria ("Your cut is on its way"), $36 remainder to the
   company. Homeowner sees "Payment received", operator revenue ticks up.

## Stage and choreography

- Fixed-coordinate stage (1060 x 560 design px), three surfaces absolutely positioned:
  homeowner phone (left), operator dashboard (center, dominant), cleaner phone (right).
  Deterministic coordinates make the connector paths and cursor choreography exact.
- An SVG connector layer behind the surfaces: two curved paths (homeowner -> operator,
  operator -> cleaner) plus payout return paths. Segments draw (pathLength) exactly while
  something travels along them; they fade after.
- The traveling artifact: the booking exists as ONE visual object that morphs
  (motion layoutId within a LayoutGroup): request chip on the phone -> queue row in the
  dashboard -> job row on Maria's phone -> receipt. Spring transitions (gentle, no wobble).
- Simulated cursor: a small pointer dot on the dashboard that glides to the queue row's
  Assign button, presses (scale dip), picks Maria from a two-option popover. This is the
  only "hand of god" moment: the operator's single action.
- Money beat: on completion, three value chips ($180 charge; $144 to Maria; $36 to
  company) travel the connector paths simultaneously; operator revenue KPI counts up,
  homeowner card flips to "Payment received", cleaner phone shows "Your cut is on its way."
- Loop: ~22s active + ~2s settle, then a soft 600ms crossfade reset (never a hard cut).

## Master timeline (target times, ms)

  0      homeowner phone wakes; request sheet slides up ("Deep clean", "Thu 9:00 AM",
         "Charged when the job is done")
  1800   tap "Send request" (button press dip); chip forms
  2600   chip lifts off, flies path A to the dashboard (900ms); path A draws under it
  3500   lands as "Needs you now" row (Unassigned caution pill); "Needs you" KPI 0->1;
         queue count badge appears
  5000   cursor glides in, hovers row (brand-tinted border), clicks Assign
  6000   two-cleaner picker pops; cursor picks Maria (avatar chip)
  7200   row morphs: caution pill -> "Confirmed · Maria R."; KPI 1->0
  7800   job chip flies path B to cleaner phone (900ms)
  8700   lands on Maria's Today list (time block row, "New" glow fades)
  10200  Maria taps "Start job"; operator "Active now" dot starts pulsing; homeowner hero
         flips to "Cleaning in progress"
  12000  work montage on the phone: photos chip "3 photos added", checklist "8 of 8 done"
         tick in sequence
  15000  "Complete job" press; complete sheet flashes "Payment collected"
  16000  money beat: $180 chip homeowner->dashboard; then split chips $144 -> cleaner,
         $36 stays (revenue KPI counts 1240 -> 1420 area); status pill -> Completed
  19000  settle: all three surfaces show their calm end state; caption holds
  21500  soft reset crossfade; loop

A continuous thin progress rail under the stage with four labeled markers (Booked,
Assigned, Done, Paid) that FILLS continuously (it is a clock, not a stepper). Markers are
seek buttons. A single caption line crossfades at ~6 anchor points.

## Interaction and a11y

- Pause on hover/pointer-down on the stage; resume on leave. Pause entirely while
  offscreen (IntersectionObserver) and when the tab is hidden.
- prefers-reduced-motion: no clock, no flights; render the composed end-state scene with
  the caption "One booking, from request to payout, with nobody chasing anybody."
- Everything transform/opacity only (no layout-affecting animation); the stage is
  overflow-hidden and self-contained.
- aria-live polite on the caption; the stage itself aria-hidden (decorative), the story is
  in the caption text.

## Responsive: camera, not reflow

The stage keeps its fixed coordinates at every breakpoint. On viewports narrower than the
stage, the stage scales to ~0.9 and a camera transform (translateX, spring-tracked)
follows the action: centered on the homeowner phone during the request, pans to the
dashboard for triage, to the cleaner phone for the work montage, back to center-wide for
the money beat (slight zoom-out so the split reads). Desktop >= stage width: camera locked
center, no pan. One choreography, two framings.

## Implementation notes (motion v12)

- Single rAF clock hook (useFlowClock): returns t in ms; pause/seek; loops. All state
  derives from t via a declarative cue list (CUES array of {at, ...}), so the whole
  timeline is data.
- Flights: layoutId="flow-artifact" within a LayoutGroup; exactly one instance mounted at
  a time; spring { stiffness 90, damping 18 }. Shape morph is acceptable between chip and
  row (similar aspect); receipt uses a fresh element (crossfade) to avoid ugly morphs.
- Connector draw: SVG path with pathLength animation synced to the flight window; dot of
  brand-600, path brand-200.
- Cursor: absolute motion.div animated to fixed stage coordinates; scale 0.9 dip on click.
- Camera: motion.div wrapper animating x (and scale slightly) between per-cue camera
  targets; spring so it feels like a dolly, not a slide carousel.
