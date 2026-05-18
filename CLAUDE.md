# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev               # Next.js dev server (Turbopack) on :3000
npm run build             # Production build
npm run start             # Run the production build
npm run lint              # ESLint (note: Next.js 16 removed `next lint`, this script now runs `eslint .` directly)
npx tsc --noEmit          # Type-check
npm run test              # Unit + integration tests (Vitest)
npm run test:unit         # Unit only (no infra)
npm run test:integration  # Integration only (needs `npx supabase start` running locally)
npm run test:e2e          # Playwright (against `npm run dev` locally, or PLAYWRIGHT_BASE_URL in CI)
```

`next.config.ts` deliberately sets `eslint.ignoreDuringBuilds: true` and `typescript.ignoreBuildErrors: true`, so `npm run build` succeeds even with lint or type errors. CI (`.github/workflows/ci.yml`) runs `npx tsc --noEmit`, `npm run lint`, and `npm run test` on every push — **don't rely on `npm run build` alone**.

Supabase CLI is in devDependencies (`npx supabase ...`). Local Supabase config is in `supabase/config.toml` (default ports: API 54321, DB 54322, Studio 54323, Inbucket 54324). Migrations live under `supabase/migrations/` — see `supabase/BASELINE.md` for the one-time baseline-dump procedure that has to run before `supabase start` produces a complete schema.

## Running tests

- **Unit tests** (`npm run test:unit`) — pure logic and helpers under `src/lib/**`. No infra. Co-located as `*.test.ts` next to the source.
- **Integration tests** (`npm run test:integration`) — route handlers under `src/app/api/**`. They call `import { POST } from '.../route'` directly (no HTTP server) and run against a real local Supabase. Co-located as `*.integration.test.ts` next to the route. **Requires `npx supabase start` first** plus `.env.test.local` with the values from `npx supabase status --output json`.
- **E2E** (`npm run test:e2e`) — Playwright specs under `tests/e2e/`. Locally: have `npm run dev` running. In CI: triggered by Vercel `deployment_status` against the preview URL.
- **Helpers**: `tests/helpers/{supabase,auth,db,fixtures,stripe}.ts` provide `createTestSupabaseClient()`, `callRoute()`, `withTestOrg()`, and an in-memory Stripe fake. New integration tests should use these — don't roll your own org/user setup.

Path alias: `@/*` → `./src/*`.

## Development workflow

This project uses a feature-branch + PR-to-master flow with automated checks in GitHub Actions. **Branch protection on `master` rejects direct pushes** — every change goes through a feature branch and a PR. Skipping any step here breaks the safety net.

### Branches

- **`master`** — production. Deploys to the prod domain on merge. Protected: no direct pushes, PR required, status checks must pass.
- **`dev`** — persistent staging branch. Stable Vercel preview URL (`nexxus-cleaning-platform-git-dev-cleaning-solutions.vercel.app`) that the **test-mode Stripe webhook** points at. Fast-forward to master periodically so the preview reflects current code. Do not delete this branch — the Stripe webhook URL depends on it existing.
- **`feat/*` / `fix/*` / `chore/*`** — short-lived branches off `master`. One per task. Deleted after merge.

### The cycle for any change

1. **Start from current master**:
   ```powershell
   git checkout master; git pull origin master
   git checkout -b feat/<name>
   ```

2. **Run the local environment**. Three terminals:
   ```powershell
   npm run dev                                                    # T1: Next.js
   npx supabase start                                             # T2: local DB (needs Docker Desktop running)
   stripe listen --forward-to localhost:3000/api/stripe/webhook   # T3: only when working on payment flows
   ```
   The Stripe CLI prints a `whsec_...` value when started — paste into `.env.local` as `STRIPE_WEBHOOK_SECRET`.

3. **Write code + tests.** New API routes need a `*.integration.test.ts` co-located next to them, using the helpers in `tests/helpers/`. New pure logic in `src/lib/**` needs a `*.test.ts`.

4. **Before pushing, run the same gates CI will run**:
   ```powershell
   npm run test           # all 43 tests (catches code bugs)
   npx tsc --noEmit       # type errors (catches type bugs)
   npm run lint           # ESLint
   ```
   If you added/changed a migration: `npx supabase db reset` first to verify the schema rebuilds cleanly.

5. **Commit and push**:
   ```powershell
   git add <files>
   git commit -m "<imperative subject>"
   git push -u origin feat/<name>
   ```
   This automatically triggers: `CI`, Vercel preview deploy, `E2E` (after preview is Ready), and `Migrate / migrate-dev` (applies any new migrations to the **shared dev Supabase**).

6. **Open a PR to `master`**. Four checks must all be green before the Merge button activates:
   - `CI / typecheck + lint`
   - `CI / unit + integration`
   - `E2E / Playwright (preview) (1/2)`
   - `E2E / Playwright (preview) (2/2)`

7. **Merge.** Vercel deploys to prod, `Migrate / migrate-prod` applies migrations to the prod Supabase.

8. **Clean up locally**:
   ```powershell
   git checkout master; git pull origin master
   git branch -d feat/<name>
   ```

### When a check fails

- **`CI / unit + integration` red** — reproduce locally with `npm run test` (or `npm run test:integration -- <pattern>` for a specific file). Fix, commit, push. CI re-runs automatically on each push to the same branch; the PR updates in place.
- **`E2E / Playwright (preview)` red** — download the `playwright-report-*` artifact from the failed run (Actions tab → bottom of the run page). Unzip, open `index.html` for screenshots/video/trace. Reproduce locally with `$env:PLAYWRIGHT_BASE_URL = "http://localhost:3000"; npm run test:e2e` against `npm run dev`.
- **`Migrate / migrate-dev` red** — usually a schema conflict. Add `IF NOT EXISTS` / `IF EXISTS` clauses, or fix the conflicting state. Test with `npx supabase db reset` locally before re-pushing.
- **`Migrate / migrate-prod` red after merge** — the merge already happened, but prod schema is unchanged until the migration succeeds. Fix the migration in a new PR. If the remote prod has orphaned migration entries from manual edits, run `npx supabase migration repair --status reverted <versions>` (versions are in the error message).

### CI gating caveat

`npx tsc --noEmit` and `npm run lint` are marked `continue-on-error: true` in `.github/workflows/ci.yml` because the codebase has accumulated pre-existing type errors. Failures still surface in the Actions log but do not block merge. **Flip these off** once the pre-existing errors are cleaned up so real type drift fails CI.

### Stripe webhook coverage by environment

- **Local**: `stripe listen` (T3 above) forwards test-mode events to `localhost:3000`. Required only while iterating on payment flows. The CLI's `whsec_...` is short-lived per session.
- **Preview (dev branch only)**: a test-mode webhook in Stripe Dashboard points at `dev`'s stable URL with `?x-vercel-protection-bypass=...` to get past Vercel SSO.
- **Other feature-branch previews**: not covered — Stripe events from preview deploys of feature branches fall on the floor unless you merge that branch to `dev` first.
- **Production**: live-mode webhook configured in Stripe. **Missing 3 events today** (`transfer.reversed`, `payout.paid`, `payout.failed`) — add when ready so prod payouts auto-mark `bank_paid`.

### Things to never do

- Commit directly to `master`. Branch protection rejects it; the workaround (admin bypass) defeats the safety net.
- Push migrations directly to prod with `supabase db push --linked`. The pipeline does it on merge to master. Exception: recovering from a stuck `migrate-prod` job after fixing the underlying issue.
- Import `lib/supabase-admin.ts` from client code. Service-role key — server only.
- Instantiate `new Stripe()` directly. Use `getStripe()` from `lib/stripe.ts`; it respects the `STRIPE_ENABLED` flag.
- Commit `.env*.local` files (gitignored already) or `.claude/settings.local.json` (per-machine).
- Move/rename files in `supabase/migrations/` after they've shipped. Migrations are immutable once applied to dev or prod; create a new migration to undo or modify schema instead.

### Pre-push checklist

- [ ] `npm run test` passes locally
- [ ] `npx tsc --noEmit` shows no errors **you introduced** (pre-existing ones still appear until cleanup)
- [ ] If you touched a production API route, you wrote or updated its `*.integration.test.ts`
- [ ] If you added a migration, `npx supabase db reset` rebuilds the schema cleanly + integration tests still pass
- [ ] No `.env*.local` or `.claude/settings.local.json` in `git status`

## Architecture

Next.js 16 App Router + React 19 + TypeScript + Tailwind v3, backed by Supabase (Auth, Postgres, Storage, Realtime) and Stripe (Payments + Connect Express for cleaner payouts).

### Roles and multi-tenancy

Two role concepts coexist and both must be considered when changing auth-sensitive code:

- **`UserRole`** on `user_profiles.role`: `homeowner | cleaner | manager | admin`. Drives which dashboard a user is sent to (`/{role}-dashboard`).
- **`OrgRole`** on `organization_members.role`: `owner | admin | manager | cleaner | homeowner`. Drives in-org permissions.

Most domain tables (`appointments`, `payments`, `properties`, `service_types`, `cleaner_profiles`, etc.) carry an `organization_id`. Queries should generally scope by it. `AuthContext` loads the user's first `organization_members` row and exposes `currentOrganizationId` and `currentOrgRole` — use these instead of refetching membership.

### Auth flow (`src/contexts/AuthContext.tsx` + `src/hooks/useAuth.ts`)

`LayoutWrapper` wraps every page in `AuthProvider` + `ToastProvider`. The provider is intentionally complex because of recurring Supabase auth-state edge cases — keep these invariants when editing it:

- Profile loads have an `AbortController` + 5s timeout, with one retry on 406. On any failure it falls back to a profile built from `auth.user.app_metadata`/`user_metadata` so the app stays usable.
- `isSigningOutRef` / `isSigningInRef` / `isCleaningUp` gate state updates to avoid race conditions during rapid sign-out → sign-in cycles. Don't bypass them.
- A `visibilitychange` listener re-validates the session when a tab becomes visible (rate-limited to once per 2s), but is suppressed on `/login` and `/signup` paths.
- Client uses `lib/supabase.ts` (anon key, persisted session). Server-only code uses the singleton `lib/supabase-admin.ts` (service role) — never import `supabase-admin` from client code.

`middleware.ts` is currently a no-op pass-through; route protection is enforced client-side in dashboards/pages, not in middleware.

### API routes (`src/app/api/**/route.ts`)

A large number of routes under `src/app/api/` and corresponding pages (e.g. `cleanup-and-recreate-users`, `fix-database-trigger`, `disable-rls-temporarily`, `migrate-db`, `create-users-final`, `final-fix`, `sync-existing-users`, …) are **legacy one-off admin/repair tooling** from earlier user/auth migrations. Treat them as throwaway unless explicitly asked to touch them. Production paths to know:

- `api/auth/signup`, `api/accept-invite`, `api/admin/send-invite`, `api/admin/delete-team-member`, `api/admin/delete-cleaner`, `api/admin/update-manager-permissions`
- `api/appointments/confirm`, `api/recurring-appointments`
- `api/payments/record`, `api/payouts/approve`, `api/invoices/create`
- `api/stripe/{create-setup-intent,confirm-setup-intent,create-payment-intent,get-payment-method,webhook}`
- `api/stripe/connect/{account-status,balance-summary,create-account,login-link,onboarding-link,reconcile-payouts}`
- `api/jobs/[appointmentId]/photos`, `api/properties/[propertyId]/upload-photo`, `api/user/upload-avatar`

### Stripe (`src/lib/stripe.ts` + `src/lib/stripe/flags.ts`)

- All server Stripe access goes through `getStripe()`, which lazily instantiates the SDK and **throws if `STRIPE_ENABLED !== "true"`**. Don't `new Stripe()` directly — the flag exists so the app can run without Stripe configured.
- Mirror flag on the client: `stripeUiEnabled()` reads `NEXT_PUBLIC_STRIPE_ENABLED`. Hide payment UI behind it.
- Connect (Express) is used for cleaner payouts. `createConnectTransfer` uses an idempotency key of `payout-${appointmentId}` so webhook retries never double-pay — preserve this when adding new transfer call sites.
- Webhook handler (`api/stripe/webhook/route.ts`) requires `STRIPE_WEBHOOK_SECRET` and constructs its own admin Supabase client (it's `runtime = 'nodejs'` because it needs the raw request body).

### Domain types (`src/types/index.ts`)

This file is the source of truth for TypeScript shapes that mirror the database. Read its bottom-of-file "IMPORTANT REMINDERS" before writing any Supabase query — there are non-obvious column-name traps:

- `appointments`/`service_types` use `duration_minutes`, **not** `estimated_duration`.
- `appointments` uses `special_requests`, **not** `special_instructions` (that column is on `properties`).
- `cleaner_profiles.id` **is** the user's `auth.users.id` — there is no separate `user_id` column. The same FK pattern is referenced throughout (`cleaner_id` always points at `cleaner_profiles.id`, which equals the user id).
- Database columns are snake_case; the legacy `User`/`AuthContextType` interfaces near the bottom of the file are camelCase shims still used by the auth layer.

There is a separate, partial `Database` type in `src/lib/supabase.ts` that does **not** include all tables/columns from `src/types/index.ts` (notably missing `job_progress`, `payout_*`, `cleaner_profiles.stripe_connect_*`, `properties.name`, etc.). Prefer importing entity types from `src/types` for app code; the `Database` generic is only used incidentally.

### Data fetching: TanStack Query

The app's data layer is **TanStack Query v5** (added in the unification refactor — see `docs/perf-after.md`). Hooks under `src/hooks/` follow these conventions:

- **`useOrgQuery`** (in `src/lib/useOrgQuery.ts`) — wraps `useQuery` and pulls `currentOrganizationId`, `accessToken`, and `userId` from `useAuth()` into the `queryFn` context. Use it for any org-scoped query. Falls back to `useQuery` directly when the query is not org-scoped (e.g. `useService` by id).
- **Query keys** — defined as a typed factory in `src/lib/queryKeys.ts`. Use `keys.appointments.byOrg(orgId)` not raw arrays — the hierarchy enables prefix invalidation (`invalidateQueries({ queryKey: keys.appointments.all })` cascades).
- **`QueryClient` defaults** (in `src/lib/queryClient.ts`): `staleTime: 30s`, `gcTime: 5min`, `refetchOnWindowFocus: false` (AuthContext already does visibilitychange revalidation), `refetchOnReconnect: 'always'`. RLS errors (`PGRST*`, `42*`) skip retry; other errors retry once.
- **Mutations** — use `useMutation` with explicit `onSuccess` invalidations of the relevant keys. See `useSendMessage`, `useDeleteConversation`, `useStartConversation`, `useResendInvite` for the pattern.
- **Auth rotation** — `<AuthQueryBridge>` (mounted inside `LayoutWrapper`) calls `queryClient.invalidateQueries()` whenever `accessToken` changes, so a long-`staleTime` query never carries an old token.

### Realtime: `useSupabaseRealtimeSync`

One helper at `src/lib/useSupabaseRealtimeSync.ts` handles every Supabase `postgres_changes` subscription. The three previous standalone hooks (`useRealtimeAppointments`, `useRealtimePayments`, `useRealtimeServices`) are deleted; the helper supports three behaviors:

- `{ type: 'invalidate', keys: [...] }` — full refetch. Use when the realtime payload doesn't carry the data the UI needs (e.g. joined rows).
- `{ type: 'patch', key, updater }` — `setQueryData` patch. Use when the realtime payload carries the full row (`useServices`) or a small targeted field (`useAdminAppointments` payment-status).
- `{ type: 'append', key, transform }` — append to a list. Used by `useMessages` for new INSERTs (with temp-ID dedup for optimistic sender flows).

Channel deduplication: identical `channelName` values share one Supabase subscription. Admin and manager appointments hooks use `appointments:${orgId}` so they share. Use **DB-level filters** (e.g. `filter: 'organization_id=eq.' + orgId`) rather than callback-level filtering — it's cheaper and reduces noise.

Realtime tables must be added to the `supabase_realtime` publication and have `REPLICA IDENTITY FULL` set. See `supabase/migrations/048_invites_realtime.sql` as the template.

### Stats RPCs

`supabase/migrations/049_dashboard_rpcs.sql` defines four `security invoker` RPCs that collapse stats waterfalls into single round trips:

- `admin_dashboard_stats(p_org_id)` — used by `useAdminStats`
- `cleaner_stats(p_cleaner_id, p_org_id)` — used by `useCleanerStats`
- `payment_stats(p_org_id)` — used by `usePaymentStats`
- `org_customers_with_counts(p_org_id)` — used by `useAdminCustomers` (also fixes the previous lossy client-side merge)

Each hook calls the RPC first and falls back to the legacy multi-query path if the RPC errors (so the app keeps working before the migration is applied to a new environment). The fallback should be removed once 049 has shipped to all envs.

### Dashboards

Each role's dashboard page (`src/app/{admin,manager,cleaner,homeowner}-dashboard/page.tsx`) is a thin wrapper that renders large client components from `src/components/` (e.g. `BookingsPage`, `CalendarView`, `PaymentsPage`, `MessagesPage`, `CleanerManagementPage`).

Hooks under `src/hooks/`:
- `useAdminData`, `useManagerData`, `useCleanerData`, `useHomeownerData` — role-specific aggregated queries (split into per-resource hooks like `useAdminAppointments`, `useAdminStats`).
- `useManagerPermissions` — fine-grained per-manager flags layered on top of `OrgRole`.
- `useStripeConnect` — wraps Connect onboarding/status flows.
- `useInvites` — uses the lazy-on-tab-open pattern (`enabled` flag); the rest of the dashboards still load eagerly. Extending lazy-gating to the other tabs is a follow-up perf ticket.

### Environment variables

Required for full functionality:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — client Supabase
- `SUPABASE_SERVICE_ROLE_KEY` — server-only admin client (never expose)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — server Stripe
- `STRIPE_ENABLED`, `NEXT_PUBLIC_STRIPE_ENABLED` — feature flags (string `"true"` to enable)

## Visual Testing
Use the Playwright MCP tools to navigate to the local dev server 
(http://localhost:3000) and take a screenshot to verify UI changes.

### Tailwind theme

Custom palette in `tailwind.config.js`: `primary` is the brand yellow (`#F7C41E` at 500), `secondary` is slate, `success` is green. Plugins: `@tailwindcss/forms`, `@tailwindcss/typography`. Custom keyframes: `fade-in`, `slide-up`, `bounce-gentle`, `toast-in`, `toast-out`.
