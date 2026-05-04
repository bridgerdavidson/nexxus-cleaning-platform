# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Next.js dev server (Turbopack) on :3000
npm run build    # Production build
npm run start    # Run the production build
npm run lint     # ESLint (note: Next.js 16 removed `next lint`, this script now runs `eslint .` directly)
npx tsc --noEmit # Type-check (no test runner is configured)
```

There is no test suite. `next.config.ts` deliberately sets `eslint.ignoreDuringBuilds: true` and `typescript.ignoreBuildErrors: true`, so `npm run build` will succeed even with lint or type errors. **Run `npm run lint` and `npx tsc --noEmit` explicitly before considering a change done** — the build will not catch regressions.

Supabase CLI is in devDependencies (`npx supabase ...`). Local Supabase config is in `supabase/config.toml` (default ports: API 54321, DB 54322, Studio 54323, Inbucket 54324). Schema lives in `supabase/schema.sql`; incremental changes are numbered files under `supabase/migrations/` (currently up to `046_*`).

Path alias: `@/*` → `./src/*`.

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
