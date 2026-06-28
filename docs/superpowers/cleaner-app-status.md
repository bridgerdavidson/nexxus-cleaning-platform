# Cleaner app redesign: status & resume notes

**Last updated:** 2026-06-28

This is the single place to re-orient when starting a fresh session on the cleaner (field-worker) app redesign. It complements the auto-loaded memory; read this first, then the spec + plan below.

## Where we are

- **Operator experience:** fully redesigned and shipped (PRs #79-#92). Done.
- **Cleaner app, Slice 1 (shell + Today): DONE.** Shipped in **PR #93** (squash-merged) + UI guardrail in **PR #94**.
- **Cleaner app, Slice 2 (Schedule + job-detail overview): DONE.** Shipped in **PR #95** (squash `aeea1e5`). The §9 cut: Schedule screen + a deep-linkable job-detail takeover (read + Start + inline offer Accept/Decline + `?job=`), Today/notifications rewired off the legacy `?appointment=` bridge, plus an appointment-sort overhaul (Needs-attention / Upcoming-with-dates / Past zones).
- **Cleaner app, Slice 3 (active-job flow): DONE.** Shipped in **PR #96** (squash `2ea1594`, merged 2026-06-28). Replaced the `in_progress` "Continue job" legacy bridge with the in-redesign active-job flow, plus two follow-ons added during review: an org pay-display toggle and its owner/admin settings UI, and a round of UI refinements. See "What Slice 3 contains" below.
- **NEXT = Slice 4 (Earnings).**

## The plan: ship the cleaner app in 6 flag-gated slices

Spec: `docs/superpowers/specs/2026-06-26-redesign-cleaner-app-design.md`
Slice-3 spec/plan: `docs/superpowers/specs/2026-06-27-cleaner-app-slice-3-active-job.md` + `docs/superpowers/plans/2026-06-27-cleaner-app-slice-3-active-job.md`

> Note: the live cut follows the spec **§9** (it splits the old doc's item 2 into 2 + 3): Slice 2 = Schedule + job-detail overview (read + start + offers); Slice 3 = the full active-job flow.

1. [x] **Shell + Today** , DONE (PR #93; guardrail PR #94).
2. [x] **Schedule + job-detail overview** (read + Start + inline offer Accept/Decline + `?job=` deep-link + sort overhaul) , DONE (PR #95).
3. [x] **Active-job flow + photo gate + charge-at-completion + migration** , DONE (PR #96). Plus the pay-display toggle + settings UI + UI refinements (see below).
4. [ ] **Earnings , NEXT.** Reuse the Stripe Connect embed (`PayoutsSection`/`ConnectPayouts`), payouts list, "awaiting customer payment". There is already a cleaner "awaiting payment" earnings query in `useCleanerData.ts` to build on.
5. [ ] **Messages.** Reuse the operator chat components + mobile thread takeover; job-scoped threads via `messages.appointment_id`. **This also wires the disabled "Message office" button** on the active-job screen (currently a deliberate Slice 5 placeholder).
6. [ ] **Profile + employee-model placeholders.** Profile/availability placeholder + read-only services; **wire the real `organizations.default_payout_model` read into Today** (replacing the slice-1 hardcoded `"percentage_contractor"`).

## What Slice 3 contains (so you don't re-derive it)

The active-job flow lives under `src/components/redesign/cleaner/job/`, built on the existing `CleanerJobDetailOverlay` takeover (mode `'continue'` now renders the active job instead of bridging to legacy).

- **Container + overview:** `CleanerActiveJob.tsx` (owns the local sub-screen stack + the TWO `useImageUpload` managers so in-flight uploads survive sub-screen nav + the gate + the skip flow) -> `CleanerActiveJobView.tsx` (pure overview: decluttered context header, 3 section cards, persistent Complete bar). Sub-screens are LOCAL state; only `?job=<id>` is URL-addressable.
- **Sub-screens:** `CleanerPhotoCapture.tsx` (reuses `useImageUpload` + `job_photos`), `CleanerChecklistView.tsx` (persisted ticks), `CleanerCompleteSheet.tsx` (vaul drawer; shows the projected charge + cut, then `useCompleteJob`).
- **Pure logic (TDD):** `deriveActiveJob.ts` (the gate: `canComplete = photoGateMet && checklistComplete`; checklist is required, photos required only if `require_job_photos` and not skipped) + `projectCompletionCharge.ts` (composes existing split/fee helpers; honors `STRIPE_FEE_PASSTHROUGH_ENABLED`) + `presentChargeProjection.ts` (redacts the customer charge for payout-only cleaners).
- **Migrations:** `095` (`organizations.require_job_photos` default true, `appointments.photos_skipped` + `photo_skip_reason`, `checklist_item_completions` table + RLS) and `096` (`organizations.cleaner_pay_display` text 'full'|'payout_only').
- **Routes:** `GET /api/appointments/[id]/charge-projection` (exact cut; omits the customer charge for payout-only cleaners), `POST /api/appointments/[id]/photo-skip`, and the owner/admin `PATCH /api/organizations/[orgId]/cleaner-experience`.
- **Hooks (in `useCleanerData.ts`):** `useCompleteJob`, `useUpdateJobProgress`, `useChecklistCompletions`, `useToggleChecklistItem`, `useChargeProjection`, `useSkipPhotos`, `useOrgRequireJobPhotos`. Charge-at-completion backend is REUSED unchanged (`updateAppointmentStatus(id,'completed')`).
- **Settings:** `src/components/redesign/settings/sections/CleanerExperienceSection.tsx` (operator Settings > Business > "Cleaner experience") toggles `cleaner_pay_display` (full vs payout-only) and `require_job_photos`. Owner+admin gated. Pattern: `useSettingsSection` + `SettingRow`/`SettingsSaveBar` + a `settings-api.ts` patch helper, registered in `sections.ts` + `sections/registry.ts`.
- **UI refinements (post-review):** decluttered the active-job header (customer name appears once; compact `formatJobWhen` + icon-led meta rows); `shared/CleanerDirectionsButton.tsx` (an `outline` button opening an Apple Maps / Google Maps action-sheet); the Complete button gates on the checklist being 100% done; the messaging placeholder is labeled **"Message office"** (NOT "operator" , "operator" is internal jargon for the admin/manager side and must not face cleaners).

### Slice 3 deferred / follow-ups
- **Payments-RLS privacy:** the pay-display redaction is server-side at the API, but a cleaner's RLS still grants SELECT on `payments.amount` for their own jobs, so a savvy cleaner could read the customer charge directly. Full DB-level privacy = a separate, riskier payments-RLS tightening.
- **"Message office"** wiring = Slice 5.
- **Future "cleaner_priced" payout model** (cleaner names a price; if within what the homeowner paid they keep it, org keeps the spread): becomes a 3rd `cleaner_pay_display` value + its own completion flow. Text column was chosen to slot it in. NOT YET.
- Minor: `useToggleChecklistItem` / `useOrgRequireJobPhotos` key off `currentOrganizationId` (single-org-cleaner assumption); the projection assumes `card` method (cleaner cut is correct; only the ACH customer-charge fee estimate overstates).

## Locked design decisions

- **Model-aware** (`organizations.default_payout_model`): `percentage_contractor` (BUILT = offers + accept/decline, % pay) is the MVP; `hourly_external` (employee: availability + direct admin assignment) is placeholder-only, deferred to its own brainstorm (Brain target Aug-Sep 2026).
- Today-centric home; hybrid active-job flow (layout "C"); photo gate = required + skip-with-reason; Settings link into the shared R2 settings shell (Profile is the personal hub only); read-only services catalog is IN; counter-propose times + calendar/month view are deferred.

## Guardrail (PR #94) , follow this for every UI slice

- Invoke the **`ui-feature-workflow`** skill at the start of any UI work (CLAUDE.md makes this binding).
- Two up-front asks: (1) use the **browser companion** for UX/structure? (2) **mobile or desktop?** , mobile means send screenshots (the user can't open localhost on a phone), desktop means send the link.
- The companion is **UX/structure only**; mockups are reference-only. Implement from the design system (`src/components/ui/*` + tokens); new patterns become reusable primitives, not one-offs.
- Run **ui-ux-pro-max at BOTH** design and implementation (run the real Python 3.11 exe, not the `python`/`python3` Store stubs; script at `<ui-ux-pro-max>/2.5.0/src/ui-ux-pro-max/scripts/search.py`).

## How to resume Slice 4 (Earnings)

1. `git checkout master && git pull` (master now has #96 / `2ea1594`).
2. Worktree/branch off master: `feat/redesign-cleaner-app-slice4`. A fresh worktree needs `npm install` + a copied `.env.development.local`. Dev server + tests point at the REMOTE dev Supabase (no local Docker); log in as `cleaner@nexxus.com` / `Cleaner123!` (creds for all roles are in `.env.development.local`). No local Supabase means migration + integration tests validate in CI only.
3. Invoke `ui-feature-workflow` first; if exploring UX, ask companion + mobile/desktop. Bridger is usually on mobile (send screenshots).
4. Build the Earnings tab. Reuse the operator Stripe Connect embed (`PayoutsSection` / `ConnectPayouts`) and the cleaner earnings/awaiting-payment hooks already in `useCleanerData.ts`. Flag-gated; dollars not cents; no em dashes; Codex + a final whole-branch review before push; PR to master, merge when the 4 checks are green.

## Strategic gut-check

The redesign is a hard gate before paid customers (per the Brain), and the cleaner UX feeds the pre-sell demo. BUT the binding $5k/mo levers , **price and pre-sell** , are still at zero. The redesign is build motion; it should not be the *only* thing moving. Worth raising with Bridger before sinking the next several slices in without parallel progress on price/pre-sell.
