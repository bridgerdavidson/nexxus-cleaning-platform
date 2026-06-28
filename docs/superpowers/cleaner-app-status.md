# Cleaner app redesign: status & resume notes

**Last updated:** 2026-06-28

This is the single place to re-orient when starting a fresh session on the cleaner (field-worker) app redesign. It complements the auto-loaded memory ([[project_redesign_cleaner_app]]); read this first, then the spec + the per-slice plan.

## Where we are

- **Operator experience:** fully redesigned and shipped (PRs #79-#92). Done.
- **Slice 1 (shell + Today): DONE** (PR #93; UI guardrail #94).
- **Slice 2 (Schedule + job-detail overview): DONE** (PR #95, squash `aeea1e5`). + appointment-sort overhaul (Needs-attention / Upcoming / Past zones).
- **Slice 3 (active-job flow): DONE** (PR #96, squash `2ea1594`). + org pay-display toggle + owner/admin settings UI + UI refinements.
- **Slice 4 (Earnings): DONE** (PR #98, squash `e79b596`). Stripe owns every money number (embedded `ConnectPayouts` is the sole authority); the one money thing we add is the **"Still clearing"** (ACH-settling) list + 3 activity counts; embed height-capped (`payoutsMaxHeight`). Detail in the memory.
- **Slice 5 (Messages): DONE** (PR #99, squash `2ff63c6`, merged 2026-06-28). See "What Slice 5 contains" below.
- **NEXT = Slice 6 (Profile + employee-model placeholders + wire the real `default_payout_model`).** This is the LAST cleaner slice.

## The plan: ship the cleaner app in 6 flag-gated slices

Spec: `docs/superpowers/specs/2026-06-26-redesign-cleaner-app-design.md`
Slice specs/plans live under `docs/superpowers/specs|plans/2026-06-2x-cleaner-app-slice-*`.

> The live cut follows the spec **§9** (it splits the old doc's item 2 into 2 + 3): Slice 2 = Schedule + job-detail overview; Slice 3 = the full active-job flow.

1. [x] **Shell + Today** (PR #93; guardrail PR #94).
2. [x] **Schedule + job-detail overview** + sort overhaul (PR #95).
3. [x] **Active-job flow + photo gate + charge-at-completion + migrations 095/096** (PR #96).
4. [x] **Earnings** , Stripe embed + "Still clearing" + activity counts (PR #98).
5. [x] **Messages** , collapsing office inbox + thread takeover + unread badge + active-job "Message office" (PR #99).
6. [ ] **Profile + employee-model placeholders , NEXT (last slice).** Profile edit (name/phone/avatar via `/api/user/upload-avatar`); **Availability placeholder** (employee model, gated on `default_payout_model==='hourly_external'`); **read-only services catalog** (reuse the services read path); **Notifications/Security** link into the shared R2 settings shell (do not rebuild settings in Profile); **wire the real `organizations.default_payout_model`** read into Today (replacing the slice-1 hardcoded `"percentage_contractor"`) + the cross-screen employee-model placeholders (hide contractor offers, show "assigned by your manager" framing on Today/Schedule). Sign-out visually separated. See spec §5.6 / §5.7.

## What Slice 5 (Messages) contains (so you don't re-derive it)

Reuses the shipped operator messaging stack; **no new data layer, migration, or API route**. Components under `src/components/redesign/cleaner/messages/**`; shared `src/components/redesign/shared/MobileTakeover.tsx` + `src/hooks/useKeyboardInset.ts`.

- **Office model = "collapsing inbox":** conversations are strictly 1:1 and there is NO "office" entity, so "the office" = N threads with the org's admins/managers. `deriveOfficeInbox` keys mode on reachable people (officeContacts ∪ existing-conversation participants): 0 → `empty`, 1 → `single` (the Messages tab IS that Office thread, rendered inline as a fixed surface below the 4rem top bar + above the bottom nav, keyboard-aware via `--kbd`), ≥2 → `inbox` (search + "New" picker + rows).
- **NO permission gate for cleaners:** the operator `can_view_messages` is manager-only (cleaners have no `manager_permissions` row → always false → copying it would lock them out). Who a cleaner can message is the role matrix `rolesUserCanMessage('cleaner')` = admin/manager (server-enforced via RLS + `get_or_create_conversation`).
- **Reuse:** extracted ONE shared `MobileTakeover` (slide-in + iOS keyboard takeover) from the operator `MobileThreadOverlay` and migrated the operator view onto it. `CleanerThread`/`CleanerMessageThreadView` reuse `MessageBubble`+`MessageComposer` (added a backward-compat `showReferenceBooking=false`) + the canonical `toConversationRowVM`/`toMessageVM`; trimmed header. Threads open as a takeover via `?thread=<convId>` (inbox row) or `?to=<userId>` (picker), hosted by `CleanerMessageThreadHost` (Suspense layout sibling, mirrors `CleanerJobDetailHost`).
- **Unread nav badge:** dedicated lightweight `useUnreadMessageCount(userId)` (one count query + one realtime channel, NOT the full inbox app-wide) → `CleanerShell`→`CleanerBottomNav`; clears on visit via `markMessagesAsRead`.
- **Active-job "Message office"** (Bridger iterated twice, FINAL): the button opens the `CleanerOfficePicker` **bottom sheet ON the active-job page** (inside `CleanerActiveJob`, like the Directions/Skip drawers; dismiss keeps them on the job). Picking → `openThreadFromJob(id, jobId)` → `/messages?to=<id>&appointment=<jobId>&from=<jobId>`: stages the job as a "Re: <job>" chip (reuse `useSendMessage.appointmentId`, no schema change) and the thread back button reads **"Back to job"** + `router.replace`s back to `?job=<jobId>` (replace, not push, so the dismissed thread is not stranded on the back-stack). `resolvePrimaryOfficeContact` exists but is UNUSED (Bridger chose explicit recipient choice).
- **Pure/TDD:** `office-contacts`, `deriveOfficeInbox`, `messages-cleaner-presenters` (18 tests). E2E smoke `tests/e2e/cleaner-messages.spec.ts` (resilient skip-on-uncertainty; preview auth/data latency is a known E2E flake — re-run clears it).

## What Slice 3 contains (still-relevant reference)

The active-job flow lives under `src/components/redesign/cleaner/job/`, on the `CleanerJobDetailOverlay` takeover (mode `'continue'` renders the active job). `CleanerActiveJob` (container: sub-screen stack + 2 `useImageUpload` managers + gate + skip) → `CleanerActiveJobView` (pure overview: 3 section cards + Complete bar). Pure/TDD: `deriveActiveJob` (gate) + `projectCompletionCharge` + `presentChargeProjection`. Migrations 095/096 (`require_job_photos`, `photos_skipped`, `checklist_item_completions`, `cleaner_pay_display`). Operator Settings > Business > "Cleaner experience" (`CleanerExperienceSection`, owner+admin) toggles pay-display + require-photos. Known gap: a cleaner's RLS still grants SELECT on `payments.amount` for own jobs (server redaction only; full DB privacy = a separate payments-RLS tightening). Future "cleaner_priced" payout model = a 3rd `cleaner_pay_display` value (NOT YET).

## Locked design decisions

- **Model-aware** (`organizations.default_payout_model`): `percentage_contractor` (BUILT) vs `hourly_external` (employee: availability + direct admin assignment, NOT built; placeholder-only; Brain target Aug-Sep 2026).
- Today-centric home; hybrid active-job flow (layout "C"); photo gate = required + skip-with-reason; Settings link into the shared R2 settings shell (Profile is the personal hub only); read-only services catalog is IN; counter-propose + calendar/month view deferred.

## Guardrail (PR #94) , follow this for every UI slice

- Invoke the **`ui-feature-workflow`** skill at the start of any UI work (CLAUDE.md makes this binding).
- Two up-front asks: (1) use the **browser companion** for UX/structure? (2) **mobile or desktop?** , mobile means send screenshots (the user can't open localhost on a phone).
- Companion is **UX/structure only**; mockups are reference-only. Implement from the design system (`src/components/ui/*` + tokens); new patterns become reusable primitives.
- Run **ui-ux-pro-max at BOTH** design and implementation (real Python 3.11 exe, NOT the `python`/`python3` Store stubs; script at `<ui-ux-pro-max>/2.5.0/src/ui-ux-pro-max/scripts/search.py`; resolve via `py -c "import sys; print(sys.executable)"` if the launcher misbehaves in a subshell).

## How to resume Slice 6 (Profile + placeholders)

1. `git checkout master && git pull` (master now has #99 / `2ff63c6`).
2. Branch off master: `feat/redesign-cleaner-app-slice6-profile`. Dev server + tests point at the REMOTE dev Supabase (no local Docker); log in as `cleaner@nexxus.com` / `Cleaner123!` (all-role creds in `.env.development.local`). **node_modules gotcha:** if you see a `tailwindcss-animate`/`tailwind-merge`/`class-variance-authority` build error or 2 "flaky" unit-file LOAD failures, that's STALE node_modules (deps in the lockfile but uninstalled after a branch reset) , run `npm install`, not a code bug.
3. Invoke `ui-feature-workflow` first; ask companion + mobile/desktop (Bridger usually mobile → send screenshots).
4. Build Slice 6 (spec §5.6 / §5.7): Profile edit, Availability placeholder, read-only services, Notifications/Security → shared R2 settings shell, wire real `default_payout_model` into Today + employee-model placeholders. Flag-gated; dollars not cents; no em dashes; Codex + whole-branch review (a workflow review pass works well) before push; PR to master, merge when the 4 checks are green. After merge: update THIS doc (Slice 6 done) + the memory.

## Strategic gut-check (read before starting Slice 6)

**5 of 6 cleaner slices are shipped.** The redesign keeps moving , but the binding $5k/mo levers, **price and pre-sell**, are STILL at zero (per the AI Second Brain GOALS.md). Slice 6 (Profile + placeholders) is the LOWEST-value remaining cleaner slice, so this is the natural pause point: **strongly consider spending the next session on price/pre-sell** (the things that actually move the revenue target) rather than auto-continuing to Slice 6. The cleaner app is already demo-able end-to-end (Today → active job → complete → earnings → messages). Raise this with Bridger before sinking the next slice in. Use the `brain-context` skill to pull the strategy.
