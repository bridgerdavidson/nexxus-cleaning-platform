# Mobile Appointment Modal — payer cards + gold safe area

**Date:** 2026-06-17
**Component:** `src/components/AddAppointmentModal.tsx`
**Context:** Two small mobile UI fixes surfaced from an on-device screenshot of the
"New Appointment" modal, step 1.

## Problem

1. **Payer cards truncate.** Step 1's "Who pays for this cleaning?" renders the two
   choice cards in a fixed `grid grid-cols-2` even on a phone, so each card is only
   ~46% of the viewport. The organization name truncates ("Default Organization" ->
   "Default Or...") and "A homeowner" wraps awkwardly. Shortening the copy does not
   solve it: org names are arbitrary length and will always truncate in two narrow
   columns.

2. **White top safe area.** On iOS, the status-bar safe-area strip above the gold
   header renders white instead of matching the gold header it touches, breaking the
   native, immersive feel.

## Design

### 1. Payer cards: stack on mobile, side-by-side on desktop

- In `AddAppointmentModal.tsx`, change the payer-cards wrapper (around line 1574)
  from `grid grid-cols-2 gap-3` to `grid grid-cols-1 sm:grid-cols-2 gap-3`.
- On phones: full-width stacked rows (icon-left, text, checkmark right). Full org
  name and both subtitles render on one line each, no truncation.
- Tablet/desktop (`sm:` and up): unchanged 2-up layout.
- Add `min-w-0` to the homeowner card's text block for symmetry with the company
  card. Keep the existing `truncate` on the org name as a safety net for unusually
  long names.
- No logic changes; purely layout.

### 2. Gold top safe area

iOS 26 Safari (Liquid Glass) ignores `theme-color` and tints the safe-area strips by
sampling the `background-color` of `fixed` / `sticky` elements near the viewport
edges, falling back to the white page background. The modal's gold header is
`position: relative` (its ancestors are a transparent `fixed inset-0` wrapper and a
dark `bg-black/50` backdrop), so nothing gold is sampled at the top edge -> white
strip.

Fix: render a `fixed`, top-pinned strip inside the modal portal:

- Solid `bg-primary-600` background (the brand gold). Solid `background-color` is
  required because the header uses `bg-gradient-to-r` (a `background-image`), which
  the Liquid Glass sampler ignores.
- Height covers the top inset: `env(safe-area-inset-top)`.
- Positioned behind the gradient header so there is no visible seam; its only job is
  to be the sampled top-edge element.
- Mounts and unmounts with the modal (the portal returns `null` when closed), so
  there is no lingering-gray safe-area bug (the failure mode documented in
  `docs/mobile-safari-safe-area-debug-instructions.md`).

## Verification

- **Card layout + no regressions:** Playwright MCP against `localhost:3000`,
  mobile viewport, screenshot step 1.
- **Gold safe area:** renders only on real iOS 26 hardware, so it cannot be confirmed
  in desktop Playwright. Build it, then verify on the user's iPhone and iterate if the
  strip needs nudging.

## Scope guard

Scoped to `AddAppointmentModal` only. Extracting a shared safe-area-strip / backdrop
component for the other ~25 modals (which share the same latent white-safe-area
pattern) is a separate follow-up, not part of this work.

## Out of scope

- Restyling the cards beyond the layout change.
- Touching the homeowner/property pickers, footer, or any step other than step 1.
- The bottom (home-indicator) safe area; the white footer it touches is acceptable.
