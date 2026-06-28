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
- **Slice 6 (Profile + employee placeholders + real `default_payout_model`): DONE** (PR #101, squash `75020c1`, merged 2026-06-28). See "What Slice 6 contains" below.
- **✅ CLEANER APP COMPLETE (6/6).** Demo-able end to end: Today → active job → complete → earnings → messages → profile. Next redesign surfaces before the pilot: **Homeowner** experience, **Platform-owner** experience, **R4 launch polish** (auth screens, onboarding wizard, empty/skeleton/error/404). See the strategic note at the bottom.

## The plan: ship the cleaner app in 6 flag-gated slices

Spec: `docs/superpowers/specs/2026-06-26-redesign-cleaner-app-design.md`
Slice specs/plans live under `docs/superpowers/specs|plans/2026-06-2x-cleaner-app-slice-*`.

> The live cut follows the spec **§9** (it splits the old doc's item 2 into 2 + 3): Slice 2 = Schedule + job-detail overview; Slice 3 = the full active-job flow.

1. [x] **Shell + Today** (PR #93; guardrail PR #94).
2. [x] **Schedule + job-detail overview** + sort overhaul (PR #95).
3. [x] **Active-job flow + photo gate + charge-at-completion + migrations 095/096** (PR #96).
4. [x] **Earnings** , Stripe embed + "Still clearing" + activity counts (PR #98).
5. [x] **Messages** , collapsing office inbox + thread takeover + unread badge + active-job "Message office" (PR #99).
6. [x] **Profile + employee placeholders + real `default_payout_model`** (PR #101, squash `75020c1`). See "What Slice 6 contains" below.

## What Slice 5 (Messages) contains (so you don't re-derive it)

Reuses the shipped operator messaging stack; **no new data layer, migration, or API route**. Components under `src/components/redesign/cleaner/messages/**`; shared `src/components/redesign/shared/MobileTakeover.tsx` + `src/hooks/useKeyboardInset.ts`.

- **Office model = "collapsing inbox":** conversations are strictly 1:1 and there is NO "office" entity, so "the office" = N threads with the org's admins/managers. `deriveOfficeInbox` keys mode on reachable people (officeContacts ∪ existing-conversation participants): 0 → `empty`, 1 → `single` (the Messages tab IS that Office thread, rendered inline as a fixed surface below the 4rem top bar + above the bottom nav, keyboard-aware via `--kbd`), ≥2 → `inbox` (search + "New" picker + rows).
- **NO permission gate for cleaners:** the operator `can_view_messages` is manager-only (cleaners have no `manager_permissions` row → always false → copying it would lock them out). Who a cleaner can message is the role matrix `rolesUserCanMessage('cleaner')` = admin/manager (server-enforced via RLS + `get_or_create_conversation`).
- **Reuse:** extracted ONE shared `MobileTakeover` (slide-in + iOS keyboard takeover) from the operator `MobileThreadOverlay` and migrated the operator view onto it. `CleanerThread`/`CleanerMessageThreadView` reuse `MessageBubble`+`MessageComposer` (added a backward-compat `showReferenceBooking=false`) + the canonical `toConversationRowVM`/`toMessageVM`; trimmed header. Threads open as a takeover via `?thread=<convId>` (inbox row) or `?to=<userId>` (picker), hosted by `CleanerMessageThreadHost` (Suspense layout sibling, mirrors `CleanerJobDetailHost`).
- **Unread nav badge:** dedicated lightweight `useUnreadMessageCount(userId)` (one count query + one realtime channel, NOT the full inbox app-wide) → `CleanerShell`→`CleanerBottomNav`; clears on visit via `markMessagesAsRead`.
- **Active-job "Message office"** (Bridger iterated twice, FINAL): the button opens the `CleanerOfficePicker` **bottom sheet ON the active-job page** (inside `CleanerActiveJob`, like the Directions/Skip drawers; dismiss keeps them on the job). Picking → `openThreadFromJob(id, jobId)` → `/messages?to=<id>&appointment=<jobId>&from=<jobId>`: stages the job as a "Re: <job>" chip (reuse `useSendMessage.appointmentId`, no schema change) and the thread back button reads **"Back to job"** + `router.replace`s back to `?job=<jobId>` (replace, not push, so the dismissed thread is not stranded on the back-stack). `resolvePrimaryOfficeContact` exists but is UNUSED (Bridger chose explicit recipient choice).
- **Pure/TDD:** `office-contacts`, `deriveOfficeInbox`, `messages-cleaner-presenters` (18 tests). E2E smoke `tests/e2e/cleaner-messages.spec.ts` (resilient skip-on-uncertainty; preview auth/data latency is a known E2E flake — re-run clears it).

## What Slice 6 (Profile) contains (so you don't re-derive it)

Spec `docs/superpowers/specs/2026-06-28-cleaner-app-slice-6-profile-design.md` + plan `...plans/2026-06-28-cleaner-app-slice-6-profile.md`. Built inline (executing-plans, 7 tasks, TDD on pure logic). **No migration, no new API route.** Components under `src/components/redesign/cleaner/profile/**`.

- **Profile hub (layout "C", hybrid):** `CleanerProfile` (container, local dirty-state + a `useEffect` that resyncs to `user.profile` on external change without clobbering edits) → `CleanerProfileView` (pure). Inline name/phone/avatar edit + save-bar-when-dirty; **Account → Change password** row; **Catalog → Service catalog** row; **Availability** placeholder card (employee model only); separated **Sign out**.
- **Avatar:** fresh `CleanerAvatarEditor` built on `useImageUpload` with brand tokens. Did NOT reuse legacy `src/components/AvatarUpload.tsx` (it's full of `primary` yellow + a `rgba(217,167,24)` gold shadow). See [[feedback_no_legacy_style_bleed]].
- **Change password:** `ChangePasswordDialog` → confirm → existing `POST /api/auth/forgot-password` (`redirectTo` `/reset-password`) → toast. No new route.
- **Read-only Services catalog (layout "A"):** list (`CleanerServicesCatalog`) → detail (`CleanerServiceDetail`) as real sub-routes under `profile/services/[serviceId]`; reuses `useServices`/`useChecklists` + the tested `deriveServices` formatters. Sub-routes (not a takeover) because every tab already shows the greeting top bar; `[serviceId]` page reads `useParams`.
- **Real payout model WIRED:** added `default_payout_model` to the AuthContext org-load select + `currentOrganization` mapping; Today/Earnings/Schedule now read `currentOrganization?.default_payout_model ?? 'percentage_contractor'`. Employee (`hourly_external`) placeholders: offers hidden + "assigned by your office" framing (`deriveToday.isEmployee`, `scheduleStatusOptions(view, isEmployee)` drops `needs_response`) + the Availability card.
- **SPEC CORRECTION:** §5.6 assumed a "shared R2 settings shell" for Notifications/Security. It does NOT exist (redesign settings is operator-only at `/admin-dashboard/settings`; no Notifications/Security section for any role). Resolved with Bridger → Profile is self-contained (Change-password only); notification prefs + a real security surface are deferred to R4.
- **Pure/TDD:** `deriveProfile` (display name/initials/availability gate) + `deriveCatalog` (toCatalogRow/toCatalogDetail). E2E `tests/e2e/cleaner-profile.spec.ts` (resilient skip-on-uncertainty). Codex pre-push: 0 high, 2 med applied (form resync + reset stale employee filter), 1 low kept by design.
- **DISCOVERED, follow-up (out of scope, in the PR body):** the AuthContext org-load select never fetched `require_job_photos` / `cleaner_pay_display` either, so `currentOrganization` has used their DEFAULTS client-side (Slice 3's pay-display + photo-gate toggles don't reflect the DB value on the client). Small separate PR = add both to the select.

## What Slice 3 contains (still-relevant reference)

The active-job flow lives under `src/components/redesign/cleaner/job/`, on the `CleanerJobDetailOverlay` takeover (mode `'continue'` renders the active job). `CleanerActiveJob` (container: sub-screen stack + 2 `useImageUpload` managers + gate + skip) → `CleanerActiveJobView` (pure overview: 3 section cards + Complete bar). Pure/TDD: `deriveActiveJob` (gate) + `projectCompletionCharge` + `presentChargeProjection`. Migrations 095/096 (`require_job_photos`, `photos_skipped`, `checklist_item_completions`, `cleaner_pay_display`). Operator Settings > Business > "Cleaner experience" (`CleanerExperienceSection`, owner+admin) toggles pay-display + require-photos. Known gap: a cleaner's RLS still grants SELECT on `payments.amount` for own jobs (server redaction only; full DB privacy = a separate payments-RLS tightening). Future "cleaner_priced" payout model = a 3rd `cleaner_pay_display` value (NOT YET).

## Locked design decisions

- **Model-aware** (`organizations.default_payout_model`): `percentage_contractor` (BUILT) vs `hourly_external` (employee: availability + direct admin assignment, NOT built; placeholder-only; Brain target Aug-Sep 2026).
- Today-centric home; hybrid active-job flow (layout "C"); photo gate = required + skip-with-reason; read-only services catalog is IN; counter-propose + calendar/month view deferred.
- **Settings (corrected in Slice 6):** there is NO shared R2 settings shell to link into (redesign settings is operator-only; no Notifications/Security section exists for any role). Profile is self-contained with a lightweight Change-password action; notification prefs + a real security surface are deferred to R4.

## Guardrail (PR #94) , follow this for every UI slice

- Invoke the **`ui-feature-workflow`** skill at the start of any UI work (CLAUDE.md makes this binding).
- Two up-front asks: (1) use the **browser companion** for UX/structure? (2) **mobile or desktop?** , mobile means send screenshots (the user can't open localhost on a phone).
- Companion is **UX/structure only**; mockups are reference-only. Implement from the design system (`src/components/ui/*` + tokens); new patterns become reusable primitives.
- Run **ui-ux-pro-max at BOTH** design and implementation (real Python 3.11 exe, NOT the `python`/`python3` Store stubs; script at `<ui-ux-pro-max>/2.5.0/src/ui-ux-pro-max/scripts/search.py`; resolve via `py -c "import sys; print(sys.executable)"` if the launcher misbehaves in a subshell).

## The cleaner app is done. What's next (redesign-first roadmap)

The roadmap was reordered 2026-06-28 (with the business partners): **finish the WHOLE redesign before the pilot** releases to the anchor (Nexxus Corp Housing), so cleaners/homeowners learn the redesigned app once instead of switching mid-pilot. See the AI Second Brain `GOALS.md` + the decision log, and the memory [[project_roadmap_reorder_redesign_first]].

Remaining redesign surfaces (phone-first; reuse the cleaner patterns: `MobileTakeover`, `useKeyboardInset`, the Container/`*View`/`derive*`+TDD convention, the locked design system):
1. **Homeowner experience** , the customer-facing app (booking, properties, payment methods, job tracking, messages).
2. **Platform-owner experience** , the back-office (tenant provisioning, platform admin).
3. **R4 launch polish** , auth screens, the onboarding wizard (paused brainstorm: `docs/superpowers/specs/2026-06-25-onboarding-wizard-design.md`), and the empty/skeleton/error/404 states that don't exist in the redesign yet.
4. Then flip the `redesign` flag to default + cut over from the legacy UI.

Setup for any of these: `git checkout master && git pull`; branch off master; dev server + tests point at the REMOTE dev Supabase (no local Docker); cleaner creds `cleaner@nexxus.com` / `Cleaner123!` (all-role creds in `.env.development.local`). **node_modules gotcha:** a `tailwindcss-animate`/`tailwind-merge`/`class-variance-authority` build error or 2 "flaky" unit-file LOAD failures = STALE node_modules after a branch reset , run `npm install`. Always start UI work with the `ui-feature-workflow` skill (ask companion? + mobile/desktop?); run ui-ux-pro-max at design AND implementation; no legacy-style bleed.

## Strategic gut-check (still true)

The redesign is a hard gate before the pilot and paid customers, so finishing it IS on the critical path now. **But the binding $5k/mo levers , price and pre-sell , are STILL at zero** (AI Second Brain `GOALS.md`). Under the new roadmap they run **concurrently while the pilot is live**, not after. The risk: the redesign + pilot bug-fixing eat all attention and these slip again. Keep raising them with Bridger , build motion is not revenue motion.
