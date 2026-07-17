# R9 + R10: Job photos and Routing history sections in the operator BookingDetailSheet

**Date:** 2026-07-16
**Status:** Approved by Bridger (brainstorming + browser-companion session, 2026-07-15/16)
**Audit items:** R9 (job photos visible to operator) and the remaining half of R10 (per-attempt routing/decline history) from `docs/redesign/2026-07-09-functionality-audit.md`. These are the last §2/§3 functionality gaps before cutover.

## Summary

Two new view-only Collapsible sections in `src/components/redesign/bookings/BookingDetailSheet.tsx`:

1. **Job photos** — the cleaner's before/during/after photos, phase-grouped thumbnail grids, full-screen lightbox with zoom + download.
2. **Routing history** — the cleaner-assignment offer trail from `appointment_routing_log`, rendered as a vertical timeline (who was offered the job, attempt by attempt, accepted/declined/expired/pending with decline reasons and deadlines).

Product decisions made during brainstorming:

- R10's "routing/decline history" means **cleaner-assignment routing** (`appointment_routing_log`), not payment attempts. A payment-attempt timeline may come later and should be able to reuse the timeline primitive built here.
- **Both sections are view-only.** No operator photo upload/delete, no re-offer action. Acting on a booking stays with the existing controls (Assign select, Reschedule, Cancel).
- Placement: **evidence cluster** — both sections sit together after the Payment block (companion choice A).
- Photos layout: **phase-grouped 3-column grids** (companion choice A, revalidated at honest sheet width).
- Routing layout: **vertical timeline**, oldest attempt first (companion choice A).
- Lightbox: **reuse the existing `yet-another-react-lightbox` machinery with a design-system theme pass** (Bridger's choice: "reuse + theme"), not a from-scratch viewer.

## UI implementation & styling source

The browser-companion mockups from this session (under `.superpowers/brainstorm/`, gitignored) are UX/structure reference ONLY. Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft "pillowy" shadows, the rounded scale). Do not copy ad-hoc colors, raw hex, or bespoke classes from a mockup. Status and urgency use the badge/pill vocabulary, not decorative accents. If a needed pattern has no primitive yet, build it as a reusable primitive that matches the system, never an inline one-off. Run ui-ux-pro-max design-system conformance at implementation time.

## Placement and gating

Insertion point in `DetailBody` (BookingDetailSheet.tsx): after the Payment block and the conditional counter-proposal blocks, immediately before the "Requests & notes" Collapsible:

```
… Payment → [counter-proposals if any] → Job photos → Routing history → Requests & notes → actions
```

- Both are `<Collapsible>` (src/components/ui/collapsible.tsx), `defaultOpen=false`, with a count in the `right` slot ("Job photos · 7", "Routing history · 3").
- **No feature flag.** Neither section depends on Stripe; they go live at merge (unlike the flag-gated R6/R7 payment section).
- Visibility rides the sheet's existing `can_view_bookings` gating. Data access is enforced by existing RLS: org owner/admin/manager SELECT exists for `job_photos` (baseline policies) and for `appointment_routing_log` (migration 059 "view routing log if can see parent appointment").
- **Job photos renders when**: photos exist, OR `appointments.photos_skipped` is true, OR the job status is in progress/completed (shows the "No photos yet" empty state). Hidden for future bookings (pending/confirmed) with no photos, where the section is meaningless.
- **Routing history renders when**: the appointment has ≥1 `appointment_routing_log` row. Directly-assigned bookings never show it. While the query is loading, render nothing rather than a skeleton for this section (avoids a flash for the common direct-assign case); the photos section, which usually applies, uses skeletons.

## Job photos section (R9)

**Component:** `src/components/redesign/bookings/photos/JobPhotosSection.tsx`

**Data:** reuse `useJobPhotosForAppointment(appointmentId)` (src/hooks/useCleanerData.ts) and its query key `keys.jobPhotos.byAppointment` untouched. Derive `duringPhotos` from `allPhotos` in the section's view-model helper if the hook doesn't already expose it. The skip state needs `appointments.photos_skipped` + `photo_skip_reason` on the operator appointment row — verify `useAdminAppointments`'s select includes them; add if missing (plan-time task).

**Layout:** one labeled group per phase, in order Before → During → After. "During" renders only when such photos exist. Group heading = phase label + count. Under each heading a 3-column grid of square thumbnails (`aspect-square`, rounded per token scale, `object-cover`):

- Thumbnails are `<button>`s (keyboard-focusable) with alt/aria text naming the phase and position ("Before photo 2 of 3").
- Images lazy-load (`loading="lazy"`) with reserved aspect ratio (no layout shift). `photo_url` is already a public URL.
- Click opens the lightbox at that photo's index within the full ordered set (before → during → after), so arrow keys walk the whole visit.

**States:**
- Loading: skeleton grid (existing skeleton primitive/pattern).
- Error: the settings-style ErrorState with retry (refetch).
- Empty, job started/completed: "No photos yet".
- Skipped: quiet note row "Photos skipped" + the cleaner's recorded `photo_skip_reason`, quoted. (Legacy never surfaced this; we do.)

**Lightbox — reuse + theme:** keep `src/components/JobPhotoLightbox.tsx` as the single shared component (legacy panel keeps using it; the new section imports it). Add a theme pass in place so it stops reading as library-default:

- Restyle via the library's CSS custom properties (`--yarl-*`): backdrop, control colors, active-thumbnail accent from our tokens.
- Swap toolbar/navigation icons for our Lucide set via the library's `render` hooks where the library allows.
- Keep all existing plugins and behavior: Zoom (wheel/pinch, zoom in/out buttons), Download (existing sensible filename `appt-{id}-{type}-{id8}.jpg`), Captions (phase + upload time), Thumbnails, Fullscreen, keyboard navigation.
- No behavioral rewrite. If a specific icon/element proves un-themeable through supported APIs, leave it library-default rather than forking the library's DOM.

## Routing history section (R10)

**Component:** `src/components/redesign/bookings/routing/RoutingHistorySection.tsx`

**Data:** new hook `useRoutingLog(appointmentId)` using a new query-key factory entry `keys.routingLog.byAppointment(appointmentId)` (src/lib/queryKeys.ts). Client-side supabase select from `appointment_routing_log` filtered by `appointment_id`, ordered `attempt_index asc`, embedding the offered cleaner's display name (verify the FK target and the PostgREST embed path against migrations 059/076 at plan time; if the embed is blocked by RLS or FK shape, fall back to a second keyed query against the org's cleaner list, which the operator shell already loads). No realtime subscription in v1; TanStack staleTime (30s) + refetch on sheet open is enough for how often operators view this.

**Layout:** vertical timeline, oldest attempt first, one item per routing-log row:

- **Header row:** cleaner name + status badge. Badge vocabulary (existing badge primitive, text never color-only): `accepted` → success "Accepted"; `declined` → danger "Declined"; `expired` → muted "Expired"; `pending` → info pill with the functional deadline, "Respond by {time}" (formatted from `deadline_at`).
- **Meta line:** "Attempt {n} · offered {sent_at formatted}" plus, for expired rows, "· no response by deadline". Accepted/declined rows with a `responded_at` append "· responded {time}".
- **Decline reason:** when present, quoted in full on its own line; wraps, never truncates.
- The latest pending attempt gets the highlighted (brand) timeline dot; resolved attempts get muted dots.
- If a row's `slot_index_chosen` is present on an accepted attempt, it is ignored for v1 (the confirmed slot already shows in the sheet's Date/Time block).

**States:** hidden while loading and when zero rows (see gating). Error: compact ErrorState with retry inside the collapsible.

## New primitive: `src/components/ui/timeline.tsx`

The dot + connector + item shape is built as a small reusable primitive (e.g. `Timeline`, `TimelineItem` with a `tone`/`current` prop for the dot), styled entirely from tokens. Deliberate choice: a future payment-attempts history section would reuse exactly this shape. Keep the API minimal — no icons-in-dots, no branching, just stacked items with a connector line.

## Logic and testing

Pure logic lives in tested helpers (precedent: `booking-vm.ts`):

- `src/lib/bookings/jobPhotosVm.ts`: group/order photos by phase, build alt text, compute section visibility (photos/skipped/status rule), map skip state. Unit-tested.
- `src/lib/bookings/routingHistoryVm.ts`: map `appointment_routing_log` rows to timeline item VMs — badge tone + label per response, deadline/sent-at formatting inputs, "current attempt" determination, section visibility. Unit-tested.

No new API routes and no migration, so no new integration tests. E2E not required; before the PR: browser smoke pass (open sheet on bookings with photos / skipped photos / routed booking / direct-assigned booking), screenshots to Bridger, plus the ui-ux-pro-max conformance check and the "no off-system styling leaked" pass.

## Out of scope (explicit)

- Operator photo upload or delete (RLS has no manager write today).
- Homeowner gallery parity (§4 nice-to-have; separate decision).
- Payment-attempt timeline (future; reuses `ui/timeline.tsx`).
- Realtime updates for routing log or photos in this sheet.
- "During" photo capture UI for cleaners (display supports the phase if data exists).
- Any re-offer/re-route action from the routing section.

## Logistics

- Built in the isolated worktree branch (off master @ f7e3234) because the main checkout is owned by the concurrent card-link-email session (PR #149). Conflict surface with #149 is expected to be limited to `BookingDetailSheet.tsx` registration lines; rebase before opening the PR.
- No migration, no env vars, no feature flag, no new dependencies (`yet-another-react-lightbox` is already installed).
- Commit trailer per project convention; merge only on Bridger's explicit go-ahead.
