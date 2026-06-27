# Cleaner app redesign , status & resume notes

**Last updated:** 2026-06-26

This is the single place to re-orient when starting a fresh session on the cleaner (field-worker) app redesign. It complements the auto-loaded memory; read this first, then the spec + plan below.

## Where we are

- **Operator experience:** fully redesigned and shipped (PRs #79-#92). Done.
- **Cleaner app , Slice 1 (shell + Today): DONE.** Shipped in **PR #93** (squash-merged to master). Built via subagent-driven development (8 tasks, per-task review + a final Codex review).
- **UI guardrail (so this doesn't regress): DONE.** The `ui-feature-workflow` skill + CLAUDE.md rules shipped in **PR #94** (squash-merged). See "Guardrail" below.

## The plan: ship the cleaner app in 6 flag-gated slices

Spec: `docs/superpowers/specs/2026-06-26-redesign-cleaner-app-design.md`
Slice-1 plan: `docs/superpowers/plans/2026-06-26-cleaner-app-slice-1-shell-today.md`

1. **Shell + Today , DONE (PR #93).**
2. **Job detail + active-job flow , NEXT.** In-redesign job detail that replaces the legacy bridge; the hybrid section-card flow (overview cards -> Before photos / Checklist / After photos sub-screens -> Complete confirmation). Inline offer Accept/Decline moves into the redesign here.
3. **Photo gate + lifecycle/charge.** Required-by-default + skip-with-reason; gate on photo *queued* not upload-confirmed. Migration: `organizations.require_job_photos` (default true) + a place to record the skip reason for the operator. Wire `updateAppointmentStatus`/`updateJobProgress`/charge-at-completion.
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

## How to resume Slice 2

1. `git checkout master && git pull` (it now has #93 + #94).
2. Create a worktree/branch off master: `feat/redesign-cleaner-app-slice2`. Fresh worktree needs `npm install` + a copied `.env.development.local`.
3. Invoke `ui-feature-workflow` first; if exploring UX, ask companion + mobile/desktop.
4. Build via subagent-driven development; flag-gated; dollars (not cents) in UI; no em dashes in copy; Codex review before push.

## Strategic gut-check

The redesign is a hard gate before paid customers (per the Brain), and the cleaner UX feeds the pre-sell demo. BUT the binding $5k/mo levers , **price and pre-sell** , are still at zero. The redesign is build motion; it should not be the *only* thing moving. Worth raising with Bridger before sinking the next several slices in without parallel progress on price/pre-sell.
