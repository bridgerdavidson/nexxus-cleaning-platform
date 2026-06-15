# Security Audit — Nexxus Cleaning Platform

**Date:** 2026-06-12
**Branch:** `fix/payments-observability-ux`
**Method:** 7 parallel read-only audit agents (Sonnet/Haiku) across legacy routes, core API authz, RLS/migrations, Stripe surface, client exposure, uploads/storage, and auth/identity. Findings verified by an adversarial Sonnet pass and grounded against the **prod** database (`ivcqusxdjprurhhrgpot`) read-only.
**Scope:** Entire application, not just the current branch diff.

Severity legend: **Critical** = unauthenticated full compromise or cross-tenant data breach. **High** = privilege escalation / cross-org access by an authenticated user. **Medium** = requires specific conditions or staff role. **Low** = defense-in-depth.

Status legend: ✅ Fixed in this pass · 🔭 Deferred (documented, needs a dedicated follow-up) · ℹ️ By design (no change)

---

## CRITICAL

### C1 — ~25 unauthenticated legacy repair/debug API routes (service-role, full takeover) ✅
**Files:** `src/app/api/{disable-rls-temporarily,disable-rls-simple,fix-database-trigger,cleanup-and-recreate-users,fix-trigger-and-create-users,remove-trigger-and-create-users,create-missing-auth-users-final,fix-admin-user,set-passwords,cleanup-and-create-users,create-cleaner-bypass-trigger,create-fresh-cleaner,create-users-simple,create-missing-auth-users,list-auth-users,debug-connection,check-existing-users,fix-cleaner-role,sync-existing-users,test-admin-connection,test-supabase-admin,update-profile-ids,work-with-existing-users}/route.ts` plus `admin/create-missing-users` and `admin/create-users-direct` (NODE_ENV-guarded).

These ship to production. Each is reachable by an unauthenticated HTTP request and uses the service-role client (bypasses RLS). Concretely, an anonymous attacker can:
- `POST /api/disable-rls-temporarily` (or `-simple`) — **disable RLS** on `user_profiles`/`cleaner_profiles`, then read/write every tenant's data via the anon key.
- `POST /api/fix-admin-user` / `cleanup-and-recreate-users` / `fix-trigger-and-create-users` — **create an `admin` account with a hardcoded password** (`Admin123!`) and log in as platform admin.
- `POST /api/set-passwords` — **reset real production user UUIDs** to known passwords.
- `POST /api/fix-cleaner-role` `{email}` — change any user's role.
- `GET /api/list-auth-users` / `debug-connection` / `check-existing-users` — **enumerate every user's email/UUID**; `debug-connection` also leaks the Supabase URL and a 20-char prefix of the service-role key.

**Exploit:** A single curl to `/api/fix-admin-user` yields an admin login; a single curl to `/api/disable-rls-temporarily` opens the whole database. No auth required.
**Fix:** Delete all of these routes and their driver pages. None have runtime value (legacy migration tooling per CLAUDE.md). The `auth-debug` page additionally renders the live session JWT and hardcoded creds — deleted too.

### C2 — `invoices/create` is fully unauthenticated, accepts client-supplied amount + cross-org ids ✅
**File:** `src/app/api/invoices/create/route.ts`
Zero auth. `organization_id`, `homeowner_id`, `amount`, `payment_id`, `appointment_id` all taken from the body; linked-record existence checks don't filter by org. Any anonymous caller forges invoices against any org for any amount, optionally stapling another org's `payment_id`.
**Fix:** Added `requireOrgAuth(['owner','admin','manager'])`, derived `organization_id` from the verified membership, and scoped `payment_id`/`appointment_id` lookups to that org.

### C3 — `recurring-appointments` (POST + GET) fully unauthenticated; mass write + PII read ✅
**File:** `src/app/api/recurring-appointments/route.ts`
POST writes `recurring_appointment_series` + bulk `appointments` rows from fully client-supplied data (org, homeowner, cleaner, price, payment method, `status`). GET returns homeowner name/email + property address for any `organizationId` query param.
**Fix:** Added `requireOrgAuth(['owner','admin','manager'])` to both handlers; org now derived from the verified caller, not the body; `status` no longer client-settable.

### C4 — Cross-tenant RLS leak via unscoped `app_metadata.role` predicate ✅
**Files:** policies on `payments`, `appointments`, `messages`, `user_profiles`, `organization_members`, `cleaner_profiles` (migrations 074/075 + baseline). Confirmed live on prod.
Every one of these policies contains a branch like `((auth.jwt() -> 'app_metadata' ->> 'role') = ANY('{admin,manager}'))` **with no organization scope**. `app_metadata.role` is the per-user global role (set for every org's admin/manager). So any tenant admin/manager can `GET /rest/v1/payments` (or appointments, messages, user_profiles, organization_members) and read **every other tenant's rows**. `cleaner_profiles_select` is worse: `USING (true)` for `public`, readable by `anon` — exposing `stripe_connect_account_id`, `payout_percent`, phone, email of all cleaners.
**Fix:** Migration `089_security_audit_rls_hardening.sql` rewrites each policy to drop the global-role branch and scope to the row's `organization_id` (via `is_admin_or_manager_in_org`) plus the existing party/self branches; `is_platform_admin()` retains the legitimate see-all path. `cleaner_profiles_select` and `reviews` narrowed to `authenticated` + same-org.

### C5 — `get-payment-method` unauthenticated card-data disclosure ✅
**File:** `src/app/api/stripe/get-payment-method/route.ts`
No auth. `POST {homeowner_id}` returns the card brand + last4 for any user, and confirms who is a Stripe customer.
**Fix:** Added `verifyAccessToken` + self-or-org-staff authorization before the lookup.

---

## HIGH

### H1 — Public self-registration as `admin`/`manager` ✅
**File:** `src/app/api/auth/signup/route.ts` (+ `src/app/signup`)
Signup accepts `role` from the body, allowlisting `admin` and `manager`, and writes it to `app_metadata` + `user_profiles` + `organization_members`, attaching the user to the "Default Organization" (or the first org in the table). Any web visitor becomes an admin of a live org. `email_confirm: true` means no inbox needed.
**Fix:** Public signup is now `homeowner`-only; staff roles must come through the invite flow. Signup UI updated to stop offering staff roles. Removed the unconditional `console.log` of the service-role-key prefix.

### H2 — `delete-team-member` lets an admin delete the org owner ✅
**File:** `src/app/api/admin/delete-team-member/route.ts`
Caller allowlist is `['owner','admin']`; the target's role is read but never checked, so an `admin` can delete the `owner` and become the top of the org with nobody able to revoke them.
**Fix:** Reject deletion when the target's org role is `owner`.

### H3 — SECURITY-relevant RPCs callable by `anon`; stats RPCs have no membership gate ✅
**Files:** `admin_dashboard_stats`, `payment_stats`, `org_customers_with_counts`, `cleaner_stats`, `bulk_update_cleaner_payouts`, `get_or_create_conversation` (baseline). Confirmed `anon` can EXECUTE all six on prod.
`bulk_update_cleaner_payouts` has **no auth check** and mutates payout percentages. The stats RPCs accept an arbitrary `p_org_id` and (combined with C4) returned cross-org aggregates. `get_or_create_conversation` (SECURITY DEFINER) trusts a caller-supplied `user1_id` instead of binding to `auth.uid()`.
**Fix:** Migration 089 revokes `EXECUTE ... FROM anon` on all six, adds an org-membership guard to each stats RPC and to `bulk_update_cleaner_payouts`, and binds `get_or_create_conversation` to `auth.uid()`.

### H4 — `send-invite` has no role ceiling ✅
**File:** `src/app/api/admin/send-invite/route.ts`
Invited-role allowlist is `['cleaner','manager','admin']`; a `manager` (with `can_manage_cleaners`) or an `admin` can invite someone as `admin`, granting a peer/superior who can then revoke them. No comparison of caller role to invited role.
**Fix:** Enforce a ceiling: managers may invite `cleaner` only; admins may invite up to `admin` but not `owner`; `owner` remains non-invitable.

### H5 — Public storage buckets (avatars, job-photos, property-photos, message-attachments) 🔭
All four buckets are `public: true` on prod. Object paths are UUID-based (`{appointmentId}/{uuid}.jpg`), so enumeration requires guessing two UUIDs (not practically feasible), but any leaked/shared/logged URL is permanently world-readable with no access control, including job before/after photos of private residences and message attachments.
**Status:** Deferred. The correct fix (flip buckets private + serve via short-TTL signed URLs) is an architectural change touching every image render path; doing it halfway would break production image loading. Tracked in `todo/storage-signed-urls.md` with the migration + UI plan. Lower realistic severity than the enumerable-ID case because paths are UUIDs.

---

## MEDIUM

### M1 — `getOrCreateStripeCustomer` aliases customers by email ✅
**File:** `src/lib/stripe.ts`
When no stored customer id, it does `customers.list({email})` and reuses the first match, with customer metadata carrying neither `organization_id` nor `user_id`. Two orgs sharing a homeowner email (or a reused email) can collide onto one Stripe Customer, exposing one org's saved cards/history to another. The self-pay sibling already avoids this.
**Fix:** Removed the email-lookup fallback; always create a fresh customer stamped with `user_id` (mirrors `getOrCreateOrgSelfPayCustomer`).

### M2 — Webhook does not assert `event.livemode` 🔭→✅
**File:** `src/app/api/stripe/webhook/route.ts`
Signature is verified against `[STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_WEBHOOK_SECRET]`, but `event.livemode` is never checked. A test-mode secret leaking into a prod env (or a prod secret into preview) would let test events drive real settlement.
**Fix:** Reject events whose `livemode` doesn't match the runtime (`livemode` required in production; test-only otherwise).

### M3 — `user_metadata.role` trusted in client AuthContext fallback ✅
**File:** `src/contexts/AuthContext.tsx`
`getRoleFromAuth` falls back to `user_metadata.role` (user-settable via `supabase.auth.updateUser`) when `app_metadata.role` is absent. No **server** route trusts `user_metadata` (verified by grep), so this is client-side only (spoofs which dashboard renders, not data access), but it's a latent escalation surface.
**Fix:** Drop the `user_metadata.role` fallback; default to `homeowner` when `app_metadata.role` is unavailable.

### M4 — Cron secret check structurally fragile ✅
**Files:** `src/app/api/cron/reconcile-payments/route.ts`, `src/app/api/appointments/auto-defer/cron/route.ts`
Both currently **fail closed** when `CRON_SECRET` is unset (verified), but the `expected = SECRET ? ... : null; if (!expected || ...)` shape flips to fail-open under a plausible refactor.
**Fix:** Replaced with an explicit early `if (!process.env.CRON_SECRET) return 500` then a direct comparison, robust to future edits.

---

## INFORMATIONAL / BY DESIGN

### I1 — `payments/record` accepts a client-supplied `amount` ℹ️
**File:** `src/app/api/payments/record/route.ts`
Auth is correct (`requireOrgAuth(['owner','admin','manager'])`, org-scoped to the appointment). The arbitrary `amount` is the **intended** behavior of the manual cash/check recording UI (`RecordPaymentModal`, supports partial/offline payments with an optional appointment). Not a vulnerability; left as-is. A sanity upper-bound could be added later but would constrain a legitimate feature.

### I2 — `accept-invite` reads the access token from the body ✅(hardened)
**File:** `src/app/api/accept-invite/route.ts`
The token is still verified via `verifyAccessToken` and the granted role comes from the DB invite row, so this is Low. Body-transported tokens are more likely to land in request logs.
**Fix:** Also accept the standard `Authorization: Bearer` header (body kept for backward compat), aligning with every other route.

---

## Remediation order applied
C1 → C2/C3/C5 (route guards) → C4/H3 (RLS migration 089) → H1/H2/H4 (authz logic) → M1/M2/M3/M4 → I2. H5 deferred to `todo/storage-signed-urls.md`.

## Verification
- **Type-check** (`npx tsc --noEmit`): 11 errors, all pre-existing (in files not touched by this work — `cleaner-dashboard`, `MessageThread`, `useStartConversation`, `supabase-admin`, two test files, and the unrelated `LoginLinkCreateParams` at `stripe.ts:343`). **Zero new type errors.**
- **Migration**: `089` applied cleanly in a full `npx supabase db reset` rebuild, and was first validated transactionally (run + rollback) against the live schema so every column/function reference resolves.
- **Unit suite** (`npm run test:unit`): 368/368 pass.
- **Integration tests** (new + changed, run serially): 41 pass:
  - `payments/cross-tenant-rls` (6) — proves C4: a different org's admin (with `app_metadata.role='admin'`) can no longer read another tenant's `payments` or `cleaner_profiles`; anon can't read `cleaner_profiles`; same-org admin still can.
  - `stripe/get-payment-method` (5), `invoices/create` (5), `recurring-appointments` (7), `auth/signup` (5) — new auth guards (401/403/404/200 + DB read-back).
  - `admin/delete-team-member` (6, +owner-guard case) and `admin/send-invite` (7, +role-ceiling cases) — existing tests still green plus the new behaviors.
- CI will additionally run the integration + E2E suites against the dev preview with migration 089 applied, validating the RLS changes don't break legitimate same-org app flows.
