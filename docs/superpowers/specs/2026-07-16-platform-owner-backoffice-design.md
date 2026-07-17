# Platform-owner `/owner` back-office redesign

Date: 2026-07-16
Branch: `feat/platform-owner-backoffice`
Status: spec for review

## 1. Goal & context

The platform-owner back-office (`/owner`, Nexxus-internal staff tooling) is the **last redesign surface** before cutover. It was never redesigned: it lives outside the `(redesign)` route group at `src/app/owner/page.tsx`, is built from hand-rolled Tailwind on the legacy `secondary-*`/`primary-*` palette, and uses raw `<table>`/`<div>` modals instead of the `ui/*` primitives.

This project rebuilds it in the redesign design system, adds two enhancements the owner asked for (an audit-log view and platform-level metrics), and closes two functional gaps (post-login routing and a redesign-styled impersonation banner).

**The entire Stripe/Supabase backend is reused unchanged.** All existing `/api/platform/*` routes and the `usePlatformOrganizations` hooks stay as-is. The only backend additions are two **read-only** endpoints (stats, audit) and one additive `security definer` RPC.

## 2. Scope

**In scope**
- A new `PlatformShell` (own lightweight redesign shell) with two destinations: **Tenants** and **Audit log**.
- **Overview / Tenants** page: 8 KPI `StatTile`s + a filterable tenant roster table.
- **Tenant detail**: a **wide right-side sheet** (`?tenant=<id>`) with identity + impersonation, Billing, Payments/Connect (+ reset), Members table (+ per-cleaner reset), per-tenant Recent activity, and a Danger zone (delete org).
- **Provision tenant** dialog.
- **Audit log** page: filterable, paginated table over `platform_audit_log`, plus per-tenant recent activity inside the sheet.
- **Metrics**: today's 4 count KPIs (Tenants, Active plans, On trial, Payments-ready) **plus** Platform fees collected, GMV, Total appointments, New tenants (30d).
- **Gap 1 (routing)**: make the existing platform-admin login redirect redesign-aware (`/app/owner`).
- **Gap 2 (impersonation)**: a redesign-styled `ImpersonationBanner` rendered inside the redesign shells; "View as this company" routes into the redesign operator dashboard when the redesign flag is on.
- Destructive-action parity, rebuilt on `ui/*`: delete-org (type-name + countdown), tenant Connect reset, cleaner Connect reset (409 force-acknowledge).

**Non-goals**
- No change to any existing `/api/platform/*` write route, to `requirePlatformAdmin`, to the `platform_admins`/`platform_audit_log` schema, or to impersonation's audit-first semantics / RLS (migration 069).
- The **legacy `/owner` page stays live and untouched** until cutover (same pattern as every other redesign surface).
- No write actions in the audit view; no impersonation *write* access (read-only impersonation is unchanged).
- Not fixing the non-login `getDashboardPath` call sites for platform admins (not-found, reset-password, accept-invite) beyond a noted follow-up; platform admins do not hit those flows in practice.

## 3. Routing, flags, and shipping alongside legacy

- New surface lives under the `(redesign)` route group: `src/app/(redesign)/app/owner/page.tsx` (Tenants) and `.../owner/audit/page.tsx` (Audit log), URLs `/app/owner` and `/app/owner/audit`.
- Gated exactly like the rest of the group: the `(redesign)/layout.tsx` gate (`NODE_ENV !== 'production' || VERCEL_ENV === 'preview' || redesignUiEnabled()`), plus each page verifies `isPlatformAdmin === true` (spinner while `null`, redirect to `/login` if no user, redirect to `/` if `false`) — mirroring the legacy `owner/page.tsx` three-way guard.
- **Legacy `/owner` is left in place.** No deletion until cutover.
- **Gap 1**: `src/app/login/page.tsx:23-32` already redirects platform admins to `/owner`. Change that target to be redesign-aware: `isPlatformAdmin ? (redesignUiEnabled() ? '/app/owner' : '/owner') : getDashboardPath(...)`. `getDashboardPath` is unchanged (platform-admin is not a `UserRole`; it is handled separately in the redirect, as today).

## 4. Architecture & file inventory

Everything new is a focused unit with one purpose. New UI lives under `src/components/redesign/platform/`.

**Shell**
- `PlatformShell.tsx` — full-height rail + slim top bar + mobile nav + `<main>`, mounts the `TenantDetailHost` (Suspense-wrapped) and the redesign `ImpersonationBanner`. Built from the same structure as `OperatorShell`; the desktop rail reuses the generic `OperatorRail` (it takes `{ activeId, nav }`); the top bar and mobile nav are small platform-specific components (the operator ones are coupled to booking/notification/settings concerns).
- `platform-nav.ts` — `PLATFORM_NAV: NavItem[]` = Tenants (`/app/owner`), Audit log (`/app/owner/audit`). No `requires` (platform-admin gate is at the page level). Sign out is a rail affordance, spatially separated at the bottom.

**Pages**
- `(redesign)/app/owner/page.tsx` — guard + `<Suspense>` + `<PlatformShell active="tenants"><PlatformOverview/></PlatformShell>`.
- `(redesign)/app/owner/audit/page.tsx` — guard + `<PlatformShell active="audit"><PlatformAuditLog/></PlatformShell>`.

**Overview**
- `PlatformOverview.tsx` — header (title + Provision button) + KPI row + `TenantRoster`.
- `PlatformStatCards.tsx` — 8 `StatTile`s from `usePlatformStats()` (skeletons while loading).
- `TenantRoster.tsx` — `ListFilterBar` (search + subscription/payments filter) → dense `Table` (desktop) / card list (mobile); rows open `?tenant=<id>`.

**Tenant sheet**
- `TenantDetailHost.tsx` — mounted in `PlatformShell`; reads `?tenant=` via `useDetailParam('tenant')`, fetches with `usePlatformOrganization(id)`, keeps `lastId` for exit animation, renders `TenantDetailSheet`.
- `TenantDetailSheet.tsx` — `SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-2xl"`; identity header, Billing + Payments/Connect cards, Members table, `TenantRecentActivity`, Danger zone.
- `useOpenTenant.ts` — `{ open, close }` opener (mirrors `useOpenProperty`, reads `window.location.search` in handlers, no Suspense needed).
- `TenantRecentActivity.tsx` — this org's last 10 audit entries via `usePlatformAudit({ orgId })`.

**Dialogs (rebuilt on `ui/*`, behavior preserved)**
- `ProvisionTenantDialog.tsx` — `ui/dialog` form (name, owner email, optional billing email), inline email validation on blur, submit feedback; uses existing `useProvisionTenant()`.
- `TenantConnectResetDialog.tsx` — `ConfirmDialog` (destructive) → result summary; posts to the existing tenant Connect reset route.
- `CleanerConnectResetDialog.tsx` — custom `ui/dialog` with the three body states (confirm → 409 `in_flight_payouts` force-acknowledge checkbox → success); existing cleaner reset route.
- `DeleteTenantDialog.tsx` — custom `ui/dialog` preserving the two-step **type-the-exact-name + 3-second countdown**; existing DELETE route.

**Badges**
- `pills.tsx` — `SubscriptionPill` and `PaymentsPill` built on `Badge` (icon + text, never color-alone), mapping: subscription `active→positive`, `trialing→caution`, `past_due→critical`, `canceled/none→secondary`; payments `Ready→positive`, `Onboarding→caution`, `Not connected→secondary`. Replaces the legacy `statusBadges.tsx` hand-rolled pills for the redesign.

**Audit**
- `PlatformAuditLog.tsx` — dense `Table` (timestamp tabular, actor, action `Badge`, target org → opens that tenant's sheet, details), an action-type filter, load-more pagination, empty/error/loading states.

**Impersonation**
- `RedesignImpersonationBanner.tsx` — theme-aware, design-system-styled sticky banner; reads impersonation state from `useAuth`, aria-live, clear Exit. Rendered inside `OperatorShell` and `PlatformShell`. The legacy global banner in `LayoutWrapper` is suppressed on `/app/*` routes so it never double-renders. "View as this company" (in `TenantDetailSheet`) pushes to `/app/admin-dashboard` when `redesignUiEnabled()`, else `/admin-dashboard`.

**Hooks / keys**
- `usePlatformStats.ts` → `GET /api/platform/stats`; `usePlatformAudit.ts` → `GET /api/platform/audit` (supports `?org_id=` + pagination). Extend `keys.platform` with `stats` and `audit(...)`.

**Backend (read-only additions)**
- `src/app/api/platform/stats/route.ts` — GET, `requirePlatformAdmin`, calls the `platform_stats()` RPC via `supabaseAdmin.rpc`.
- `src/app/api/platform/audit/route.ts` — GET, `requirePlatformAdmin`, selects from `platform_audit_log` (newest first, `limit`/`offset` or cursor), resolves actor + org names (same name-lookup approach as the existing detail route), optional `org_id` filter.
- `supabase/migrations/<next>_platform_stats_rpc.sql` — additive `platform_stats()` `security definer set search_path='public'` returning a single `jsonb` (see §6). EXECUTE is revoked from `public`/`anon`/`authenticated` and granted to `service_role` only; the route enforces `requirePlatformAdmin` and invokes it via `supabaseAdmin.rpc` (service-role, matching the existing platform routes). Mirrors the `094_analytics_rpcs` shape.

**Edits**
- `src/app/login/page.tsx` — redesign-aware platform redirect.
- `src/components/redesign/shell/OperatorShell.tsx` — mount `RedesignImpersonationBanner`.
- `src/components/LayoutWrapper.tsx` — suppress the legacy `ImpersonationBanner` on `/app/*` routes.
- `src/lib/queryKeys.ts` — `keys.platform.stats`, `keys.platform.audit`.

## 5. Screen specs

### 5.1 PlatformShell
Brand rail (`w-16` collapsed, hover-expands like `OperatorRail`) with Tenants + Audit log (icon + label, active highlight `bg-brand-600 text-white`); Sign out separated at the bottom. Slim top bar: "Platform Owner" title + profile/sign-out. Mobile: bottom tab bar (2 items) matching the redesign mobile nav idiom. Gated on `isPlatformAdmin === true`.

### 5.2 Overview / Tenants
- **KPI row** (8 `StatTile`s, responsive 2-col mobile → 4-col desktop): Tenants, Active plans, On trial, Payments-ready (counts, client-derivable or from stats), Platform fees collected (money), GMV (money), Total appointments (count), New tenants 30d (count). Tabular figures; locale money formatting; skeletons while `usePlatformStats` loads; `ErrorState` on failure.
- **Roster**: `ListFilterBar` with a search `Input` (name/billing email) and a subscription/payments `Select` filter → dense `Table` (Organization [name + billing email], Subscription [`SubscriptionPill`], Payments [`PaymentsPill`], Members [tabular count], Created [date], chevron). Sortable headers with `aria-sort`. Rows are keyboard-activatable and open `?tenant=<id>`. Empty/error/loading states from `ui/*`.

### 5.3 Tenant sheet (`?tenant=<id>`, wide)
Top-to-bottom:
1. **Identity header**: org name + `SubscriptionPill` + `PaymentsPill`; **View as this company** (audit-first `startImpersonation`, error surfaced inline, then route into operator dashboard); close.
2. **Billing** card: status, renews (`subscription_current_period_end`), billing email, platform fee (`platform_fee_bps/100`%).
3. **Payments / Connect** card: charges, payouts, details submitted, payout model; requirements-due caution when `stripe_connect_requirements_due.length > 0`; **Reset Connect** action (`TenantConnectResetDialog`).
4. **Members** table: name, email, role; per-cleaner **Reset Connect** icon-action (aria-labelled) for `role === 'cleaner'` rows.
5. **Recent activity**: this org's last 10 `platform_audit_log` entries (action + actor + time).
6. **Danger zone**: visually + spatially separated, danger-colored; **Delete organization** (`DeleteTenantDialog`). On success: toast, invalidate `keys.platform.organizations.all`, close the sheet.

### 5.4 Audit log page
Dense table over `platform_audit_log`, newest first: timestamp (tabular), actor (resolved name/email), action (`Badge`), target org (link → opens that tenant's sheet; may be null for deleted orgs, shown as a muted label), details (from `metadata`, compact). Action-type filter. Load-more pagination (audit grows unbounded). Empty/error/loading states.

### 5.5 Provision tenant
`ui/dialog` modal: visible-labelled inputs for name (required), owner email (required, validated on blur), billing email (optional). Submit disabled + spinner while pending; aria-live errors; focus first invalid field on error. Success: toast + close + list invalidation. Uses existing `useProvisionTenant()`.

### 5.6 Destructive actions
- **Delete org**: two stages preserved — (1) type the exact org name to enable Continue, (2) 3-second countdown disables "Delete forever (n)"; shows member/appointment counts + the Stripe-deactivation note; on error returns to stage 2 with countdown 0 for immediate retry.
- **Tenant Connect reset**: single destructive confirm listing effects → result summary (`stripe_delete_status`, etc.).
- **Cleaner Connect reset**: confirm → on 409 `in_flight_payouts` show payout count + require an "I understand" checkbox → re-post with `force:true` → success (with orphaned-payout count).

All destructive buttons use the danger/`critical` semantics, are `loading`-disabled during async, and are spatially separated from primary actions.

### 5.7 Impersonation
Redesign `ImpersonationBanner` (design-system tokens, theme-aware, aria-live, Exit) mounted in the redesign shells; legacy banner suppressed on `/app/*`. Exit clears local state first (best-effort audit end), then routes to `/app/owner` (redesign) / `/owner` (legacy). "View as" routes into `/app/admin-dashboard` when redesign is on.

## 6. Data layer (exact)

**`platform_stats()` RPC → jsonb** (all money returned as integer cents to avoid float drift; the UI formats):
- `tenants` = `count(organizations)`
- `active_plans` = `count(*) where subscription_status='active'`
- `trialing` = `count(*) where subscription_status='trialing'`
- `payments_ready` = `count(*) where stripe_connect_charges_enabled and stripe_connect_payouts_enabled`
- `platform_fees_cents` = `sum(application_fees.amount) - sum(application_fees.refunded_amount)`
- `gmv_cents` = `round(sum(payments.amount) * 100)` where `status='paid' and payment_type='revenue'`
- `total_appointments` = `count(appointments)`
- `new_tenants_30d` = `count(organizations) where created_at > now() - interval '30 days'`

`security definer set search_path='public'`; EXECUTE revoked from `public`/`anon`/`authenticated`, granted to `service_role` only. Authorization is enforced at the route (`requirePlatformAdmin`), which then calls `supabaseAdmin.rpc('platform_stats')` (service-role). The function does not depend on `auth.uid()` (the service-role caller has no user context); the execute-grant restriction is the defense-in-depth backstop against a direct call.

**`GET /api/platform/audit`** → `{ entries: AuditEntry[], nextOffset: number | null }`.
`AuditEntry = { id, action, actor_name, actor_email, target_org_id, target_org_name, metadata, started_at, ended_at }`. Query params: `limit` (default 50), `offset` (or cursor), optional `org_id`. Newest first by `started_at`. Actor/org names resolved via `user_profiles`/`organizations` lookups keyed by the ids in the page (no per-row N+1).

**Types** (`src/types/platform.ts` additions): `PlatformStats`, `PlatformAuditEntry`. **Query keys**: `keys.platform.stats`, `keys.platform.audit(params)`.

Schema facts this relies on (verified): `application_fees.amount`/`refunded_amount` are `bigint` **cents**; `payments.amount` is `numeric(10,2)` **dollars**, succeeded == `status='paid'`, `payment_type='revenue'`; `organizations.created_at`, `.platform_fee_bps`, `.subscription_status`, `.stripe_connect_*` all present; `platform_audit_log(id, actor_user_id, action, target_org_id, metadata jsonb, started_at, ended_at)`.

## 7. UI implementation & styling source (contract for the implementer)

**The browser-companion mockups produced for this feature are UX/structure reference ONLY.** Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the redesign components in `src/components/redesign/*`, with tokens from `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft "pillowy" shadows, the rounded scale, the `Badge`/pill vocabulary). **Do not** copy ad-hoc colors, raw hex, one-off borders/accents, or bespoke classes from a mockup or from the legacy `src/components/platform/*` code. Status/urgency is expressed through the `Badge`/pill vocabulary, not decorative bars. If a needed pattern has no primitive yet, build it as a reusable primitive that matches the system (e.g. `SubscriptionPill`/`PaymentsPill` on `Badge`, the `sm:max-w-2xl` wide-sheet width), never an inline one-off. No em dashes in any user-facing copy (labels, buttons, toasts, errors). `ui-ux-pro-max` is run again at implementation time to catch raw-hex/off-system leaks.

## 8. Accessibility & UX rules applied (from ui-ux-pro-max design pass)
Tabular figures for all numeric columns/KPIs; `aria-sort` on sortable roster headers; icon-only actions (reset, close) carry `aria-label`; status conveyed by icon + text, never color alone; visible form labels (not placeholder-only) + validate-on-blur + focus-first-invalid + aria-live errors; confirmation dialogs for every destructive action with danger semantics and spatial separation; skeletons for loads > ~300ms and reserved space to avoid layout shift; load-more for the unbounded audit list; deep-linkable `?tenant=` with preserved roster scroll/filter on close; theme-aware (light/dark) for every new surface incl. the banner; keyboard-activatable rows and predictable focus.

## 9. Testing plan
- **Integration** (co-located `*.integration.test.ts`, real local Supabase, existing helpers): `stats` route (auth: 401/403 for non-admin, correct aggregates for a seeded org set incl. refunded fees + non-paid payments excluded from GMV) and `audit` route (auth, ordering, pagination, `org_id` filter, name resolution, null target org).
- **Unit** (`*.test.ts`): pure helpers — money-cents formatting, audit action → label/`Badge`-variant mapping, subscription/payments → pill-variant mapping.
- **Migration**: `npx supabase db reset` rebuilds cleanly; the RPC returns expected shape.
- **Browser**: screenshots of all new surfaces (overview + KPIs, roster filters, tenant sheet incl. resets/delete dialogs, provision, audit page, impersonation banner) in light + dark before the PR.
- Local full-suite instability (shared Supabase) is known; CI is the authority (see the `local-test-suite-instability` note).

## 10. Execution approach
**Hybrid, mostly inline** (Bridger's confirmed choice for this task): build the cohesive bulk inline in one context (shell, pages, roster, sheet + host, dialogs, pills, banner, hooks, routes, migration, routing/impersonation edits), then a **single final adversarial review** over the whole diff focused on the auth/routing edits, the money-aggregation correctness (stats RPC), and destructive-action parity, then the standard gates + browser screenshots. A lightweight checklist plan follows this spec (not a per-task SDD plan). Commit trailer per this session's model; never merge without Bridger's explicit go-ahead.

## 11. Risks / open items
- **Impersonation banner de-dup**: need to confirm design tokens render correctly for the banner and pick the exact suppression point for the legacy banner on `/app/*` (LayoutWrapper path check). Finalized in the plan after a quick token-scope check; behavior is fixed (redesign banner in-shell, legacy suppressed on `/app/*`).
- **Stats RPC + migration** adds cutover surface (a new migration through migrate-dev/prod). It is additive and platform-admin-gated, so low risk, but it is the one schema change here.
- **GMV/fees semantics**: GMV = succeeded revenue payments only; platform fees = net of refunds. Confirmed against schema; validated by the integration test's seeded set.
- **Concurrent sessions**: a `fix/ui-minor-fixes` session is active. Shared-file touch points are `login/page.tsx`, `OperatorShell.tsx`, `LayoutWrapper.tsx`, `queryKeys.ts`. Rebase + check for overlap before PR.
