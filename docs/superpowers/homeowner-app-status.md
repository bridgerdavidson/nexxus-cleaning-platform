# Homeowner redesign (R3) — status & resume notes

> Fresh-session handoff. Read this + `MEMORY.md` ([[project_redesign_homeowner_app]]) to resume. Last updated 2026-06-30 after Slice 2.

## Where we are

The Homeowner app is the **3rd redesign surface** (Operator + Cleaner are done). It's a phone-first consumer app, mental model **book → watch → pay**, built **Approach B** in the flag-gated `(redesign)` route group (`src/app/(redesign)/app/homeowner-dashboard/*`, presentational components under `src/components/redesign/homeowner/*`, on `src/components/ui/*` primitives). Legacy `src/app/homeowner-dashboard/*` is untouched until cutover.

- **Spec:** `docs/superpowers/specs/2026-06-29-redesign-homeowner-app-design.md` (design approved + reviewed). Slice plan in §9.
- **Bottom nav (4):** Home · Cleanings · Messages · Account.

### Slices

| Slice | What | Status |
| --- | --- | --- |
| 1a | Shell + Home (static, no migration) | **MERGED** (PR #104, squash 6ed1a98) |
| 1b | Live cleaning tracking (migration 097 + hooks + in-progress hero + completed recap) | **MERGED** (PR #105, squash 37c34f3); migration 097 on dev **and** prod |
| 2 | **Cleanings** (list + `?appointment=` detail takeover + cancel w/ fee disclosure) | **MERGED** (PR #107 + #108) |
| 3 | **Messages** (Office thread + per-cleaning job threads) | gated on Job-messaging; **PR1 backend = PR #109 (open)**, then build Slice 3 as PR2 |
| 4 | Account (properties, cards, receipts, browse services, profile) | not started |

## NEXT (for the fresh session): finish Job-messaging, then Slice 3

The cross-cutting **Job messaging** feature (which Slice 3 consumes) is being built first. Brief (all 6 decisions closed): `docs/superpowers/specs/2026-06-29-job-messaging-design.md`. PR1 plan: `docs/superpowers/plans/2026-06-30-job-messaging-backend.md`. Full state + architecture in memory `[[project_job_messaging]]`.

1. **Job-messaging PR1 (backend) = PR #109, OPEN, green locally** (branch `feat/job-messaging-backend`): migration 098 (`conversations.appointment_id` + 2 partial uniques + org kill-switch + server-only `get_or_create_job_conversation`), guarded `POST /api/appointments/[id]/messages` (admin-client write because `can_message_role` blocks homeowner<->cleaner; idempotent on `clientMessageId`; fails closed), `job_message` notification, kill-switch in the Cleaner-experience settings. **Merge is user-gated** - wait for it before building consumers.
2. **Then Slice 3 = PR2 (homeowner Messages tab):** sectioned inbox (Office pinned + active job threads + Past) reusing the operator/cleaner chat + `MobileTakeover`; wire "Message office" / "Message about this cleaning" into `HomeownerCleaningDetail.tsx`. **REQUIRED (dominant risk):** segregate job threads out of the existing Office inbox/unread badge (`useConversations`, `useUnreadMessageCount`, legacy `MessagesPage`, the shipped `CleanerMessages`) by filtering `appointment_id IS NULL`; route job sends/replies through the PR1 route with a `clientMessageId` (client `useSendMessage` INSERT is RLS-blocked for the pair). Then PR3 (cleaner companion) + PR4 (operator read-only panel).
3. **Then Slice 4 (Account).**

User wants to plow through consecutively.

## Patterns established in Slice 2 (reuse these)

- **Detail takeover deep-link:** a write-only `useOpenX` hook (sets `?param=`, no `useSearchParams`) for the list, + a host that reads `useDetailParam('param')` mounted in the **layout under `<Suspense>`** (so it opens from any tab + notification deep-links). See `cleanings/useOpenCleaning.ts`, `HomeownerCleaningDetailHost.tsx`, the layout.
- **Container/View split** (mirror the cleaner Schedule): container holds hooks + pure derive + open handler; View is presentational (props only). Pure derive in a `*.ts` with a co-located `*.test.ts`.
- **`MobileTakeover`** (`src/components/redesign/shared/`) for full-screen detail/thread; `keyboardAware={false}` for read-only, `true` for a composer.
- **Cancel/destructive confirm = vaul `Drawer`** (`src/components/ui/drawer.tsx`), not the legacy modal. Disclose money before charging.
- **Design system only:** tokens + `src/components/ui/*`; semantic shades are `-50`/`-700` (`critical-700`, `caution-50/700`, `positive-50/700`) — there is **no `critical-600`**. No raw hex, no `primary-*` (that's legacy yellow), no em dashes, no legacy component imports.
- **Cancel backend:** the owning homeowner can now cancel via `POST /api/appointments/:id/cancel` (role-allowed + ownership-gated + party/no_show server-forced). Gated client-side on `stripeNewChargeFlowUiEnabled()` + status ∈ {pending, confirmed}.

## Process

- Execute via **subagent-driven-development** (the ledger lives at `.superpowers/sdd/progress.md`, gitignored). Plans via writing-plans; UI work via the **ui-feature-workflow** skill (companion is UX/structure only; implement from the design system; run **ui-ux-pro-max** at design AND implementation).
- One PR per slice, branch off current master. Gates: `npm run test`, `npx tsc --noEmit`, `npm run lint`; `npx supabase db reset` for a migration slice. **Integration tests need local Supabase up** (`npx supabase start`, Docker Desktop) + `.env.test.local`. The full integration suite flakes locally on parallel GoTrue auth — run touched files in isolation; CI runs the full suite.
- `/codex:review` is **user-triggered only** (can't be auto-run); offer it before merge.
- Merges are **user-gated**. Visual verification is on the **Vercel preview** (homeowner role-guard + redesign flag); user is on **mobile**, so drive the preview with Playwright and send screenshots.

## Dev test data (remote dev Supabase `suaezjtspglgulunkyip`)

Homeowner **John Doe** (`homeowner@nexxus.com`) has an in-progress cleaning seeded TODAY (appt `4b79f4ca-06c1-46af-a101-00023fe28e2e`, `job_progress=checklist`, 6 of 9 done) for live-tracking + Cleanings testing. For a completed-recap test, set that appt `status=completed` + `completed_at`.
