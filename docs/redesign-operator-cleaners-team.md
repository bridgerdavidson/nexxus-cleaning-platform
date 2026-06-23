# Operator "Cleaners & team" screen — design spec

Status: approved direction, pending spec review
Branch: `feat/redesign-operator-cleaners` (off `master`)
Date: 2026-06-22

This is the next operator screen in the flag-gated redesign (after Overview, Bookings, Customers, Services). It replaces three fragmented legacy surfaces (Cleaner Management, Team Members, Invites) with one crew-operations workspace, built on the established **Customers list + Sheet** pattern.

---

## 1. Goal

Turn the people tab from a flat contact-card directory into an **operations workspace**: a cleaner roster you can triage at a glance (who's loaded, who's owed money, who can't get paid yet, who's benched) and drill into for a real per-cleaner scorecard, workload, payout health, and profile. Invites fold in as a status layer so the list reads as the whole crew, active plus in-flight.

## 2. Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| 1 | v1 ambition | **Go big**: include the per-cleaner performance scorecard and workload/upcoming-jobs panel in v1. |
| 2 | Roster scope | **Cleaners-focused**: roster = cleaners + pending cleaner invites. Managers/admins are not in this roster in v1 (they stay in the legacy team surface / settings). |
| 3 | Invites | **Folded in** as an inline "Pending" group atop the roster, native invite dialog, and we add the missing **Cancel/Revoke** action. |
| 4 | Ratings | **Placeholder now**: reserve a "No ratings yet" slot. The homeowner "rate your cleaner" write path is a separate later piece, not this screen. |
| 5 | Backend | **Full backend**: org-wide `cleaner_scorecard` RPC + `deactivated_at` bench migration + cancel-invite write + promote cleaner-edit to a proper API route (kills today's client-direct RLS `alert()`s). |

## 3. Scope

**In (v1):**
- New flag-gated screen at `/app/admin-dashboard/cleaners`, cloning the Customers architecture.
- Roster: search-as-hero, live-count subtitle, sort, desktop table + mobile cards, bulk payout-% (parity), bulk deactivate.
- Pending cleaner invites as a top group; send invite (dialog); resend; **cancel/revoke (new)**.
- Cleaner detail Sheet: header, performance scorecard, workload (upcoming jobs), payout health + Connect "can't get paid" callout with a Send-setup-link action, profile (inline edit), footer actions (deactivate/reactivate, remove).
- Soft **deactivate/bench** (new `deactivated_at`), benched cleaners excluded from assignment elsewhere.
- New backend: `cleaner_scorecard(p_org_id)` RPC, `deactivated_at` migration, `POST /api/admin/cancel-invite`, `POST /api/admin/update-cleaner`.

**Out (v1), deferred to fast-follow or later:**
- Real ratings collection (homeowner post-job rating + write path). Slot is reserved, data is not.
- On-time %, no-show/cancellation tracking, reliability strip (decline/counter rates).
- Managers/admins in the roster, inline manager-permission (15-flag) editing, change-org-role. Keep the existing `/settings/team/[managerId]` deep-link.
- Availability scheduling, smart assignment, capacity planning, documents/certifications, crew broadcast, leaderboard (all Tier 2, need new tables).

## 4. Information architecture and file layout

Mirror `src/components/redesign/customers/` exactly. New files under `src/components/redesign/cleaners/`:

| File | Role (mirror of Customers) |
|---|---|
| `OperatorCleaners.tsx` | Permission **gate** + inner `OperatorCleanersData` **container** (one file, like `OperatorCustomers.tsx`). |
| `OperatorCleanersView.tsx` | Pure View. Renders identically from real or mock data. |
| `CleanersTable.tsx` | Desktop table (`lg:block`). |
| `CleanersCardList.tsx` | Mobile cards (`lg:hidden`). |
| `CleanerDetailSheet.tsx` | Radix `Sheet`, opened by container state. |
| `CleanersBulkBar.tsx` | Floating select pill: bulk deactivate, bulk payout-%. |
| `AddCleanerDialog.tsx` | Radix `Dialog`, email-only invite (role = cleaner). |
| `deriveCleaners.ts` (+ `deriveCleaners.test.ts`) | Pure filter/sort/group. Unit-tested. |
| `cleaners-presenters.tsx` | Status/connect/payout badge JSX. |
| `cleaners-types.ts` | View-model types + sort constant. |

Route: `src/app/(redesign)/app/admin-dashboard/cleaners/page.tsx`, cloning the Customers `page.tsx` (auth/org gate → `Spinner` / `WorkspaceErrorScreen` → `<Suspense>` → `<OperatorShell active="cleaners" onNewBooking={...}>` → `<OperatorCleaners />`).

Nav: repoint the existing `cleaners` entry in `src/components/redesign/shell/nav-items.ts` from `/admin-dashboard?tab=cleaners` to `/app/admin-dashboard/cleaners`. (Entry already exists: label "Cleaners & team", `SprayCan` icon. `OperatorShell active` already keys on `"cleaners"`.)

Dev preview: add a mock-data path so the screen renders in `(dev)/operator-preview` like the others (pure View fed mock VMs).

## 5. Permission gating (gate before fetch)

Clone the Customers gate. Cleaner roster data (profiles, contact, earnings) is protected by an app-level grant, not RLS, so do not fetch until allowed.

```
OperatorCleaners()                       // gate
  privileged = currentOrgRole in (owner, admin)
  canManage  = privileged || permissions.can_manage_cleaners
  if (!privileged && permsLoading) -> spinner (hold, don't flash denied)
  if (!canManage)                  -> EmptyState(ShieldAlert, "no access to cleaners")
  else -> <OperatorCleanersData
            canViewPayments={privileged || permissions.can_view_payments}
            canEdit={canManage} />
```

`canViewPayments` gates earnings + payout dollars in the scorecard and the payout-health section (mirrors how Customers hides spend). `canEdit` gates inline profile edit, invite/cancel, deactivate, remove, bulk actions.

## 6. Data layer

### Roster (one round trip)
New headless hook `useAdminCleaners()` (mirror `useAdminCustomers`) calls the new **`cleaner_scorecard(p_org_id)`** RPC and returns `AdminCleaner[]` plus `loading`, `refetch`, `updateCleanerInState`. One row per active/benched cleaner with profile + scorecard aggregates + payout health + cached Connect flags + workload counts (see §10).

### Pending invites
Reuse `useInvites` (already realtime, lazy-gated). The container filters to `role === 'cleaner'` pending/creating/failed/expired/superseded rows and merges them as the roster's top "Pending" group. An accepted invite flips a pending row into a real cleaner row live (realtime on both `invites` and a roster refetch).

### Detail (lazy)
New `useCleanerDetails(cleanerId)` (mirror `useCustomerDetails`): loads on Sheet open. Returns the cleaner's **upcoming jobs** (appointments where `cleaner_id = id` and status in pending/confirmed/in_progress, ordered by date) and the **payout breakdown** (payout rows grouped by status, owed-now). Profile fields for the row/header come from the roster row; richer editable fields (bio, experience, hourly rate) come from the detail fetch or are already on the roster row.

### Mutations (container-owned, mirror Customers helpers)
- `updateCleaner(id, fields)` → `POST /api/admin/update-cleaner` (new; replaces client-direct write).
- `inviteCleaner(email)` → existing `inviteTeamMember({ role: 'cleaner' })`.
- `cancelInvite(inviteId)` → `POST /api/admin/cancel-invite` (new).
- `resendInvite(...)` → existing send-invite (supersede).
- `deactivateCleaner(id)` / `reactivateCleaner(id)` → `POST /api/admin/update-cleaner` (sets/clears `deactivated_at`), or a dedicated field on that route.
- `removeCleaner(id, orgId)` → existing `DELETE /api/admin/delete-cleaner` (keep one delete path; do not use `delete-team-member` for cleaners).
- `bulkUpdatePayouts(...)` → existing `bulk_update_cleaner_payouts` RPC (parity).
- `sendConnectSetupLink(id)` → existing `api/stripe/connect/onboarding-link`.

## 7. The roster (list)

- **Header**: `<h1>Cleaners &amp; team</h1>` + live-count subtitle, e.g. "12 active · 3 pending" (replaces KPI tiles; no KPI row).
- **Toolbar hero**: search `Input` (name/email) + a sort `Select`. Sorts: Name (A to Z), Most jobs this week, Top earners (gated by canViewPayments, falls back when hidden, like Customers' "spent"), Recently added.
- **Pending group**: pinned at top, visually distinct, each row shows email, role, invite status badge (pending/failed/expired/superseded), "invited {date}", actions Resend and **Cancel**.
- **Active rows** (desktop table / mobile cards), each with at-a-glance triage signals:
  - avatar + name (or email), with a **status badge** (Active / Benched).
  - **this-week load** = forward `upcoming_this_week` ("4 this week"), the operationally useful "who's loaded" signal.
  - **payout-health dot**: amber if owed-now &gt; 0, red if any failed/reversed payout, gray if settled (descriptive, follows the operator color hierarchy).
  - **Connect warning** chip ("Can't get paid") when Connect onboarding is incomplete.
  - lifetime cleaner earnings (gated by canViewPayments).
  - overflow menu: Open, Edit, Deactivate/Reactivate, Remove.
- **Benched** cleaners hidden by default; a filter/toggle reveals them (sort/segment kept minimal). They never appear in assignment dropdowns elsewhere (handled by the `deactivated_at` filter).
- **Bulk bar**: select → bulk Deactivate and bulk payout-% (parity with legacy "Manage Payouts"). Prune-selection-to-visible `useEffect` from Customers carried over so a hidden/benched cleaner can't be caught by a bulk action.

## 8. The cleaner detail Sheet

Radix `Sheet`, opened by container state (not URL, matching Customers). Sections top to bottom:

1. **Header** — avatar, name, status badge, payout-readiness chip (Connect ready / "Can't get paid"). Edit and overflow (Deactivate/Reactivate, Remove) actions.
2. **Performance scorecard** — stat boxes from the RPC: completed jobs, completion rate (completed vs cancelled), upcoming jobs, completed this week, lifetime cleaner earnings, pending owed. A **rating** stat box renders "No ratings yet" (reserved slot, decision #4). Earnings boxes gated by canViewPayments.
3. **Workload** — list of upcoming jobs (lazy `useCleanerDetails`), each reusing the existing booking card/row presentation. Empty state when none.
4. **Payout health + Connect** — pending / paid / bank-paid / failed counts, owed-now amount, and the **Connect status**. When onboarding is incomplete, a callout with a **"Send setup link"** button (`onboarding-link` route). Gated by canViewPayments.
5. **Profile** (inline edit, `onSave` returns `Promise<boolean>`) — name, email, phone, experience years, hourly rate, payout %, plus read-only verification badges (background check, insured, available). Inline form swaps in on Edit, like Customers.
6. **Footer** — Deactivate/Reactivate and Remove (destructive, via `ConfirmDialog`). Remove respects the existing guard (delete route refuses while active jobs exist); copy explains the block.

## 9. Invites folded in

- Pending cleaner invites are a labeled group, not flattened into member rows (they carry distinct affordances: Resend, Cancel, failed/expired/superseded states, "invited by").
- Send = `AddCleanerDialog` (email only, role = cleaner). Owners can also invite manager/admin elsewhere; this screen is cleaner-scoped.
- **Cancel/Revoke (new)**: `POST /api/admin/cancel-invite` sets the invite `status = 'revoked'` (the enum value exists but was never written). Owner/admin or `can_manage_cleaners`. Org-scoped. Realtime drops the row.
- `useInvites` stays lazy-gated (fetch on screen mount).

## 10. Backend changes

### 10a. Migration `091_cleaner_scorecard_and_deactivation.sql`
- `ALTER TABLE cleaner_profiles ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;` (null = active).
- New `cleaner_scorecard(p_org_id uuid)` `security invoker`, **set-returning** (one row per cleaner in the org). Model on `cleaner_stats` (migration 049) but aggregated per cleaner via `group by` rather than per-cleaner scalars. Returns, per cleaner:
  - identity/profile: `id, first_name, last_name, email, phone, avatar_url, payout_percent, hourly_rate, experience_years, is_available, background_check_verified, insurance_verified, deactivated_at, created_at`
  - cached Connect flags (read from existing `cleaner_profiles.stripe_connect_*`): account present, charges/payouts enabled → derive a `connect_status` (ready / incomplete / none)
  - scorecard: `total_jobs, completed_jobs, upcoming_jobs, completed_this_week, total_earnings_gross, cleaner_earnings, paid_amount, pending_owed`
  - forward load: `upcoming_this_week` = jobs in pending/confirmed/in_progress with `scheduled_date` in [today, today+7] (distinct from backward-looking `completed_this_week`)
  - payout health: `payouts_failed_count` (failed/reversed), `payouts_pending_count`, `owed_now`
  - Derive earnings exactly as `cleaner_stats` does (gross × payout_percent). **Never read `cleaner_profiles.rating` / `total_jobs`** (never written; always derive from `appointments`).
- Keep the `useAdminCleaners` hook resilient: RPC-first with a legacy fallback path if the function is absent (matching the 049 hooks' pattern), removable once shipped to all envs.

### 10b. `POST /api/admin/update-cleaner` (new route + integration test)
- Auth: owner/admin or `can_manage_cleaners`; org-scoped; rejects cross-org ids.
- Body: editable profile fields (name → `user_profiles`, phone/payout_percent/hourly_rate/experience_years/bio → `cleaner_profiles`), plus optional `deactivated_at` set/clear for bench/reactivate.
- Replaces `CleanerManagementPage.handleSave`'s client-direct writes and the raw RLS `alert()`s.

### 10c. `POST /api/admin/cancel-invite` (new route + integration test)
- Auth: owner/admin or `can_manage_cleaners`; org-scoped.
- Sets `invites.status = 'revoked'` for a pending/creating invite in the caller's org. Idempotent on already-terminal invites.

## 11. View-model types (sketch, `cleaners-types.ts`)

```
type CleanerSort = "name" | "load" | "earnings" | "recent";
type CleanerStatus = "active" | "benched";
type InviteRowStatus = "pending" | "creating" | "failed" | "expired" | "superseded";

type CleanerRowVM = {
  id; name; email; phone; avatarUrl; initials;
  status: CleanerStatus;
  thisWeekLabel: string;            // "4 jobs"
  upcomingCount: number;
  payoutHealth: "settled" | "owed" | "problem";  // -> dot color
  connectReady: boolean;            // false -> "Can't get paid" chip
  earningsLabel: string | null;     // gated by canViewPayments
  payoutPercentLabel: string;
};

type PendingInviteRowVM = {
  inviteId; email; status: InviteRowStatus; invitedLabel; canResend: boolean;
};

type CleanerDetailVM = { ...row fields + firstName,lastName,hourlyRate,experienceYears,bio,
  background/insured/available booleans, scorecard fields, connectStatus };

type CleanerScorecardVM = { completedJobs; completionRateLabel; upcoming; thisWeek;
  lifetimeEarningsLabel | null; pendingOwedLabel | null; ratingLabel: "No ratings yet" };
```

## 12. Realtime

- `useInvites` realtime stays (invite accept/cancel updates the Pending group).
- Roster: on relevant `cleaner_profiles` / `appointments` changes, invalidate/refetch `useAdminCleaners` (the RPC is aggregate, so prefer invalidate over patch). Reuse `useSupabaseRealtimeSync`, DB-level org filter.

## 13. Testing

- **Unit**: `deriveCleaners.test.ts` (search, the four sorts, pending-group separation, benched filtering, payout-health derivation, prune-to-visible). Pure, no infra. Follows the `deriveCustomers.test.ts` template.
- **Integration** (needs local Supabase): `update-cleaner` and `cancel-invite` route tests using `tests/helpers/` (`withTestOrg`, `callRoute`): auth/permission rejection, org-scoping, happy path, deactivate set/clear, cancel idempotency. The `cleaner_scorecard` RPC is exercised via an integration test that seeds appointments/payouts and asserts the aggregates (and that `rating`/`total_jobs` columns are ignored).
- **E2E** (optional follow): roster loads, open a cleaner, see scorecard, deactivate/reactivate, send + cancel an invite.

## 14. Risks and gotchas

- `cleaner_profiles.id` **is** the auth user id (no `user_id` column); `cleaner_id` FKs always point at it.
- `cleaner_profiles.rating` / `total_jobs` are **never written** — derive everything from `appointments` + (future) `reviews`. The `reviews` table exists but has **no write path**, so the rating slot is intentionally empty.
- Two delete routes exist (`delete-cleaner` global-by-id vs `delete-team-member` org-scoped). Use **`delete-cleaner`** for this screen; do not introduce a second path.
- Connect status in the roster reads **cached** `cleaner_profiles.stripe_connect_*` columns (a live `account-status` call per cleaner would be an N-row waterfall). The detail Sheet may refresh live on open.
- No em dashes in any UI copy, labels, toasts, or empty states. Dollars, not cents. Descriptive status badges per the operator color hierarchy.
- Migration must be idempotent (`IF NOT EXISTS`) and rebuild cleanly via `npx supabase db reset`; RPC fallback in the hook until shipped everywhere.
- Gate before fetch: never mount the data component (and its fetches) for a manager without `can_manage_cleaners`.

## 15. Rollout

- All under the `(redesign)` route group + `redesignUiEnabled()` flag (default off), like the other operator screens. Legacy `CleanerManagementPage` / `TeamMembersPage` / `InvitesPage` remain until the redesign is the default.
- Repoint only the `cleaners` nav href once the screen is in.
- Standard flow: branch → tests + `tsc` + lint green → `supabase db reset` for the migration → Codex review on the finished branch → commit fixes → push → PR to master.

## 16. Recommended build order (for the plan)

1. Migration (`deactivated_at` + `cleaner_scorecard` RPC) + `db reset` verify.
2. `useAdminCleaners` + `useCleanerDetails` hooks (RPC-first, fallback) + `update-cleaner` / `cancel-invite` routes (+ integration tests).
3. `cleaners-types.ts` + `deriveCleaners.ts` (+ unit test) + `cleaners-presenters.tsx`.
4. Pure View tree: `OperatorCleanersView` + `CleanersTable` / `CleanersCardList` / `CleanersBulkBar` + dev-preview mock.
5. `CleanerDetailSheet` + `AddCleanerDialog`.
6. `OperatorCleaners` gate + container wiring (mutations, realtime).
7. Route page + nav repoint.
8. Verify with Playwright MCP against local dev; iterate to feel native.
