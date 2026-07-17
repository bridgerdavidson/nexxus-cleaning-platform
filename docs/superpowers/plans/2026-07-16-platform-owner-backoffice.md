# Platform-owner `/owner` back-office redesign — implementation plan

> **Execution:** INLINE (Bridger's confirmed choice for this task), with a final adversarial review + gates before PR. This is a right-sized checklist for a full-context implementer, not a zero-context subagent handoff, so tasks list files / key signatures / verify steps / commit boundaries rather than pre-writing every line. Spec: `docs/superpowers/specs/2026-07-16-platform-owner-backoffice-design.md`.

**Goal:** Rebuild the platform-owner `/owner` back-office in the redesign design system (platform rail + wide tenant sheet), add an audit-log view + platform metrics, and close the routing + impersonation-banner gaps. Backend reused; adds read-only stats/audit endpoints + one stats RPC.

**Architecture:** New surface under `(redesign)/app/owner/*`, gated by the redesign layout + `isPlatformAdmin`. New UI in `src/components/redesign/platform/*` built only from `src/components/ui/*` + `src/components/redesign/*` + tokens. Legacy `/owner` left untouched until cutover.

**Tech Stack:** Next.js 16 App Router, React 19, TS, Tailwind v3, TanStack Query v5, Supabase (service-role platform routes), Radix (`ui/*`).

## Global Constraints
- Build ONLY from `src/components/ui/*` + `src/components/redesign/*` + tokens (`tailwind.config.js` / `globals.css`). No raw hex, no bespoke classes, no copying legacy `src/components/platform/*` or mockup styling. New patterns become reusable primitives (`SubscriptionPill`/`PaymentsPill` on `Badge`; `sm:max-w-2xl` wide sheet).
- No em dashes in user-facing copy (labels, buttons, toasts, errors).
- Status/urgency via `Badge`/pill vocabulary + icon + text; never color-alone.
- Every new surface theme-aware (light + dark). Tabular figures for numeric columns/KPIs. `aria-label` on icon-only actions. `aria-sort` on sortable headers.
- New API routes are read-only, guarded by `requirePlatformAdmin`, and get a co-located `*.integration.test.ts` using `tests/helpers/*`.
- Never `new Stripe()` (use `getStripe()`); never import `supabase-admin` from client code.
- Commit trailer per this session's model; never merge without Bridger's go-ahead.

---

### Task 1: Stats RPC + migration + route + hook (backend, KPIs)
**Files:**
- Create: `supabase/migrations/<next>_platform_stats_rpc.sql` — `platform_stats()` `returns jsonb language sql/plpgsql stable security definer set search_path='public'`; `revoke execute ... from public, anon, authenticated; grant execute ... to service_role;`. Body computes the 8 metrics (spec §6): counts over `organizations`; `platform_fees_cents = coalesce(sum(amount)-sum(refunded_amount),0)` over `application_fees`; `gmv_cents = coalesce(round(sum(amount)*100),0)` over `payments where status='paid' and payment_type='revenue'`; `total_appointments = count(appointments)`; `new_tenants_30d`.
- Create: `src/app/api/platform/stats/route.ts` — `GET`, `requirePlatformAdmin(request, supabaseAdmin)`, then `supabaseAdmin.rpc('platform_stats')`, returns the jsonb (or 500 on rpc error).
- Create: `src/app/api/platform/stats/route.integration.test.ts`.
- Modify: `src/types/platform.ts` (+`PlatformStats`), `src/lib/queryKeys.ts` (+`platform.stats`), create `src/hooks/usePlatformStats.ts`.

**Produces:** `PlatformStats` type; `usePlatformStats()` → `{ data: PlatformStats }`; `keys.platform.stats`.

- [ ] Determine next migration number (`ls supabase/migrations | tail`), write the migration.
- [ ] `npx supabase db reset` — schema rebuilds cleanly; `select platform_stats();` returns the shape.
- [ ] Write the route + hook + type + key.
- [ ] Integration test: 401 (no token) / 403 (non-admin) / 200 with correct aggregates for a seeded org set — refunded fees netted out, non-`paid`/non-`revenue` payments excluded from GMV. Use `tests/helpers/*`.
- [ ] Run: `npm run test:integration -- platform/stats` → green.
- [ ] Commit: `feat(platform): platform_stats RPC + stats route`.

### Task 2: Audit route + hook (backend)
**Files:**
- Create: `src/app/api/platform/audit/route.ts` — `GET`, `requirePlatformAdmin`; reads `platform_audit_log` newest-first with `limit`(default 50)/`offset` + optional `org_id`; resolves actor names (`user_profiles`) + org names (`organizations`) by id set (no N+1); returns `{ entries: PlatformAuditEntry[], nextOffset: number | null }`.
- Create: `src/app/api/platform/audit/route.integration.test.ts`.
- Modify: `src/types/platform.ts` (+`PlatformAuditEntry`), `src/lib/queryKeys.ts` (+`platform.audit(params)`), create `src/hooks/usePlatformAudit.ts` (`usePlatformAudit({ orgId?, limit? })`, supports paging).

**Produces:** `PlatformAuditEntry` (`{ id, action, actor_name, actor_email, target_org_id, target_org_name, metadata, started_at, ended_at }`); `usePlatformAudit(...)`; `keys.platform.audit`.

- [ ] Write route + hook + type + key.
- [ ] Integration test: auth (401/403), newest-first ordering, pagination `nextOffset`, `org_id` filter, name resolution, null `target_org_id` tolerated.
- [ ] Run: `npm run test:integration -- platform/audit` → green.
- [ ] Commit: `feat(platform): audit log read route`.

### Task 3: Pills + pure presenters (unit-tested)
**Files:**
- Create: `src/components/redesign/platform/pills.tsx` — `SubscriptionPill({status})`, `PaymentsPill({org})` on `Badge` (mapping per spec §4). 
- Create: `src/lib/platform/presenters.ts` — `formatCents(cents:number):string`, `auditActionMeta(action:string): { label:string; variant: BadgeVariant }`, `subscriptionPillMeta`, `paymentsPillMeta`.
- Create: `src/lib/platform/presenters.test.ts`.

**Produces:** the pills + presenters used by Tasks 5-7.

- [ ] Write presenters + pills.
- [ ] Unit test presenters (cents formatting incl. 0 / large; action→label/variant; pill variant mapping for each status).
- [ ] Run: `npm run test:unit -- platform/presenters` → green.
- [ ] Commit: `feat(platform): status pills + presenters`.

### Task 4: PlatformShell + nav + page skeletons
**Files:**
- Create: `src/components/redesign/platform/platform-nav.ts` (`PLATFORM_NAV`: Tenants `/app/owner`, Audit `/app/owner/audit`).
- Create: `src/components/redesign/platform/PlatformShell.tsx` (reuse `OperatorRail` with `PLATFORM_NAV`; slim platform top bar with title + sign-out/profile; simple mobile nav; `<main>`; mounts `TenantDetailHost` in `<Suspense>` [added Task 6] + `RedesignImpersonationBanner` [added Task 8] — leave stubs/TODO comments wired as those land).
- Create: `src/app/(redesign)/app/owner/page.tsx` + `src/app/(redesign)/app/owner/audit/page.tsx` — default export wraps inner client in `<Suspense>`; inner does `useAuth()` guard (spinner while `loading`/`isPlatformAdmin===null`; `/login` if no user; `/` if `isPlatformAdmin===false`) then `<PlatformShell active=...>` with placeholder content.

**Produces:** `PlatformShell`; the two routes.

- [ ] Build nav + shell + pages (placeholder bodies).
- [ ] Verify browser (dev server): `/app/owner` renders shell gated on isPlatformAdmin, rail nav switches to `/app/owner/audit`, active state correct, non-admin bounced.
- [ ] Commit: `feat(platform): platform shell + owner routes`.

### Task 5: Overview — KPIs + tenant roster
**Files:**
- Create: `PlatformStatCards.tsx` (8 `StatTile`s from `usePlatformStats`; skeletons; `ErrorState`).
- Create: `TenantRoster.tsx` (`ListFilterBar` search + subscription/payments `Select` filter → desktop `Table` / mobile card list; `SubscriptionPill`/`PaymentsPill`; sortable headers `aria-sort`; keyboard-activatable rows → `useOpenTenant().open(id)` [added Task 6; until then a temp `?tenant=` via `useDetailParam` set]; empty/error/loading).
- Create: `PlatformOverview.tsx` (header: title + Provision button [opens dialog, Task 6]; `PlatformStatCards`; `TenantRoster`). Wire into `owner/page.tsx`.

**Consumes:** `usePlatformStats`, `usePlatformOrganizations`, pills/presenters.

- [ ] Build cards + roster + overview; wire page.
- [ ] Verify browser: KPIs populate, filters + sort work, row opens `?tenant=` param, empty/error render.
- [ ] Commit: `feat(platform): tenant overview + KPIs`.

### Task 6: Tenant sheet + host + opener + dialogs
**Files:**
- Create: `useOpenTenant.ts` (`{ open, close }`, window.location.search handlers, `?tenant=`).
- Create: `TenantDetailHost.tsx` (mounted in shell; `useDetailParam('tenant')` → `usePlatformOrganization(id)`; `lastId` for exit animation; renders `TenantDetailSheet`). Wrap host in `<Suspense>` in `PlatformShell`.
- Create: `TenantDetailSheet.tsx` (`SheetContent ... sm:max-w-2xl`; identity header + `View as` [→ `/app/admin-dashboard` when `redesignUiEnabled()`, via existing `startImpersonation`]; Billing card; Payments/Connect card + reset; Members table + per-cleaner reset; `TenantRecentActivity`; Danger zone → delete).
- Create: `TenantRecentActivity.tsx` (`usePlatformAudit({ orgId, limit:10 })`).
- Create: `ProvisionTenantDialog.tsx`, `TenantConnectResetDialog.tsx`, `CleanerConnectResetDialog.tsx`, `DeleteTenantDialog.tsx` (behaviors per spec §5.5-5.6; reuse existing routes/hooks; `ConfirmDialog` for tenant reset, custom `ui/dialog` for cleaner-409 + delete-countdown).

**Consumes:** `usePlatformOrganization`, `useProvisionTenant`, existing reset/delete routes, pills/presenters, `usePlatformAudit`.

- [ ] Build opener + host + sheet + activity + the 4 dialogs; wire host into shell + Provision button.
- [ ] Verify browser: row → wide sheet; all sections; provision creates; tenant reset; cleaner 409 force-ack; delete type-name + countdown; View-as enters operator dashboard.
- [ ] Commit(s): `feat(platform): tenant detail sheet + actions` (split provision/delete if large).

### Task 7: Audit log page
**Files:**
- Create: `PlatformAuditLog.tsx` (`Table`: timestamp tabular, actor, action `Badge`, target org link → `useOpenTenant().open`, details from metadata; action-type filter; load-more; empty/error/loading). Wire into `owner/audit/page.tsx`.

**Consumes:** `usePlatformAudit`, presenters, `useOpenTenant`.

- [ ] Build audit page; wire route.
- [ ] Verify browser: entries render newest-first, filter + load-more work, target-org opens the sheet.
- [ ] Commit: `feat(platform): audit log page`.

### Task 8: Redesign impersonation banner + routing gap
**Files:**
- Create: `src/components/redesign/platform/RedesignImpersonationBanner.tsx` (theme-aware, tokens, aria-live, Exit → clears then routes `/app/owner`; reads `useAuth` impersonation state).
- Modify: `OperatorShell.tsx` (mount the banner at top of content) + `PlatformShell.tsx` (mount it).
- Modify: `src/components/LayoutWrapper.tsx` (suppress legacy `ImpersonationBanner` on `/app/*` paths so no double-render — confirm design tokens render for the redesign banner first).
- Modify: `src/app/login/page.tsx:23-32` (`isPlatformAdmin ? (redesignUiEnabled() ? '/app/owner' : '/owner') : ...`).

- [ ] Confirm token rendering for the banner; build it; mount in both shells; suppress legacy on `/app/*`.
- [ ] Update login redirect.
- [ ] Verify browser: impersonate from `/app/owner` → land in `/app/admin-dashboard` with the redesign banner (single, not doubled); Exit returns to `/app/owner`; platform admin login lands on `/app/owner`.
- [ ] Commit: `feat(platform): redesign impersonation banner + platform login route`.

### Task 9: Conformance, review, gates, PR
- [ ] ui-ux-pro-max implementation pass over all new components (raw-hex/off-system/token/contrast/touch-target check); fix leaks.
- [ ] `npx tsc --noEmit` (no NEW errors over baseline), `npm run lint` (touched files clean), targeted `npm run test:integration -- platform` + `npm run test:unit -- platform`.
- [ ] Final adversarial review over the whole diff (small fan-out) focused on: login/routing + impersonation edits, `platform_stats` money correctness, destructive-action parity (delete countdown, cleaner-409). Fix confirmed findings.
- [ ] Browser screenshots (light + dark) of every new surface.
- [ ] `git fetch` + rebase onto `origin/master`; check overlap on `login/page.tsx`, `OperatorShell.tsx`, `LayoutWrapper.tsx`, `queryKeys.ts`.
- [ ] Push; open PR to master; DO NOT merge without Bridger's go-ahead.

## Self-review (against spec)
- Spec §3 routing gap → Task 8. §4 file inventory → Tasks 1-8. §5.1 shell → Task 4. §5.2 overview → Task 5. §5.3 sheet → Task 6. §5.4 audit → Task 7. §5.5-5.6 provision/destructive → Task 6. §5.7 impersonation → Task 8. §6 data layer → Tasks 1-2. §7 UI contract → Global Constraints + Task 9. §8 a11y → Global Constraints + verify steps. §9 testing → per-task tests + Task 9. All covered.
- Types consistent: `PlatformStats` (T1), `PlatformAuditEntry` (T2), pills/presenters (T3) consumed by T5-7; `useOpenTenant` (T6) consumed by T5/T7 (T5 uses a temp param setter until T6 lands, noted).
