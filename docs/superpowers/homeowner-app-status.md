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
| 2 | **Cleanings** (list + `?appointment=` detail takeover + cancel w/ fee disclosure) | **PR #107** (open to master 2026-06-30; merging when CI green) |
| 3 | **Messages** (Office thread + per-cleaning job threads) | **NEXT** — see below |
| 4 | Account (properties, cards, receipts, browse services, profile) | not started |

## NEXT (for the fresh session): Slice 3 is gated on the Job-messaging feature

**Do NOT start Slice 3 by building UI.** Slice 3 (homeowner Messages tab) **consumes** a cross-cutting feature — **Job messaging** — that does not exist yet. Build that feature first.

1. **Job-messaging feature first** (own brainstorm → plan → build). Brief is already written and all 6 decisions are closed: `docs/superpowers/specs/2026-06-29-job-messaging-design.md`. It spans: homeowner Messages + cleaner-app companion update + operator office-read + DB migration (`conversations.appointment_id` + per-org kill-switch flag + RLS) + a **guarded send route** (send-gating is a route, NOT RLS — messages_insert is permissive today) + a `message_received` notification on job threads only. Key modeled decision: **a job thread is a property of an appointment, not a contact** (no compose-to-person picker), per-(appt, cleaner) **stint** on reassignment, send-open from cleaner-assigned → completed + ~24h grace (uses `appointments.started_at`/`completed_at`, added in Slice 1b), then archived read-only. Per-org kill-switch `organizations.homeowner_cleaner_messaging_enabled` (default true), server-enforced in send-gating, toggled under Settings → Cleaner experience.
   - GOTCHA from the spec review: `get_or_create_conversation` keys only on the participant pair, so it **collides** for >1 appointment with the same homeowner+cleaner (recurring) — the job-thread work needs `conversations.appointment_id` to disambiguate.
2. **Then Slice 3 (Messages tab):** sectioned inbox (Office pinned + active "Your cleanings" job threads + Past), reusing the operator/cleaner chat + `MobileTakeover`. Also wire the **"Message office" / "Message about this cleaning"** actions into the Slice 2 Cleanings detail (deferred from Slice 2 — there's a clean seam: `HomeownerCleaningDetail.tsx` is where they go).
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
