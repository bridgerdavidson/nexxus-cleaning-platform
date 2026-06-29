# Homeowner redesign (R3) — status / resume

> Third redesign surface, after operator (8 screens, done) and cleaner (6 slices, done). Phone-first consumer app: **book -> watch -> pay**. Flag-gated `(redesign)` route group at `/app/homeowner-dashboard`; legacy `/homeowner-dashboard` untouched. Last updated 2026-06-29 (Slice 1b merged).

## Where we are

| Slice | Scope | Status |
|---|---|---|
| Design | Spec + IA + 4-slice plan; job-messaging extracted to its own brief | DONE (committed) |
| **1a** | Shell (HomeownerShell/TopBar/BottomNav) + route group + Home (lifecycle hero, pending-request card, request entry -> legacy modal) + presenters + nav | **MERGED #104** (squash 6ed1a98) |
| **1b** | Live cleaning tracking | **MERGED #105** (squash 37c34f3) |
| 2 | Cleanings (list + `?appointment=` detail takeover; cancel w/ FEE DISCLOSURE + message-office) | NEXT |
| (cross) | Job-messaging feature (homeowner<->cleaner, appointment-bound) | designed, needs own plan; build around/before Slice 3 |
| 3 | Messages (consumes the job-messaging feature) | pending |
| 4 | Account (properties, cards, receipts, browse services, profile) | pending |

## Slice 1b — what shipped (live cleaning tracking)

Built via subagent-driven-development (9 TDD tasks + per-task review + opus whole-branch review = "Ready to merge"). The homeowner Home hero now morphs by appointment state:
- **in_progress** -> `LiveCleaningProgress` inside the brand-gradient hero: stage label (from `job_progress`), elapsed time (from `started_at`), a checklist progress bar ("X of Y done", white fill on the gradient), and a before-photo peek.
- **complete** -> `CompletedCleaningRecap` below the hero (warm card): after-photos + checklist-done summary + receipt line.

Files:
- `supabase/migrations/097_homeowner_live_tracking.sql` — `cic_homeowner_read` (SELECT-only, scoped by `appointments.homeowner_id = auth.uid()`) on `checklist_item_completions`; that table added to realtime (`replica identity full` + dup-guarded publication add); `appointments.started_at` / `completed_at`. **Applied to dev + prod.**
- `src/app/api/appointments/[appointmentId]/lifecycle/route.ts` — stamps `started_at`/`completed_at` idempotently (`.is(col,null)` first-write-wins).
- `src/components/ui/progress.tsx` — token-based Progress primitive (`value`, `className`, `aria-label`, `barClassName`).
- `src/components/redesign/homeowner/home/job-progress-presenters.ts` — `progressPercent` / `formatElapsed` / `stageLabel` (pure, unit-tested).
- `src/hooks/useHomeownerJobProgress.ts` + `useHomeownerJobPhotos.ts` — read-only, per-appointment realtime, homeowner-namespaced channels (`cic:homeowner:`, `job-photos:homeowner:`).
- `src/components/redesign/homeowner/home/{LiveCleaningProgress,CompletedCleaningRecap}.tsx` + the `HomeownerCleaningHero` enrichment.
- `useHomeownerAppointments` select extended with `job_progress` + the timestamps.
- Test helper added: `createUserClient(accessToken)` in `tests/helpers/supabase.ts` (anon + Bearer global header, non-memoized) for RLS-as-user assertions.

Verified: 711/711 unit, RLS 2/2 + lifecycle 9/9 integration, db reset clean, 0 new tsc, lint clean.

## Build conventions / gotchas (carry forward to Slices 2-4)

- **Design system only**: `src/components/ui/*` + tokens (`brand-600/500`, `shadow-soft-*`, `rounded-card/pill/control`, `bg-card`, `text-muted-foreground`, semantic `positive/caution/critical`). `bg-primary` bare = brand blue; numbered `primary-50..900` = legacy yellow. No raw hex. Status via badge/pill vocabulary, not decorative stripes. No em dashes. "operator" is internal jargon -> homeowner copy says "office".
- **Reuse logic, build presentation fresh**: reuse headless hooks (`useHomeownerAppointments/Properties/Payments/Stats/Requests`, `useConversations`) unchanged; do not import legacy styled components.
- **Query keys**: typed factory in `src/lib/queryKeys.ts`, never raw arrays.
- **RLS-as-user tests**: use `createUserClient(token)`, NOT the service-role `createTestSupabaseClient()`.
- **Integration tests** flake under full `npm run test` (parallel GoTrue) — run target files in isolation.
- **Homeowners ARE `organization_members`** (role `homeowner`), so existing org-member RLS policies (e.g. `checklist_line_items`) already let them read.
- SDD scratch lives in `.superpowers/sdd/` (git-ignored). Regenerate task briefs from the CURRENT plan (stale briefs from a prior slice will mislead implementers).

## Test data (dev only, project suaezjtspglgulunkyip)

Seeded an in-progress cleaning for **today** to test live tracking: appointment `4b79f4ca-06c1-46af-a101-00023fe28e2e`, homeowner **John Doe** (`homeowner@nexxus.com`), "The Stonecliff Home", `status=in_progress`, `job_progress=checklist`, `started_at` ~25 min ago, **6 of 9** checklist items done, 0 photos. To test the completed recap, set `status='completed'` + stamp `completed_at` (or run the cleaner Complete flow). Prod untouched.

## Roadmap context

Redesign-first: finish the full redesign (it gates the pilot), then pilot. Within-redesign order: operator + cleaner DONE -> **Homeowner [in progress]** -> New-booking flow redesign -> R4 launch polish; Platform-owner deferred. After homeowner: the deep "Request a cleaning" flow is the "New-booking flow redesign" step (homeowner currently opens the legacy `RequestAppointmentModal`).

## Resume

Start **Slice 2 (Cleanings)**: a list of the homeowner's cleanings + a `?appointment=` detail takeover (reuse the cleaner-app deep-link takeover pattern), with cancel (showing the cancellation-fee disclosure) and message-office actions. Plan: `docs/superpowers/plans/2026-06-29-redesign-homeowner-slice-2.md` (to be written via writing-plans). Spec: `docs/superpowers/specs/2026-06-29-redesign-homeowner-app-design.md`. Job-messaging brief (for Slice 3): `docs/superpowers/specs/2026-06-29-job-messaging-design.md`.
