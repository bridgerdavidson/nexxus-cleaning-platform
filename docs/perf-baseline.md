# Perf baseline — pre-TanStack Query refactor

Captured 2026-05-04 against the local dev server (Next.js 16 turbopack, port 3000) using the Playwright MCP server. Will be re-run after Phase 6 cleanup; numbers go in `perf-after.md` for side-by-side comparison.

These are dev-server numbers. Production builds will be faster across the board, but the **shapes** of the bottlenecks (mount-time fan-out, stats waterfall, lack of lazy gating) are intrinsic to the architecture and not artifacts of the dev server.

## Environment caveats

- React 19 strict mode double-mounts effects in dev, so observed Supabase request counts are roughly 2× of what production sees. The audit's "~22 mount queries" figure refers to logical mount-time queries; the dev server shows ~40-44 actual HTTP requests.
- LCP and FCP entries were not captured cleanly via PerformanceObserver because the navigation completed before the observer attached. `domContentLoadedEventEnd` and `loadEventEnd` from `performance.getEntriesByType('navigation')[0]` are used as proxies.
- TTI proxy via long tasks (>50ms) returned 0 long tasks on the dashboard mount despite the heavy network activity, because Turbopack's dev runtime breaks work into small enough chunks that no individual task crosses the 50ms threshold. Total network-waterfall time is the more meaningful metric for this app.

## Public landing — `/`

| Metric | Value |
|---|---|
| `responseEnd` | 59ms |
| `domContentLoadedEventEnd` | 73ms |
| `loadEventEnd` | 180ms |
| Long tasks (>50ms) | 1 (86ms) |
| Total long-task ms | 86ms |
| Supabase data calls | 0 (only auth-context profile/org load fires here, see below) |

**Auth-context calls observed even on the public landing** (existing session in browser): 2× `user_profiles` and 2× `organization_members`. These come from `AuthContext.tsx`'s mount-time profile loader and fire on every page including marketing pages. The duplication on each is React 19 dev double-render — will halve in production.

This page is not a perf concern itself; it's listed for completeness and as a "no-data-fetching" baseline reference.

## Admin dashboard — `/admin-dashboard` (Home tab)

| Metric | Value |
|---|---|
| `responseEnd` | 44ms |
| `domContentLoadedEventEnd` | 53ms |
| `loadEventEnd` | **1255ms** |
| Long tasks (>50ms) | 0 (Turbopack chunking artifact) |
| Total Supabase requests within 5s of nav start | **~40-44** (dev double-mount) |
| Distinct logical mount-time queries | **~22** |
| Realtime channels opened on mount | 5 (appointments, payments, services, conversations, messages) — confirmed via audit, not directly inspectable from page context |

**Network waterfall on mount** (deduplicating the dev double-fires; "→" indicates sequential dependency):

1. AuthContext profile load: `user_profiles` + `organization_members` (×2 each due to dev)
2. `useAdminAppointments`: `appointments` multi-join → `payments` N+1 secondary fetch (status-by-id)
3. `useAdminCleaners`: `cleaner_profiles` multi-join
4. `useAdminPayments`: `payments` multi-join
5. `useAdminPayouts`: `payouts` multi-join
6. `useAdminInvoices`: `invoices` multi-join
7. `useAdminCustomers`: 4 parallel queries (`organization_members` + `user_profiles` + `properties` count + `appointments` count) + client-side merge
8. `useAdminProperties`: 2-step (`organization_members` homeowners → `properties`)
9. `useAdminTeamMembers`: 4 parallel (`organization_members` + `user_profiles` + `cleaner_profiles` + `manager_permissions`)
10. `useAdminStats`: **8 sequential `HEAD count(*)` queries** — appointments by status, cleaners available, payments paid, payouts pending, etc. This waterfall is visible in the network log as request indices 66, 75, 76, 83, 84, 90, 94, 96, 98, 99 (with dev doubling).
11. `usePaymentStats`: 3 sequential aggregate queries
12. `useConversations`: `conversations` + `user_profiles` for participants + `messages` last-N + unread-count by conversation
13. `useServices`: `service_types` + `checklists` for max-adder

All of the above fire **on the Home tab** regardless of which tab the admin actually wants to use. Of these, the only existing lazy gate is `useInvites` (verified in this run — see below).

## Lazy-gating verification (Invites tab)

Confirmed the existing lazy pattern works:

- Before clicking Invites: 0 `/api/invites` requests in the network log.
- Click Invites tab.
- Single `GET /api/invites?organizationId=…` fires (request #103). No other new Supabase requests.
- Tab loads invite list within ~200ms of click.

This is the pattern the refactor will generalize to every other tab.

## Bottlenecks (top 5)

1. **`useAdminStats` 8-query waterfall.** Eight sequential HEAD/count queries that strictly depend on each other only because they're written in a `for await` style. Should be one Postgres RPC (`admin_dashboard_stats(org_id)`) returning all counters. Phase 3 fix.
2. **Mount fan-out.** ~22 logical queries fire on Home regardless of tab choice. Should drop to <5 with per-tab `enabled` gating. Phase 4-5 fix (lazy gating across all dashboards).
3. **Realtime channels opened eagerly.** 5 channels open on Home tab including for tabs the admin may never visit. Phase 4 fix.
4. **N+1 patterns.** `useAdminAppointments` does payment status as a secondary fetch; `useAdminProperties` does homeowners → properties as 2 steps; `useAdminCustomers` does 4 parallel + lossy client merge. Phase 3 fix (embed payments via Supabase select join; single-query joins; RPC for customers).
5. **Auth-context double-firing on every page.** Profile and org-membership queries fire even on public marketing pages (`/`). Out of scope for this refactor but documented for future cleanup.

## Acceptance thresholds (Phase 6 vs this baseline)

| Metric | Baseline | Target |
|---|---|---|
| Admin home `loadEventEnd` (proxy for data-ready) | 1255ms | **≤625ms** (-50%) |
| Admin mount-time distinct queries | ~22 | **<5** |
| Admin mount-time realtime channels | 5 | **1-2** |
| Already-opened tab switch | n/a (not measured) | **<50ms** (cache hit) |
| Public landing LCP/load | 180ms | **unchanged or faster** |

Re-run after Phase 6 with the same Playwright protocol.
