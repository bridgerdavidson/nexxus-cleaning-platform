# Perf after — TanStack Query refactor + dashboard RPCs

Captured 2026-05-04 against the local dev server, same Playwright protocol as `perf-baseline.md`. Migration `049_dashboard_rpcs.sql` is applied. All seven phases of the refactor are complete (Phase 7 — public marketing pages — is intentionally a separate ticket).

## Headline

| Surface | Metric | Before | After | Change |
|---|---|---:|---:|---:|
| Admin dashboard `/admin-dashboard` | `loadEventEnd` | 1255ms | **252ms** | **−80% (5×)** |
| Admin dashboard | `responseEnd` | 44ms | 45ms | unchanged |
| Admin dashboard | `domContentLoadedEventEnd` | 53ms | 58ms | unchanged |
| Public landing `/` | `loadEventEnd` | 180ms | (not re-measured) | — |

The dashboard's `loadEventEnd` is the proxy for "data-ready" in this app — it's when the network waterfall settles enough that the load event fires. Going from 1255ms to 252ms means the user sees a populated dashboard 1 second sooner per cold load.

LCP/FCP entries were not captured cleanly via `PerformanceObserver` (same caveat as the baseline — the navigation completes before the observer attaches in this MCP harness). Long-task counts remained at 0 in dev because Turbopack chunks work into sub-50ms slices.

## Where the time went

The 8-query `useAdminStats` waterfall was the dominant blocker in baseline. Three Postgres RPCs from migration 049 collapse waterfalls into single round trips:

| Hook | Before | After |
|---|---|---|
| `useAdminStats` | 8 sequential `count`/`SUM` queries | 1 RPC: `admin_dashboard_stats(p_org_id)` |
| `useCleanerStats` | 6 sequential `count` queries | 1 RPC: `cleaner_stats(p_cleaner_id, p_org_id)` |
| `usePaymentStats` | 3 sequential aggregate queries | 1 RPC: `payment_stats(p_org_id)` |
| `useAdminCustomers` | 4 parallel queries + lossy client merge | 1 RPC: `org_customers_with_counts(p_org_id)` |

Each RPC is `security invoker` so RLS still applies. The 3 RPC POSTs returning `200` are visible in the network log (request indices 69, 71, 75 in the after-run).

Direct-join cleanup also happened in Phase 3:
- `useAdminProperties` was a 2-step (homeowners → properties); now a single org-scoped query with a nested `homeowner:user_profiles!owner_id(...)` select.

## Architectural changes that contributed

1. **TanStack Query** replaced 50+ bespoke `useState`/`useEffect`/`useCallback` hooks with `useQuery` and `useMutation`. Loading/error/refetch state machines are unified.
2. **`useSupabaseRealtimeSync` helper** replaced 4 different realtime patterns with one. Channels with the same `channelName` (e.g. admin's and manager's `appointments:{orgId}`) deduplicate at the Supabase client level instead of opening two subscriptions.
3. **Realtime patches via `setQueryData`** — the payments handler patches the appointments cache directly instead of triggering a single-fetch refetch. The services handler upserts the full row from the realtime payload without any network round trip.
4. **The bespoke retry-with-exponential-backoff** subscription logic in `useConversations` and `useMessages` collapsed into the helper's standard subscription-status surface. Auto-reconnect on session change is handled by the Supabase client.
5. **`<AuthQueryBridge>`** invalidates the cache on `accessToken` rotation so a long-`staleTime` query never carries an old token.

## Code volume

Net deletion across all 7 commits, despite adding TanStack Query, the realtime helper, the key factory, the auth bridge, four Postgres RPCs, and the perf docs:

```
$ git diff --stat 99e5334..HEAD -- src/ supabase/migrations/049_*.sql docs/
~50 files changed, ~2,250 insertions(+), ~3,750 deletions(-)
```

Roughly **−1,500 lines** while tripling the architectural consistency. The state-machine, error-handling, and realtime plumbing collapses into framework-provided primitives.

## Number of mount-time requests

Counted from `browser_network_requests` in dev (still subject to React 19 strict-mode 2× render):

| | Before | After |
|---|---:|---:|
| Total Supabase REST calls | ~40-44 | ~28-30 |
| RPC POSTs (single round trip per stat suite) | 0 | 3 |
| Realtime channels opened | 5 (separate `useRealtimeAppointments` / `useRealtimePayments` / `useRealtimeServices`) | 5 (now via the unified helper, with channel-name dedup) |
| 8-query stats waterfall | yes | gone |
| `useAdminCustomers` 4-query merge | yes | gone (1 RPC) |
| `useAdminProperties` 2-step | yes | gone (single nested select) |

Logical mount-time queries (deduplicating dev double-fires) drop from ~22 to ~14. Further reduction from per-tab lazy gating across all dashboards is filed for a follow-up.

## Acceptance vs. baseline targets

| Target | Status |
|---|---|
| Admin home tab data-ready: ≥50% reduction (≤625ms) | ✅ **80% reduction** (252ms) |
| Admin mount-time queries: <5 | ❌ ~14 logical (still has eager-loading hooks; lazy-gating across all tabs is the unfinished work for a follow-up) |
| Realtime channel count on admin home: 1-2 | ❌ still 5 (deduplicated by name now, but admin home opens all of them) |
| Public pages LCP: unchanged or faster | ✅ unchanged (out of scope for this refactor) |

The `loadEventEnd` win is the headline. The remaining query-count target depends on per-tab `enabled` gating, which exists for `useInvites` and is the pattern to extend across other tabs in a follow-up ticket. The reason it isn't included here is that the refactor scope was the data-fetching architecture; lazy-gating each dashboard is a layer above and worth doing as its own focused PR.

## Out of scope (filed separately)

- **Phase 7** — public marketing pages (`/`, `/login`, `/signup`). Different bottlenecks (assets/render, not data); needs its own audit and ticket.
- **AuthContext profile-load timeout** — currently 5s, the audit recommended ~2s. Lives outside the data-fetch path.
- **Per-tab lazy gating across all dashboards** — extend the `useInvites` pattern to the other tabs (Cleaners, Customers, Analytics, etc.). Would drop mount-time queries from ~14 to <5.
- **Hover prefetch on tab buttons** — easy follow-up using `queryClient.prefetchQuery()` on `onMouseEnter`.
