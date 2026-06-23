# Operator Analytics — Redesign Design Spec

**Date:** 2026-06-23
**Branch:** `feat/redesign-operator-analytics` (off master, worktree `.claude/worktrees/redesign-analytics`)
**Screen:** Operator (admin + manager) **Analytics**, the 7th flag-gated redesign screen, following Overview (#79), Bookings (#80), Customers (#81), Services (#83), Cleaners & team (#84), Payments (#86).
**Reference mockup:** `docs/redesign/mockups/analytics/final.html` + `shot-final.png` (the approved direction). Build screenshot-matched per `[[feedback_ui_native_verify]]`.

---

## 1. Intent

The legacy Analytics tab (`AnalyticsPage.tsx`) is two recharts charts + an 8-row metrics table behind a date/cleaner/property filter. The redesign replaces it with a **"go big" insight cockpit**: a data-dense, premium business-intelligence screen that answers *"how is my cleaning business doing?"* in three seconds, and turns numbers into plain-language insights.

This is the one redesign screen where the "no KPI/stat-tile row" rule is **inverted** — Analytics is a metrics board, so a headline KPI rail is correct here (it is wrong on find/list pages like Customers/Services).

It is the operator console's **demo/sell artifact** (milestone #4 gates pre-selling), so it leans toward visual impact: animated numbers, draw-on charts, a demand heatmap, an auto-Insights panel.

### Approved decisions (from brainstorming)

- **Identity:** Insight cockpit (go big), not a faithful legacy port.
- **Layout:** Direction "A + section labels" — a dominant hero chart + grid, grouped by four plain-language section headers: *Are we on pace? / What's driving revenue? / Who's doing the work? / What's leaking?*
- **v1 scope:** the **4 hero insights + 4 supporting insights** (8 total), plus a 6-KPI rail and an auto-Insights callout panel. Comprehensive list deferred to v2.
- **Chart stack:** **recharts v3** (already installed) wrapped in a new shadcn-style chart primitive themed to design tokens; **`@number-flow/react`** (~7KB, new install) for KPI number roll-ups; **Motion v12** (already installed) for entrance/micro-interactions; the demand heatmap is a **zero-dependency Tailwind intensity grid** (no nivo/echarts).
- **"Revenue" means realized (collected) money**, with booked/pending shown alongside, so a slow week reads as demand vs collection-timing.

---

## 2. The eight insights (v1) and their data

All money is computed in cents in SQL and rendered as **dollars** (the redesign convention). Period = the selected range; "previous period" = the immediately preceding window of equal length (for deltas).

### Section "Are we on pace?"
1. **Realized vs Booked Revenue** *(hero)* — weekly stacked bars: **collected** (`payments.status='paid' AND payment_type='revenue'`, bucketed by `paid_at`) vs **booked/pending** (appointment `total_price` for `status IN ('confirmed','in_progress','completed')` not yet collected), plus a dashed weekly-target line and a booked-total trend line.
2. **Auto-Insights panel** — 3-4 generated sentences ("Revenue up 12%, driven by Deep cleans"; "No-shows cluster on Tuesdays"; "12 regulars went quiet"). Derived in pure code from the same data the cards already load — no extra fetch.

### Section "What's driving revenue?"
3. **Run-Rate & Forecast** *(hero)* — big animated number (trailing-30-day collected, annualized) + a sparkline whose tail is a **dashed forecast** built from already-booked confirmed appointments; an "on pace" delta.
4. **Recurring vs One-off** *(hero)* — donut of revenue from recurring appointments (**`appointments.series_id IS NOT NULL`** → `recurring_appointment_series`) vs one-off (`series_id IS NULL`), with a "monthly recurring base" figure and a delta. *(Linkage confirmed in `src/types`: every generated occurrence carries `series_id`; no fallback proxy needed.)*
5. **Revenue by Service Mix** *(supporting)* — horizontal ranked bars of revenue per `service_types`, with jobs and avg ticket.

### Section "Who's doing the work?"
6. **Cleaner Leaderboard** *(supporting)* — ranked table: per cleaner, completed jobs, revenue generated, avg rating; medal accents for the top 3; sortable.
7. **Demand Heatmap** *(hero)* — 7 days × ~12 hour-buckets intensity grid of appointment counts (by `scheduled_date`/start time), for staffing and slow-window promos.

### Section "What's leaking?"
8. **Cancellations** *(supporting)* — cancel rate (cancelled / total) vs previous period, as the headline + a trend. **Reason attribution is partial:** there is **no `appointments.cancellation_reason`** column; the only reason data is **`appointment_routing_log.decline_reason`** (`sick | too_far | expired | other`, cleaner-side declines during routing) via `routingDeclineReasonLabel`. So the reason breakdown covers only cancellations that went through routing, with the remainder shown honestly as **"reason not recorded"** (no invented "customer flaked" bucket). If Bridger wants true cancellation reasons, that's a small follow-up schema + cancel-flow change, out of scope for this analytics-only PR.
9. **Owed Money / AR Aging** *(supporting)* — completed-but-uncollected + pending/processing, bucketed into Current / 1-7d / 8-30d / 30+d aging bars; a collections worklist headline.

*(Counts as 8 "insights" + the Insights panel: items 1, 3, 4, 5, 6, 7, 8, 9; item 2 is the derived panel.)*

### KPI rail (6 tiles, animated)
Revenue collected · Booked pipeline · Jobs completed (of N) · Recurring share · Cancel rate · Avg job value. Each with a period-over-period delta (toned: revenue-up = green, cancel-up = red) and an inline sparkline.

---

## 3. Backend — new analytics RPCs (one migration)

Almost every insight needs server-side aggregation. We add **one migration** (`supabase/migrations/094_analytics_rpcs.sql` — 093 is the current highest, so 094 is next free) defining **6 RPCs**. They follow the migration-049 stats-RPC pattern but are **`SECURITY DEFINER`** and **authorize the caller themselves** — the lesson from migration 093 (`cleaner_scorecard`): the analytics permission is an *app-layer grant*, not RLS, so a `SECURITY INVOKER` RPC granted to `authenticated` would let an unpermitted same-org manager call it directly. No schema changes (pure SELECT/aggregate over existing columns).

**Authorization inside every RPC:**
- Caller must be an `organization_members` row for `p_org_id` **and** (`role IN ('owner','admin')` **OR** `manager_permissions.can_view_analytics`). Otherwise return **no rows / nulls**.
- **Money fields** (any revenue/owed/earnings column) are returned only when the caller is privileged **OR** `can_view_payments`; otherwise nulled. Non-money insights (jobs, completion, cancellations, demand) return for anyone with `can_view_analytics`. This matches the redesign's payment-gating discipline (stricter than legacy, which showed revenue to any `can_view_analytics` viewer — see Gating note §6).

| RPC | Args | Returns | Powers |
|-----|------|---------|--------|
| `analytics_summary` | `(p_org_id, p_start, p_end)` | JSONB: the 6 KPI values + their previous-period values + deltas; `run_rate`, `forecast_30`; `recurring_cents`/`oneoff_cents`; `ar_aging` buckets; plus the few scalars the Insights panel needs | KPI rail, Run-Rate card, Recurring donut headline, AR Aging, Insights |
| `analytics_revenue_timeseries` | `(p_org_id, p_start, p_end, p_grain)` | rows `{bucket_start, collected_cents, booked_cents, jobs}` | Realized-vs-Booked hero |
| `analytics_service_mix` | `(p_org_id, p_start, p_end)` | rows `{service_type_id, name, revenue_cents, jobs, avg_ticket_cents}` | Revenue by Service |
| `analytics_cleaner_leaderboard` | `(p_org_id, p_start, p_end)` | rows `{cleaner_id, name, jobs, revenue_cents, avg_rating}` | Leaderboard |
| `analytics_demand_heatmap` | `(p_org_id, p_start, p_end)` | rows `{dow, hour_bucket, jobs}` | Demand Heatmap |
| `analytics_cancellations` | `(p_org_id, p_start, p_end)` | JSONB: `{rate, prev_rate, total, cancelled, by_reason:[{reason,count}]}` — `by_reason` aggregates `appointment_routing_log.decline_reason` for cancelled appts + a `not_recorded` bucket for the rest | Cancellations |

`p_grain` is `'day' | 'week' | 'month'`, chosen client-side from the range width (mirrors legacy `useAnalyticsData` bucketing) and validated server-side.

**Correctness:** revenue figures derive from `payments` (realized) and `appointments.total_price` (booked), org-scoped, mirroring `payment_stats`. The reconciliation sweep already keeps `payments` honest, so these RPCs are read-only consumers. Leaderboard revenue is gross of payout (the operator's revenue, not the cleaner's cut).

---

## 4. Frontend architecture

Mirrors the **Container → Data → pure View → derive(+test)** split locked by Bookings/Customers/Services/Cleaners/Payments.

```
src/components/redesign/analytics/
  OperatorAnalytics.tsx         Container/outer GATE: resolves perms, spinner while resolving,
                                EmptyState if !canViewAnalytics, else mounts <OperatorAnalyticsData>
  OperatorAnalyticsData.tsx     Owns all hooks (the analytics queries), range/grain/compare state,
                                leaderboard sort, realtime invalidation, CSV export handler.
                                Passes pure data + slot nodes to the View.
  OperatorAnalyticsView.tsx     PURE: max-w-[1700px] wrapper, the page header + range control,
                                KPI rail, four labelled sections, all cards. Dev-previewable.
  deriveAnalytics.ts            PURE: range→{start,end,prev,grain}, delta/% computation,
                                heatmap normalization, AR bucketization, CSV row building.
  deriveInsights.ts             PURE: generate the Insights-panel sentences from loaded data.
  deriveAnalytics.test.ts       Colocated Vitest (bucketing, deltas, insights, aging, heatmap).
  analytics-types.ts            View-model shapes (Range, Kpi, TimeseriesPoint, LeaderRow, …).
  analytics-presenters.tsx      KPI/insight tone mapping + $ / % / number formatters.
  charts/
    RevenueComposedChart.tsx    recharts ComposedChart (stacked bars + line + target ReferenceLine)
    RecurringDonut.tsx          recharts PieChart donut
    RunRateSparkline.tsx        recharts AreaChart w/ dashed forecast segment
    ServiceMixBars.tsx          recharts horizontal BarChart (or CSS bars)
    DemandHeatmap.tsx           Tailwind intensity grid (no recharts)
    Leaderboard.tsx             table + mini CSS bars + medals
    Cancellations.tsx           rate headline + CSS reason bars
    ArAging.tsx                 CSS bucket bars
    AnimatedStat.tsx            <NumberFlow> wrapper used by the KPI rail + Run-Rate hero

src/components/ui/chart.tsx     NEW shared shadcn-style primitive: ChartContainer (injects
                                --chart-* CSS vars + ResponsiveContainer) + ChartTooltip/ChartLegend.

src/app/(redesign)/app/admin-dashboard/analytics/page.tsx   Live route: Suspense + auth guards +
                                <OperatorShell active="analytics"><OperatorAnalytics/></OperatorShell>
src/app/(dev)/analytics-preview/page.tsx                    Dev/preview-only: mock data → pure View,
                                for no-login Playwright iteration.

src/hooks/                      New useOrgQuery-backed hooks, one per RPC:
  useAnalyticsSummary, useAnalyticsRevenueSeries, useAnalyticsServiceMix,
  useAnalyticsLeaderboard, useAnalyticsDemand, useAnalyticsCancellations
  (each takes the resolved Range; falls back gracefully if the RPC errors pre-migration).

src/lib/queryKeys.ts            Add keys.analytics.*(orgId, rangeKey) hierarchy.
src/components/redesign/shell/nav-items.ts   Repoint analytics href → /app/admin-dashboard/analytics.
```

**Why per-RPC hooks (not one mega-hook):** each card loads + shows a skeleton independently, so a slow leaderboard doesn't block the hero, and realtime can invalidate just the affected keys.

**Globals/tokens:** add additive `--chart-1..--chart-6` CSS vars in `globals.css` (mapped to brand/sky/positive/caution/critical/violet) so charts theme off tokens and dark-mode for free (recharts v3: reference as `var(--chart-1)`, **not** `hsl(var(--chart-1))`).

---

## 5. Motion (premium, restrained, accessible)

Wrap the View in `<MotionConfig reducedMotion="user">`. Signature touches only:

1. **KPI values + Run-Rate roll up** once on load via `@number-flow/react`; on a realtime update only changed digits animate, with a brief delta-color flash.
2. **Charts draw on** at first mount (recharts default ~700ms ease-out): line sweep, bars grow, donut arc, heatmap cell fade. **Once.**
3. **One entrance stagger** per section as it enters the viewport (Motion variants, `staggerChildren: 0.06`, `y:10→0` + fade), then the page holds still. (Lazy-mounting lower sections on scroll also keeps entrance animations from all firing at once — borrowed from layout Direction C.)
4. **Sliding-pill range control** (7D/30D/90D/12M) via Motion `layoutId` shared-layout (reuse/extend the `SegmentedControl` primitive).
5. **Cards lift 2px** + softer shadow on hover (`transform`/`box-shadow` only); animated crosshair tooltip on chart hover; heatmap cells highlight on hover.

**The realtime trap (must handle):** entrance animations fire once. After first mount, set recharts `isAnimationActive={false}` and keep stable Motion `key`s, so a realtime/refetch does **not** re-draw the charts. Track a `hasMountedRef`.

---

## 6. Permissions & gating

- **Screen gate:** `privileged = currentOrgRole === 'owner' || 'admin'`; `canViewAnalytics = privileged || !!permissions?.can_view_analytics`. The Container is an **outer gate that does not mount the Data component** (and therefore fetches nothing) until `canViewAnalytics` — same outer-gate/inner-Data pattern as Customers/Payments (an unauthorized manager must never fetch the rows).
- **Money gate:** `canViewPayments = privileged || !!permissions?.can_view_payments`. Revenue-valued metrics (revenue KPIs, run-rate, service revenue, leaderboard $, AR aging, recurring $) render only when `canViewPayments`; otherwise the screen still shows the non-money insights (jobs, completion, cancellations, demand heatmap). The RPCs enforce the same split server-side (§3) so it isn't just UI hiding.
  - *Decision/divergence from legacy:* legacy showed revenue to any `can_view_analytics` viewer. We tighten to also require `can_view_payments` for money, consistent with the rest of the redesign. Flag for Bridger in review; trivial to relax if he prefers legacy behavior.
- **Mobile:** the shell's bottom-tab + drawer nav already exists; Analytics is a secondary nav item (rail/drawer, not a bottom-tab primary).

---

## 7. Range, comparison, export, realtime

- **Range control:** presets 7D / 30D / 90D / 12M (+ a custom range picker, optional v1). Default 30D. `deriveAnalytics` maps the preset to `{start, end, prev:{start,end}, grain}`.
- **Comparison:** always "vs previous period" of equal length; deltas come from `analytics_summary` returning current + previous internally (one round trip).
- **Export:** a **CSV export** of the loaded series (client-side, built by `deriveAnalytics.buildCsvRows`), matching the mockup's Export button. **PDF export deferred to v2** (legacy's jsPDF path is heavy; not worth blocking v1).
- **Realtime:** subscribe via `useSupabaseRealtimeSync` to `appointments` + `payments` for the org and **invalidate** the `keys.analytics.*` keys (debounced), since the RPC payloads aren't carried in the realtime row. Invalidation refetch must respect the animate-once guard (§5).

---

## 8. Mobile

Single-column stack. KPI rail → 2-col grid (or horizontal snap-scroll) of the 6 tiles. Hero chart full-width; section headers persist. Demand heatmap gets horizontal scroll if it can't fit. Leaderboard/cancellations/aging stack. Range control stays in the header; Export moves into an overflow menu if cramped.

---

## 9. Testing

- **`deriveAnalytics.test.ts` / `deriveInsights.test.ts`** (unit, no infra): range→window math incl. previous-period; day/week/month bucketing; delta & % and tone selection; AR aging bucketization; heatmap normalization (0..1); insight-sentence generation across edge cases (zero data, all-recurring, spike); CSV row building.
- **RPC authorization integration test** (against local Supabase, per `create-tests` skill): seed two orgs + (a) a manager **without** `can_view_analytics` → RPC returns no rows; (b) a manager **with** `can_view_analytics` but **without** `can_view_payments` → non-money fields present, money fields null; (c) owner → full. Asserts org-scoping (no cross-org leakage). This is the §3/§6 security contract and the lesson from migrations 084/093.
- **Playwright dev preview** (`/analytics-preview`): desktop + mobile snapshots of the pure View with mock data; verify sections, charts render, reduced-motion path. Plus a logged-in pass (admin, dev Supabase) per `[[feedback_ui_native_verify]]`, iterating to screenshot-match `shot-final.png`.

---

## 10. Build sequence (for the plan)

1. Migration `094_analytics_rpcs.sql` (6 SECURITY DEFINER RPCs) + `npx supabase db reset` to verify.
2. `src/components/ui/chart.tsx` primitive + `--chart-*` tokens; install `@number-flow/react`; `AnimatedStat`.
3. Per-RPC hooks + queryKeys + `analytics-types` + `deriveAnalytics`/`deriveInsights` (+ tests) — pure layer first.
4. Chart components (`charts/*`) against mock data via `/analytics-preview`.
5. `OperatorAnalyticsView` (pure) → screenshot-match the mockup in the dev preview.
6. `OperatorAnalyticsData` (wire hooks/state/realtime/export) + `OperatorAnalytics` gate + route page.
7. Repoint nav href; longest-prefix `deriveActive` already resolves `/analytics`.
8. Motion pass (entrance stagger, draw-once guard, sliding pill, number-flow).
9. Mobile pass. Logged-in Playwright verification. RPC auth integration test.
10. `npm run test` + `npx tsc --noEmit` + `npm run lint`; Codex pre-push review per `[[feedback_codex_prepush_review]]`; PR.

---

## 11. Risks / open items

- **Recurring linkage:** ~~RESOLVED~~ — `appointments.series_id` cleanly marks occurrences of a `recurring_appointment_series`; no proxy needed.
- **Cancellation reasons source:** ~~RESOLVED to partial~~ — no `cancellation_reason` column exists; reasons come from `appointment_routing_log.decline_reason` (cleaner-side) with a `not_recorded` bucket (§2 item 8). True cancellation reasons are a deferred follow-up.
- **Money gate divergence** from legacy (§6) — confirm with Bridger. *(Legacy showed revenue to any `can_view_analytics` viewer; we additionally require `can_view_payments` for money fields. Easy to relax if undesired.)*
- **`@number-flow/react` SSR:** render inside the `'use client'` islands; it self-gates reduced-motion.
- Charts must be `'use client'`; the route page already is.
