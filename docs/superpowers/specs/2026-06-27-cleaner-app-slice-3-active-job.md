# Cleaner App Slice 3 — Active-Job Flow (design spec)

> Redesign cleaner app, R3. Slice 3 of the 6-slice plan. Builds on Slice 1 (shell + Today, PR #93) and Slice 2 (Schedule + job-detail overview, PR #95). Parent design: `docs/superpowers/specs/2026-06-26-redesign-cleaner-app-design.md` (§5.3 locks the active-job layout). Resume doc: `docs/superpowers/cleaner-app-status.md`.

**Goal:** Replace the `in_progress` "Continue job" legacy escape in `CleanerJobDetailOverlay` with an in-redesign active-job flow: an overview with Before-photos / Checklist / After-photos section cards plus a persistent Complete bar, a required-by-default photo gate with a skip-with-reason escape, persisted per-task checklist completion, and a Complete confirmation sheet that shows the authoritative customer charge + cleaner cut before charging.

**Architecture:** The job-detail takeover (`?job=<id>`, the `MobileThreadOverlay` pattern, mounted once in the cleaner layout via `CleanerJobDetailHost`) gains a `mode === 'continue'` body. The active-job overview and its focused sub-screens (Before / Checklist / After / Complete) live as **local state inside the takeover** (a small in-overlay screen stack); the `?job=` deep-link stays at the job level. All money/charge backend already exists and is reused as-is. New surface this slice: one migration (095), one read-only projection (pure fn + route + hook), two thin mutation hooks, the checklist-completions persistence, and the redesign UI.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, TanStack Query v5, Supabase (Postgres + Storage + RLS), Stripe (charge-at-completion already wired). Redesign design system: `src/components/ui/*` primitives + tokens in `tailwind.config.js` / `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, pillowy shadows).

## Global Constraints

- **Flag-gating:** the whole flow lives in the `(redesign)` route group (404 in prod unless `NEXT_PUBLIC_REDESIGN_ENABLED` or preview/dev). The charge call is additionally gated by `STRIPE_NEW_CHARGE_FLOW_ENABLED` (server + client), already in place — do not re-gate, just reuse.
- **No em dashes** in any user-facing copy (UI text, toasts, sheet copy, errors). Use periods, commas, parentheses, or "to".
- **Money in dollars**, never raw cents, in UI. Cents only in the data/compute layer.
- **Touch targets ≥ 44px**; phone-first at 375px; safe-area aware (the takeover already handles `visualViewport` + safe areas).
- **Design-system only** (see next section). No raw hex, no bespoke one-off classes copied from a mockup.
- **Convention:** every `<area>/` under `src/components/redesign/cleaner/` uses `Container.tsx` (data) + `<Name>View.tsx` (pure) + `derive<Name>.ts` + `derive<Name>.test.ts` + presenters (`*.ts/.tsx` + tests) + `<name>-types.ts`. Pure logic is TDD'd (red first). Reuse Slice 1/2 shared atoms in `src/components/redesign/cleaner/shared/`.
- **Branch off current `origin/master`** (worktree already created off `aeea1e5`); next free migration number is **095**.

## UI implementation & styling source (binding contract)

There are **no browser-companion mockups** for this slice. Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft pillowy shadows, the rounded scale), reusing the Slice 1/2 cleaner patterns (`CleanerJobBadge`/status pills, `JobRow`, the takeover overlay, `ui/drawer.tsx` / `ui/sheet.tsx`, section cards). Status and urgency are expressed through the **badge/pill vocabulary**, never decorative stripes or ad-hoc accents. If a needed pattern has no primitive yet, build it as a reusable primitive that matches the system, never an inline one-off. `ui-ux-pro-max` is run at both design and implementation phases; a conformance pass (no off-system styling leaked) runs before the PR.

## Scope

### In scope
1. **Migration 095** (`095_active_job_photos_and_checklist.sql`): `organizations.require_job_photos`, `appointments.photos_skipped` + `appointments.photo_skip_reason`, and a new `checklist_item_completions` table + RLS. Plus the matching type updates in `src/types/index.ts`.
2. **Projected-charge read** (the authoritative "exact cut"): a pure `projectCompletionCharge(...)` composing the existing money helpers, a read route `GET /api/appointments/[appointmentId]/charge-projection`, and a `useChargeProjection(appointmentId)` hook.
3. **Thin mutation hooks** in `src/hooks/useCleanerData.ts`: `useCompleteJob` (wraps the existing `updateAppointmentStatus(id,'completed')`), `useUpdateJobProgress` (wraps `updateJobProgress`), and the checklist-completion read+mutate (`useChecklistCompletions`, `useToggleChecklistItem`).
4. **Photo capture sub-screen** (`CleanerPhotoCapture`) for Before + After, reusing the `useImageUpload` hook + `uploadOne`/`lib/upload` + the `job_photos` table / `job-photos` bucket, redesign-styled (camera-first tile, library fallback, live progress, remove-with-confirm).
5. **Checklist sub-screen** (`CleanerChecklistView`) reusing `useChecklist`, with **persisted** per-task completion, 48px tap rows, progress header.
6. **Active-job overview** (`mode === 'continue'` body of the takeover): job context + 3 section cards + persistent bottom Complete bar; owns the upload managers + sub-screen stack.
7. **Photo gate** (required-by-default, gated on photo **queued-or-confirmed**, not upload-confirmed only) + **skip-with-reason** escape ("Can't add photos" → reason → records on the appointment → unlocks Complete).
8. **Complete confirmation sheet** (`CleanerCompleteSheet`): shows the projected customer charge + exact cleaner cut, primary Complete → `useCompleteJob` → green-check success → back to Today; ACH-aware ("processing") and non-fatal charge-failure copy.
9. **Replace the legacy bridge**: `CleanerJobDetailHost.onContinue` (and the Today active-job card's continue) open the in-redesign overview instead of `router.push('/cleaner-dashboard?appointment=')`.
10. **`derive*` + tests** for the gate, the projection math, and the completion-eligibility logic — the unit-test heart of the slice. Integration test for the projection route. One E2E happy-path + skip-path at 375px.

### Out of scope (deferred)
- The charge-at-completion **backend** (route, orchestration, settlement, ACH lifecycle) — already built and wired; reuse, do not re-spec or refactor the live charge path.
- The **owner "Require job photos" settings toggle UI** — ship the column + default-true now; the toggle lands in the R2 settings shell (or Slice 6). Reading a real column now avoids a later data migration.
- **Operator-side** surfacing of `photo_skip_reason` beyond storing it on the appointment (operator job-detail already reads appointment fields; no new operator UI this slice).
- **Realtime** on `checklist_item_completions` — plain fetch is enough this slice; add to the publication later if operators need live task ticks.
- Earnings (Slice 4), Messages / the in-job "Message operator" action (Slice 5 — render a disabled placeholder), Profile + read-only Services + employee-model placeholders (Slice 6).
- Strict step ordering, counter-propose times, calendar/month view.

## Locked design (parent §5.3) + resolved decisions

**Layout (locked, §5.3):** hybrid section cards (Layout C). The overview shows job context (customer, property, time, directions) and three section cards — **Before photos**, **Checklist**, **After photos** — each opening a focused full-screen sub-screen, plus a **persistent bottom Complete bar**. **Step order is loose** (only Complete is gated). The Complete confirmation is a bottom sheet showing the customer charge + cleaner cut; green-check on success, then back to Today.

**Photo gate (locked, §5.3):** required-by-default (≥1 before AND ≥1 after), gated on photo **queued** (not upload-confirmed), with a **skip-with-reason** escape (customer declined / no signal / other), per-org `require_job_photos` default true.

**Resolved this slice (Bridger, 2026-06-27):**
- **D1 — Complete sheet shows the EXACT post-fee number.** Build a read-only projection (see "Projected-charge read") that returns the authoritative customer charge + cleaner cut (after the processing-fee split), shown before the card is charged.
- **D2 — Skip reason is appointment-only.** Store `photos_skipped` + `photo_skip_reason` on the appointment (durable, surfaced in the operator's existing job detail). **No** notification route this slice.
- **D3 — Checklist completion is persisted to the DB.** New `checklist_item_completions` table (per-task, cross-device, auditable for the company).
- **D4 (default) — `require_job_photos`:** ship the column + default-true; toggle UI deferred.
- **D5 (default) — sub-screen navigation:** local in-overlay screen stack; only `?job=<id>` is URL-addressable (progress survives because photos live in `job_photos` and checklist ticks live in `checklist_item_completions`, both keyed to the appointment; in-flight uploads survive because the upload managers are owned by the overview, not the sub-screen).

## Data model — migration 095

File: `supabase/migrations/095_active_job_photos_and_checklist.sql`. All statements idempotent (`IF NOT EXISTS` / `IF EXISTS`).

```sql
-- Per-org: require before+after photos on job completion (toggle UI later).
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS require_job_photos boolean NOT NULL DEFAULT true;

-- Per-appointment: durable record of a photo-skip with reason (operator-visible).
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS photos_skipped boolean NOT NULL DEFAULT false;
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS photo_skip_reason text;

-- Per-task checklist completion (persisted; company-visible, cross-device).
CREATE TABLE IF NOT EXISTS checklist_item_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  checklist_line_item_id uuid NOT NULL REFERENCES checklist_line_items(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, checklist_line_item_id)
);

CREATE INDEX IF NOT EXISTS idx_cic_appointment ON checklist_item_completions(appointment_id);

ALTER TABLE checklist_item_completions ENABLE ROW LEVEL SECURITY;
```

**Completion semantics:** a row's *presence* means the task is done; toggling off **deletes** the row (`UNIQUE` makes the upsert/insert safe). `organization_id` is denormalized for org-scoped RLS reads (set from the appointment at write time).

**RLS (mirror `job_photos` patterns):**
- The **assigned cleaner** of the appointment may `SELECT`/`INSERT`/`DELETE` their own appointment's rows (`appointments.cleaner_id = auth.uid()`).
- **Org staff** (owner/admin/manager via `organization_members`) may `SELECT` rows for their org (`checklist_item_completions.organization_id` in the caller's orgs) so the operator job-detail can read them.
- Wrap the `auth.uid()` calls per the project's `auth_rls_initplan` convention (`(select auth.uid())`) to avoid the per-row re-eval cascade (see migrations 074-076).

**Type updates (`src/types/index.ts`):**
- `Organization`: add `require_job_photos: boolean`.
- `Appointment`: add `photos_skipped: boolean` and `photo_skip_reason: string | null`.
- New `ChecklistItemCompletion` interface `{ id; appointment_id; checklist_line_item_id; organization_id: string | null; completed_at: string; created_at: string }`.

**Verify:** `npx supabase db reset` rebuilds cleanly; run the existing integration suite (or at least the touched route's integration test) to confirm nothing regressed.

## Projected-charge read (the exact cut)

The Complete sheet must show the **authoritative** customer charge + cleaner cut. Reuse the existing pure money helpers (do **not** invent new math, and do **not** call the live charge path, which performs a charge):

- `computePaymentSplit({ grossCents, payoutPercent, platformFeeBps })` → `{ grossCents, platformFeeCents, cleanerCents, tenantRemainderCents }` — `src/lib/stripe/charges/splits.ts:36`. Cleaner cut = `floor(gross * payoutPercent / 100)` (decision #11, % of gross).
- `computeChargeBreakdown(method, baseCents)` → `{ baseCents, method, feeCents, chargeCents }` — `src/lib/payments/processingFee.ts:81`. The payer-facing charge grossed up for the Stripe processing fee.
- `computeSelfPayAmounts({ jobGrossCents, payoutPercent, method })` → `{ jobGrossCents, payoutPercent, cleanerCutCents, chargeCents, estimatedFeeCents }` — `src/lib/payments/selfPayMath.ts:63` (self-pay path: org pays 100% to cleaner after the Stripe fee).

**Inputs (read at the appointment):** `appointments.total_price` (the base), `appointments.is_self_pay`, payment method (`card` vs `us_bank_account`, defaulting to `card` when unknown), the cleaner's `cleaner_profiles.payout_percent` (per-cleaner; falls back to `organizations.default_cleaner_payout_percent`), and `organizations.platform_fee_bps`.

**New pure function** `projectCompletionCharge(input): ChargeProjection` in `src/lib/payments/projectCompletionCharge.ts`:
- `input`: `{ baseCents, method, isSelfPay, payoutPercent, platformFeeBps }`.
- Self-pay → delegate to `computeSelfPayAmounts`; homeowner-paid → `computeChargeBreakdown(method, baseCents)` for `chargeCents`/`feeCents` and `computePaymentSplit({ grossCents: baseCents, payoutPercent, platformFeeBps })` for `cleanerCents`.
- Returns `ChargeProjection = { baseCents, method, chargeCents, feeCents, cleanerCutCents, isSelfPay }`.
- **Pure + unit-tested** (red first): card, ACH, and self-pay reference cases pinned so the displayed number can't silently drift. (Deferring deduping the live charge path to call this is acceptable; note as hardening.)

**Read route** `GET /api/appointments/[appointmentId]/charge-projection/route.ts` (`runtime = 'nodejs'`):
- Auth: the assigned cleaner of the appointment, or org staff (reuse the same auth guard the existing charge route uses — `src/app/api/appointments/[appointmentId]/charge/route.ts` is the reference). 404 when the redesign/charge flow is off, matching the charge route's gating.
- Fetches the inputs above (service role), calls `projectCompletionCharge`, returns the `ChargeProjection` (cents). Co-located `*.integration.test.ts` covering auth, org-scope, and the returned breakdown for card + ACH + self-pay.

**Hook** `useChargeProjection(appointmentId)` (TanStack Query, org-scoped) → `{ projection, isLoading, error }`. Query key under `keys.appointments.*`. Used only when the Complete sheet opens (lazy/`enabled` on sheet open).

## Component architecture + the seam

All new components under `src/components/redesign/cleaner/job/` (extending the existing `job/` area):

- **`CleanerJobDetailOverlay.tsx`** (existing): when `mode === 'continue'`, render `<CleanerActiveJob appointmentId=... />` as the body instead of the read-only overview. The four action modes (offer/start/continue/done) already derive via `deriveJobActionMode` — only the `continue` body changes.
- **`CleanerActiveJob.tsx`** (new container): owns the active-job state — the local sub-screen stack (`'overview' | 'before' | 'checklist' | 'after' | 'complete'`), the two `useImageUpload` managers (before, after) so in-flight uploads survive sub-screen navigation, and the data hooks (`useJobPhotosForAppointment`, `useChecklist`, `useChecklistCompletions`, `useUpdateJobProgress`). Renders `CleanerActiveJobView`.
- **`CleanerActiveJobView.tsx`** (new, pure): the overview UI — job context block (reuse Slice 2 presenters: `propertyTitle`, `customerLabel`, `propertyAddress`, `mapsUrl`, time/date), 3 section cards (each a tappable card showing the section's status from `deriveActiveJob`), and the persistent bottom Complete bar. Sub-screens render over it (local stack). Directions reuse Slice 2's maps link; "Message operator" is a disabled placeholder (Slice 5).
- **`deriveActiveJob.ts` + `.test.ts`** (new, pure): the gate + completion-eligibility logic (signature below).
- **`CleanerPhotoCapture.tsx`** (new): a phase-parameterized (`'before' | 'after'`) capture sub-screen built on the `useImageUpload` manager passed down from the container + `useJobPhotosForAppointment`. Camera-first tile, library fallback, live per-file progress rows, confirmed-photo grid with remove-with-confirm. Reuses `job_photos` + the `job-photos` bucket via the existing upload lib. Presenter test for status text ("1 photo added", "Uploading 1 of 2", etc.).
- **`CleanerChecklistView.tsx`** (new): reuses `useChecklist` for the task list (`ChecklistWithItems.checklist_line_items[]`, each `{ id, task, position }`) and `useChecklistCompletions` + `useToggleChecklistItem` for persisted ticks. 48px rows, progress header ("X of Y done"). Presenter test for the count.
- **`CleanerCompleteSheet.tsx`** (new): a `ui/drawer.tsx`/`ui/sheet.tsx` bottom sheet. Opens `useChargeProjection`; shows customer charge + cleaner cut (dollars); primary Complete → `useCompleteJob`; success state per charge outcome; back to Today.

**Deep-link / progress survival:** only `?job=<id>` is addressable (Slice 2's `useDetailParam`/`useOpenJob`). Sub-screen position is local state. Progress survives a mid-flow exit because photos are in `job_photos` (or in-flight in the container-owned upload managers) and checklist ticks are in `checklist_item_completions`.

## Photo gate + skip logic

`deriveActiveJob` is the single source of completion-eligibility:

```ts
export interface ActiveJobGateInput {
  requireJobPhotos: boolean;   // org setting (default true)
  photosSkipped: boolean;      // appointment flag
  beforeSatisfied: boolean;    // >=1 before photo confirmed-in-DB OR queued/in-flight (not 'failed')
  afterSatisfied: boolean;     // >=1 after photo confirmed-in-DB OR queued/in-flight (not 'failed')
}

export interface ActiveJobGate {
  photoGateMet: boolean;       // !requireJobPhotos || photosSkipped || (beforeSatisfied && afterSatisfied)
  beforeNeeded: boolean;       // requireJobPhotos && !photosSkipped && !beforeSatisfied
  afterNeeded: boolean;        // requireJobPhotos && !photosSkipped && !afterSatisfied
  canComplete: boolean;        // === photoGateMet (checklist is NOT gated; loose step order)
  remaining: string[];         // human labels, e.g. ['Add a before photo', 'Add an after photo']
}
```

- **"queued-or-confirmed"** is computed in the container: `satisfied = confirmedCount > 0 || uploadItems.some(it => it.status !== 'failed')` where `uploadItems` is that phase's `useImageUpload.items` (statuses `queued|converting|compressing|uploading|done`). A `failed` item does not satisfy the gate. The upload manager is owned by `CleanerActiveJob` (not the sub-screen) so a queued photo keeps satisfying the gate after the cleaner returns to the overview and the upload finishes into a `job_photos` row.
- **Skip escape:** the Complete bar (or the photo cards) exposes a low-emphasis "Can't add photos" action that opens a small reason capture (radio: `customer declined` / `no signal` / `other` + freetext for "other"). Confirming writes `photos_skipped = true` + `photo_skip_reason` on the appointment via a focused route (below) and sets `photoGateMet`. Adapt the existing `NoPhotosWarningModal` styling into a redesign **gate + reason** surface — it is currently a *soft* warning (proceed-anyway); the redesign gate is **hard** (Complete blocked unless photos queued OR a reason recorded), so reuse the look, not the soft-proceed behavior.

**Skip route** `POST /api/appointments/[appointmentId]/photo-skip/route.ts`: assigned-cleaner/org-staff auth (same guard as the charge route), writes `photos_skipped` + `photo_skip_reason` via service role, scoped to the caller's appointment. Co-located `*.integration.test.ts` (auth, org-scope, the write). (Could be folded into completion, but a focused route keeps the skip durable and independently testable, and lets the cleaner record it before reaching Complete.)

## Checklist persistence

- `useChecklistCompletions(appointmentId)` → `Set<checklist_line_item_id>` of completed task ids (TanStack Query, org-scoped, key under `keys.appointments.*`).
- `useToggleChecklistItem()` → mutation: toggling on **upserts** a `checklist_item_completions` row (`appointment_id`, `checklist_line_item_id`, `organization_id` from the appointment); toggling off **deletes** it. Optimistic update of the `Set`, invalidate on settle. Uses the RLS (anon) client so the cleaner's own writes are authorized by policy.
- `CleanerChecklistView` derives `done = completedSet.has(item.id)` per row and the "X of Y" header. Checklist is **not** gated for Complete (loose order), but its progress shows on the overview's Checklist section card.

## Complete flow + charge wiring

- **`useCompleteJob()`** wraps the existing `updateAppointmentStatus(appointmentId, 'completed')` (which already sets `status` + `job_progress='completed'`, emits the lifecycle notification, and — under `STRIPE_NEW_CHARGE_FLOW_ENABLED` — calls `chargeCompletedAppointmentClient` → `POST /api/appointments/[id]/charge`). Mirror `useStartJob`: toast + invalidate `keys.appointments.byCleaner` + stats. The charge is **non-fatal** — the job completes even if the charge declines or returns `processing`.
- **Surface the charge outcome:** extend `updateAppointmentStatus`/`useCompleteJob` to **return** the charge outcome code it already receives from the charge route (`charged` / `processing` / `requires_action` / `declined` / `no_card` / `failed`), without changing the completion behavior. The sheet maps it to copy:
  - `charged` → green check, "Job complete. The card on file was charged $X." + "Your cut: $Y."
  - `processing` (ACH) → green check, "Job complete. Payment is processing (bank transfer). Your cut: $Y once it settles."
  - `requires_action` / `declined` / `no_card` / `failed` → still "Job complete." but a calm note: "We could not charge the card yet. Your operator has been notified and will sort it out." (no blame on the cleaner; details land in Earnings, Slice 4). Never imply the cleaner failed.
- On success the sheet shows the green-check state, then returns to **Today** (close the takeover, clear `?job=`).

## Testing strategy

- **Unit (TDD, red first):** `deriveActiveJob` (required-by-default, queued-counts-as-satisfied, failed-does-not, skip unlocks both, `require_job_photos=false` bypass, `remaining` labels), `projectCompletionCharge` (card / ACH / self-pay pinned breakdowns), checklist + photo presenters (count + status strings).
- **Integration (real local Supabase, `tests/helpers/`):** the `charge-projection` route (auth, org-scope, breakdown) and the `photo-skip` route (auth, org-scope, write). Co-located `*.integration.test.ts`.
- **E2E (Playwright, 375px):** start (`in_progress`) → before photo → checklist tick → after photo → Complete happy path; plus the skip-with-reason path (no photos → reason → Complete). Verify reduced-motion. Reuse the redesign flag + dev login roster.
- **Gates before PR:** `npm run test`, `npx tsc --noEmit`, `npm run lint`; `npx supabase db reset` (migration rebuilds); `ui-ux-pro-max` conformance review against the real components; Codex `--scope branch --base master`; screenshots of the **built** screens (Bridger is on mobile).

## Risks / notes

- **In-flight upload survival:** the gate's "queued counts" only holds if the `useImageUpload` managers live in `CleanerActiveJob` (the container), not the unmounting sub-screen. This is a deliberate lift; encode it and test the gate logic against both confirmed and in-flight inputs.
- **Projection vs actual charge drift:** the projection composes the same pure helpers the charge path uses, but they are not yet the *same* call site. Pin reference cases in tests; note deduping the live charge path to call `projectCompletionCharge` as future hardening.
- **Migration number race:** 095 is free now; other redesign work lands migrations quickly. Re-confirm 095 is unused at push time and renumber if a collision merged first (migrations are immutable once shipped).
- **`NoPhotosWarningModal` is soft.** Do not reuse its proceed-anyway behavior; the redesign gate is hard.
- **`default_cleaner_payout_percent` / `payout_percent`** may be `0` for unset cleaners; the projection then shows a `$0` cut. That is accurate (operator hasn't set the cleaner's percent), not a bug — but worth a one-line "cut set by your operator" affordance if it reads oddly. Confirm the fallback chain at build time.
