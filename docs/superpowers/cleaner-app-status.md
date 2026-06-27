# Cleaner app redesign , status & resume notes

**Last updated:** 2026-06-27

This is the single place to re-orient when starting a fresh session on the cleaner (field-worker) app redesign. It complements the auto-loaded memory; read this first, then the spec + plan below.

## Where we are

- **Operator experience:** fully redesigned and shipped (PRs #79-#92). Done.
- **Cleaner app , Slice 1 (shell + Today): DONE.** Shipped in **PR #93** (squash-merged to master).
- **UI guardrail (so this doesn't regress): DONE.** The `ui-feature-workflow` skill + CLAUDE.md rules shipped in **PR #94** (squash-merged). See "Guardrail" below.
- **Cleaner app , Slice 2 (Schedule + job-detail overview): DONE — PR #95 (open, awaiting checks/merge).** The §9 cut: Schedule screen + a deep-linkable job-detail takeover (read + Start + inline offer Accept/Decline + `?job=`), Today/notifications rewired off the legacy `?appointment=` bridge. Plan: `docs/superpowers/plans/2026-06-27-cleaner-app-slice-2-schedule-job-detail.md`. **NEXT = Slice 3 (the active-job flow).**

## The plan: ship the cleaner app in 6 flag-gated slices

Spec: `docs/superpowers/specs/2026-06-26-redesign-cleaner-app-design.md`
Slice-1 plan: `docs/superpowers/plans/2026-06-26-cleaner-app-slice-1-shell-today.md`

> Note: the live cut follows the spec **§9** (it splits the old doc's item 2 into 2 + 3): Slice 2 = Schedule + job-detail overview (read + start + offers); Slice 3 = the full active-job flow.

1. **Shell + Today , DONE (PR #93).**
2. **Schedule + job-detail overview (read + Start + inline offer Accept/Decline + `?job=` deep-link) , DONE (PR #95).**
3. **Active-job flow + photo gate + lifecycle/charge , NEXT.** The hybrid section-card flow from the in-redesign job detail (overview section cards -> Before photos / Checklist / After photos sub-screens -> Complete confirmation), required-by-default + skip-with-reason photo gate (gate on photo *queued*, not upload-confirmed), migration `organizations.require_job_photos` (default true) + a place to record the skip reason, and wiring `updateJobProgress` + charge-at-completion. In Slice 2 the in_progress "Continue job" bridges to the legacy active-job wizard; this slice replaces that.
4. **Earnings.** Reuse the Stripe Connect embed (`PayoutsSection`/`ConnectPayouts`), payouts list, "awaiting customer payment".
5. **Messages.** Reuse the operator chat components + mobile thread takeover; job-scoped threads via `messages.appointment_id`.
6. **Profile + employee-model placeholders.** Profile/availability placeholder + read-only services; **wire the real `organizations.default_payout_model` read into Today** (replacing the slice-1 hardcoded `"percentage_contractor"`).

## What Slice 1 actually contains (so you don't re-derive it)

- **Routing:** `src/lib/redesign/dashboardPath.ts` , cleaner + redesign -> `/app/cleaner-dashboard`.
- **Shell:** `src/components/redesign/cleaner/shell/` , `CleanerShell` (top bar + 5-tab bottom nav: Today/Schedule/Earnings/Messages/Profile, no desktop rail), `CleanerTopBar`, `CleanerBottomNav`, `cleaner-nav-items.ts`. Guarded route-group layout at `src/app/(redesign)/app/cleaner-dashboard/layout.tsx`.
- **Today:** `src/components/redesign/cleaner/today/` , `deriveToday.ts` + `today-presenters.ts` (pure, unit-tested) -> `CleanerTodayView` (pure) + `CleanerToday` (container). Page at `src/app/(redesign)/app/cleaner-dashboard/page.tsx`.
- **Tab stubs:** schedule/earnings/messages/profile render "coming soon" EmptyState.
- **Bridge:** deep job/offer taps go to legacy `/cleaner-dashboard?appointment=<id>` until Slice 2.
- **Offer card:** uses an amber "Respond by <time>" pill (`formatRespondBy`), NOT a left stripe (see Guardrail).
- **Notifications:** `deriveNotifications` is role-aware; cleaner notifications route to cleaner/legacy, not the operator console.

## Locked design decisions

- **Model-aware** (`organizations.default_payout_model`): `percentage_contractor` (BUILT = offers + accept/decline, % pay) is the MVP; `hourly_external` (employee: availability + direct admin assignment) is placeholder-only, deferred to its own brainstorm (Brain target Aug-Sep 2026).
- Today-centric home; hybrid active-job flow (layout "C"); photo gate = required + skip-with-reason; **loose step order** (only Complete is gated); Settings link into the shared R2 settings shell (Profile is the personal hub only); read-only services catalog is IN; counter-propose times + calendar/month view are deferred.

## Guardrail (PR #94) , follow this for every UI slice

- Invoke the **`ui-feature-workflow`** skill at the start of any UI work (CLAUDE.md "Building features with significant UI" makes this binding).
- Two up-front asks: (1) use the **browser companion** for UX/structure? (2) **mobile or desktop?** , mobile means send screenshots (the user can't open localhost on a phone), desktop means send the link.
- The companion is **UX/structure only**; mockups are reference-only even when brand-fidelity. Implement from the design system (`src/components/ui/*` + tokens); new patterns become reusable primitives, not one-offs.
- Run **ui-ux-pro-max at BOTH** design and implementation (implementation pass catches off-system styling like raw hex).

## What Slice 2 contains (so you don't re-derive it)

- **Shared atoms** (`src/components/redesign/cleaner/shared/`): `job-presenters.ts` (the per-job presenters + `offeredSlots`/`OfferSlot` , the single tested source of slot derivation), `jobBadge.ts` + `CleanerJobBadge.tsx` (system-token status badge, replaced the slice-1 raw-hex tones), `JobRow.tsx`, `OfferActionsBar.tsx` (accept slot-chips + decline-reason vaul drawer). Reused by Today / Schedule / job-detail.
- **Schedule** (`.../cleaner/schedule/`): pure `deriveSchedule.ts` (date buckets Today/Tomorrow/This week/Later + Past, search, view-scoped status filter) -> `CleanerScheduleView` -> `CleanerSchedule`. Page renders the container (no Suspense needed; opening uses `useOpenJob`).
- **Job detail** (`.../cleaner/job/`): `deriveJobDetail.ts` (action mode offer/start/continue/done/none), `useOpenJob.ts` (`router.replace ?job=`), `CleanerJobDetailOverlay.tsx` (the `MobileThreadOverlay`-style takeover: safe-area, scroll-lock, Escape that yields to nested Radix layers, `aria-label`), `CleanerJobDetailHost.tsx` (reads `?job=` via `useDetailParam`, mounted once under `<Suspense>` in the cleaner **layout**). Data glue `useStartJob` / `useRespondToOffer` live in `src/hooks/useCleanerData.ts`.
- **Seam:** `?job=<id>` opens the detail from any tab (bell deep-links here too). The in_progress "Continue job" + the active card still bridge to legacy `/cleaner-dashboard?appointment=` (that flow = Slice 3). `Message operator` is NOT in the detail yet (Slice 5).

## How to resume Slice 3 (the active-job flow)

1. `git checkout master && git pull` (after #95 merges).
2. Worktree/branch off master: `feat/redesign-cleaner-app-slice3`. Fresh worktree needs `npm install` + a copied `.env.development.local`. Dev server points at the REMOTE dev Supabase; log in as `cleaner@nexxus.com` / `Cleaner123!` (creds for all roles are in `.env.development.local`).
3. Invoke `ui-feature-workflow` first; if exploring UX, ask companion + mobile/desktop.
4. Build the hybrid section-card flow off the existing `CleanerJobDetailOverlay` (it already has the takeover chrome + the in_progress "continue" hook to replace). Add the photo/checklist/complete sub-screens, the photo gate + skip-reason, the `require_job_photos` migration, and charge-at-completion. Flag-gated; dollars not cents; no em dashes; Codex + a final review before push.

## Strategic gut-check

The redesign is a hard gate before paid customers (per the Brain), and the cleaner UX feeds the pre-sell demo. BUT the binding $5k/mo levers , **price and pre-sell** , are still at zero. The redesign is build motion; it should not be the *only* thing moving. Worth raising with Bridger before sinking the next several slices in without parallel progress on price/pre-sell.
