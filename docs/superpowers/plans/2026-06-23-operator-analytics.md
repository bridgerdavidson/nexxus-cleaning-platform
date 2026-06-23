# Operator Analytics Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the flag-gated redesigned operator **Analytics** screen — a "go big" insight cockpit (hero-and-grid grouped by four plain-language sections) on the new primitive kit, backed by 6 new analytics RPCs.

**Architecture:** Mirror the locked redesign pattern: one migration of `SECURITY DEFINER` analytics RPCs that authorize the caller themselves → per-RPC `useOrgQuery` hooks → pure `derive*` transforms (unit-tested) → a pure `OperatorAnalyticsView` of themed recharts + Tailwind cards → a Container gate + Data component that wires hooks/state/realtime → a route page in `(redesign)` + a dev `/analytics-preview`. Motion (number roll-ups, draw-on-once charts, entrance stagger) is layered last and reduced-motion gated.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, Supabase (Postgres RPCs), TanStack Query v5, recharts v3.6, motion v12.40, `@number-flow/react` (new), Vitest 3.

## Global Constraints

- **Branch/worktree:** `feat/redesign-operator-analytics` at `.claude/worktrees/redesign-analytics` (off master, after Payments #86). Run `npm install` + copy `.env.development.local` from the main tree before `next dev -p 3100` / tests (fresh worktree shares no node_modules).
- **Reference mockup (visual source of truth):** `docs/redesign/mockups/analytics/final.html` + `shot-final.png`. Screenshot-match it.
- **Money is dollars in the UI, cents in SQL.** RPCs return cents; presenters format to `$`.
- **No em dashes (`—`) in any user-facing copy** (labels, headers, toasts, empty states). Use periods/commas/"to".
- **Flag gating:** the `(redesign)/layout.tsx` prod 404 already covers this; no per-screen flag.
- **Permission model:** `privileged = currentOrgRole === 'owner' || 'admin'`; screen gate = `privileged || permissions?.can_view_analytics`; money fields additionally require `privileged || permissions?.can_view_payments`. `useManagerPermissions()` returns ALL_FALSE for admins, so check role first.
- **Content width:** every screen wraps its View body in `<div className="max-w-[1700px] space-y-6">`.
- **CI gates before push:** `npm run test`, `npx tsc --noEmit`, `npm run lint`. Codex review on the finished branch before push (`/codex:review --scope branch --base master --wait`).
- **Animate-once invariant:** chart entrance + number roll-ups fire on first mount only, never on a realtime refetch.
- **Highest existing migration is 093; new migration is `094_analytics_rpcs.sql`.**

---

## File Structure

**Created:**
- `supabase/migrations/094_analytics_rpcs.sql` — 6 SECURITY DEFINER RPCs + grants.
- `src/components/redesign/analytics/analytics-types.ts` — view-model + RPC row types (the shared contract).
- `src/components/redesign/analytics/deriveAnalytics.ts` + `.test.ts` — range math, KPI build, AR bucketize, heatmap normalize, CSV rows.
- `src/components/redesign/analytics/deriveInsights.ts` + `.test.ts` — Insights-panel sentence generation.
- `src/components/redesign/analytics/analytics-presenters.tsx` — `$`/`%`/number formatters + KPI tone/icon maps.
- `src/components/redesign/analytics/charts/{ChartFrame,RevenueComposedChart,RecurringDonut,RunRateSparkline,DemandHeatmap,ServiceMixBars,Leaderboard,Cancellations,ArAging,Kpi sparkline}.tsx`.
- `src/components/redesign/analytics/KpiRail.tsx`, `InsightsPanel.tsx`, `AnalyticsRangeControl.tsx`.
- `src/components/redesign/analytics/OperatorAnalyticsView.tsx` — pure View.
- `src/components/redesign/analytics/OperatorAnalytics.tsx` — Container gate + Data component.
- `src/components/ui/chart.tsx` — shared shadcn-style chart container/tooltip primitive.
- `src/components/ui/animated-number.tsx` — `@number-flow/react` wrapper (reduced-motion safe).
- `src/hooks/useAnalytics.ts` — the 6 `useOrgQuery` hooks + the `AnalyticsRange` resolver hook.
- `src/app/(redesign)/app/admin-dashboard/analytics/page.tsx` — live route.
- `src/app/(dev)/analytics-preview/page.tsx` — dev preview (mock → pure View).
- `src/app/api/...` — none (RPCs called directly from hooks).
- `src/lib/analytics/__tests__/analytics_rpcs.integration.test.ts` — RPC authz/org-scope integration test.

**Modified:**
- `src/app/globals.css` — add `--chart-1..--chart-6` to `:root` + `.dark` (additive).
- `src/lib/queryKeys.ts` — extend `keys.analytics` with per-RPC keys.
- `src/components/redesign/shell/nav-items.ts` — repoint the `analytics` href to `/app/admin-dashboard/analytics` (last task).
- `package.json` — add `@number-flow/react`.

---

### Task 1: Migration 094 — six analytics RPCs

**Files:**
- Create: `supabase/migrations/094_analytics_rpcs.sql`

**Interfaces — Produces** (every hook + the integration test depends on these exact signatures + JSON keys):
- `analytics_summary(p_org_id uuid, p_start date, p_end date) returns jsonb`
- `analytics_revenue_timeseries(p_org_id uuid, p_start date, p_end date, p_grain text) returns table(bucket_start date, collected_cents bigint, booked_cents bigint, jobs bigint)`
- `analytics_service_mix(p_org_id uuid, p_start date, p_end date) returns table(service_type_id uuid, name text, revenue_cents bigint, jobs bigint, avg_ticket_cents bigint)`
- `analytics_cleaner_leaderboard(p_org_id uuid, p_start date, p_end date) returns table(cleaner_id uuid, name text, jobs bigint, revenue_cents bigint, avg_rating numeric)`
- `analytics_demand_heatmap(p_org_id uuid, p_start date, p_end date) returns table(dow int, hour int, jobs bigint)`
- `analytics_cancellations(p_org_id uuid, p_start date, p_end date) returns jsonb`

Authorization contract for ALL six: caller must be an `organization_members` row for `p_org_id` AND (`role IN ('owner','admin')` OR `manager_permissions.can_view_analytics`); otherwise return empty/null. Money columns (`*_cents`, revenue, owed) are NULL unless `role IN ('owner','admin')` OR `manager_permissions.can_view_payments`. `total_price` and `payments.amount` are dollars in the DB (`numeric(10,2)`); the RPCs multiply by 100 and cast to `bigint` cents so the client math is integer-safe.

- [ ] **Step 1: Write the migration file**

```sql
-- 094_analytics_rpcs.sql
-- Six per-org analytics RPCs for the redesigned operator Analytics cockpit.
-- All are SECURITY DEFINER and authorize the caller themselves (the analytics
-- permission is an app-layer grant, not RLS — see migration 093). Money fields
-- are nulled unless the caller is privileged or has can_view_payments.

-- ---- shared authz helper: returns (is_member, can_money) for the caller ----
create or replace function public.analytics_authz(p_org_id uuid)
returns table(allowed boolean, can_money boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_role text; v_an boolean; v_pay boolean;
begin
  select role::text into v_role
    from organization_members
    where user_id = auth.uid() and organization_id = p_org_id;
  if v_role is null then
    return query select false, false; return;
  end if;
  if v_role in ('owner','admin') then
    return query select true, true; return;
  end if;
  select coalesce(can_view_analytics,false), coalesce(can_view_payments,false)
    into v_an, v_pay
    from manager_permissions
    where manager_id = auth.uid() and organization_id = p_org_id;
  return query select coalesce(v_an,false), coalesce(v_pay,false);
end; $$;

-- ---- 1. summary (KPIs + deltas + run-rate + recurring split + AR aging) ----
create or replace function public.analytics_summary(p_org_id uuid, p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_allowed boolean; v_money boolean;
  v_len int := (p_end - p_start) + 1;
  v_pstart date := p_start - v_len;  -- previous window of equal length
  v_pend date := p_start - 1;
  v_rev bigint; v_rev_prev bigint; v_booked bigint;
  v_jobs_done bigint; v_jobs_total bigint; v_cancelled bigint;
  v_recurring bigint; v_oneoff bigint;
  v_ar_cur bigint; v_ar_1_7 bigint; v_ar_8_30 bigint; v_ar_30 bigint;
  v_run_rate bigint; v_forecast bigint;
begin
  select allowed, can_money into v_allowed, v_money from public.analytics_authz(p_org_id);
  if not v_allowed then return null; end if;

  -- realized (collected) revenue, by paid_at
  select coalesce(round(sum(amount)*100),0)::bigint into v_rev
    from payments where organization_id = p_org_id and status='paid'
      and payment_type='revenue' and paid_at::date between p_start and p_end;
  select coalesce(round(sum(amount)*100),0)::bigint into v_rev_prev
    from payments where organization_id = p_org_id and status='paid'
      and payment_type='revenue' and paid_at::date between v_pstart and v_pend;
  -- booked (scheduled but not necessarily collected) by scheduled_date
  select coalesce(round(sum(total_price)*100),0)::bigint into v_booked
    from appointments where organization_id = p_org_id
      and status in ('confirmed','in_progress','completed')
      and scheduled_date between p_start and p_end;

  select count(*) filter (where status='completed'),
         count(*),
         count(*) filter (where status='cancelled')
    into v_jobs_done, v_jobs_total, v_cancelled
    from appointments where organization_id = p_org_id
      and scheduled_date between p_start and p_end;

  select
    coalesce(round(sum(case when a.series_id is not null then p.amount else 0 end)*100),0)::bigint,
    coalesce(round(sum(case when a.series_id is null then p.amount else 0 end)*100),0)::bigint
    into v_recurring, v_oneoff
    from payments p join appointments a on a.id = p.appointment_id
    where p.organization_id = p_org_id and p.status='paid' and p.payment_type='revenue'
      and p.paid_at::date between p_start and p_end;

  -- AR aging: completed appts whose payment is not yet collected, by age of scheduled_date
  with owed as (
    select a.id, a.scheduled_date, a.total_price
    from appointments a
    where a.organization_id = p_org_id and a.status='completed'
      and not exists (
        select 1 from payments p where p.appointment_id = a.id
          and p.status in ('paid') and p.payment_type='revenue')
  )
  select
    coalesce(round(sum(total_price) filter (where current_date - scheduled_date <= 0)*100),0)::bigint,
    coalesce(round(sum(total_price) filter (where current_date - scheduled_date between 1 and 7)*100),0)::bigint,
    coalesce(round(sum(total_price) filter (where current_date - scheduled_date between 8 and 30)*100),0)::bigint,
    coalesce(round(sum(total_price) filter (where current_date - scheduled_date > 30)*100),0)::bigint
    into v_ar_cur, v_ar_1_7, v_ar_8_30, v_ar_30 from owed;

  -- run-rate: trailing-30-day collected * (365/30); forecast30: booked confirmed in next 30d
  select coalesce(round(sum(amount)*100),0)::bigint into v_run_rate
    from payments where organization_id = p_org_id and status='paid' and payment_type='revenue'
      and paid_at >= now() - interval '30 days';
  v_run_rate := round(v_run_rate * (365.0/30.0));
  select coalesce(round(sum(total_price)*100),0)::bigint into v_forecast
    from appointments where organization_id = p_org_id
      and status in ('confirmed','in_progress')
      and scheduled_date between current_date and current_date + 30;

  return jsonb_build_object(
    'revenueCents', case when v_money then v_rev else null end,
    'revenuePrevCents', case when v_money then v_rev_prev else null end,
    'bookedCents', case when v_money then v_booked else null end,
    'jobsCompleted', v_jobs_done,
    'jobsTotal', v_jobs_total,
    'cancelled', v_cancelled,
    'cancelRate', case when v_jobs_total=0 then 0 else round(v_cancelled::numeric/v_jobs_total,4) end,
    'recurringCents', case when v_money then v_recurring else null end,
    'oneoffCents', case when v_money then v_oneoff else null end,
    'runRateCents', case when v_money then v_run_rate else null end,
    'forecast30Cents', case when v_money then v_forecast else null end,
    'arAging', case when v_money then jsonb_build_object(
        'current', v_ar_cur, 'd1_7', v_ar_1_7, 'd8_30', v_ar_8_30, 'd30plus', v_ar_30) else null end
  );
end; $$;

-- ---- 2. revenue timeseries (collected vs booked, bucketed) ----
create or replace function public.analytics_revenue_timeseries(p_org_id uuid, p_start date, p_end date, p_grain text)
returns table(bucket_start date, collected_cents bigint, booked_cents bigint, jobs bigint)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_allowed boolean; v_money boolean; v_g text;
begin
  select allowed, can_money into v_allowed, v_money from public.analytics_authz(p_org_id);
  if not v_allowed then return; end if;
  v_g := case when p_grain in ('day','week','month') then p_grain else 'week' end;
  return query
  with buckets as (
    select generate_series(date_trunc(v_g, p_start::timestamp), date_trunc(v_g, p_end::timestamp), ('1 '||v_g)::interval)::date as b
  ),
  coll as (
    select date_trunc(v_g, paid_at)::date as b, round(sum(amount)*100)::bigint as c
    from payments where organization_id=p_org_id and status='paid' and payment_type='revenue'
      and paid_at::date between p_start and p_end group by 1
  ),
  book as (
    select date_trunc(v_g, scheduled_date::timestamp)::date as b,
           round(sum(total_price)*100)::bigint as bk, count(*)::bigint as j
    from appointments where organization_id=p_org_id
      and status in ('confirmed','in_progress','completed')
      and scheduled_date between p_start and p_end group by 1
  )
  select bk.b,
    case when v_money then coalesce(coll.c,0) else null end,
    case when v_money then coalesce(book.bk,0) else null end,
    coalesce(book.j,0)
  from buckets bk left join coll on coll.b=bk.b left join book on book.b=bk.b order by bk.b;
end; $$;

-- ---- 3. service mix ----
create or replace function public.analytics_service_mix(p_org_id uuid, p_start date, p_end date)
returns table(service_type_id uuid, name text, revenue_cents bigint, jobs bigint, avg_ticket_cents bigint)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_allowed boolean; v_money boolean;
begin
  select allowed, can_money into v_allowed, v_money from public.analytics_authz(p_org_id);
  if not v_allowed then return; end if;
  return query
  select st.id, st.name,
    case when v_money then coalesce(round(sum(a.total_price)*100),0)::bigint else null end,
    count(a.id)::bigint,
    case when v_money and count(a.id)>0 then round(avg(a.total_price)*100)::bigint else null end
  from service_types st
  join appointments a on a.service_type_id=st.id and a.organization_id=p_org_id
    and a.status in ('confirmed','in_progress','completed')
    and a.scheduled_date between p_start and p_end
  where st.organization_id=p_org_id
  group by st.id, st.name order by 3 desc nulls last, 4 desc;
end; $$;

-- ---- 4. cleaner leaderboard ----
create or replace function public.analytics_cleaner_leaderboard(p_org_id uuid, p_start date, p_end date)
returns table(cleaner_id uuid, name text, jobs bigint, revenue_cents bigint, avg_rating numeric)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_allowed boolean; v_money boolean;
begin
  select allowed, can_money into v_allowed, v_money from public.analytics_authz(p_org_id);
  if not v_allowed then return; end if;
  return query
  select cp.id,
    trim(coalesce(up.first_name,'')||' '||coalesce(up.last_name,'')) as nm,
    count(a.id) filter (where a.status='completed')::bigint,
    case when v_money then coalesce(round(sum(a.total_price) filter (where a.status='completed')*100),0)::bigint else null end,
    (select round(avg(r.rating),2) from reviews r where r.reviewee_id=cp.id and r.organization_id=p_org_id)
  from cleaner_profiles cp
  join user_profiles up on up.id=cp.id
  join appointments a on a.cleaner_id=cp.id and a.organization_id=p_org_id
    and a.scheduled_date between p_start and p_end
  where cp.organization_id=p_org_id
  group by cp.id, up.first_name, up.last_name
  order by 4 desc nulls last, 3 desc;
end; $$;

-- ---- 5. demand heatmap (dow 0=Sun..6=Sat, hour 0..23) ----
create or replace function public.analytics_demand_heatmap(p_org_id uuid, p_start date, p_end date)
returns table(dow int, hour int, jobs bigint)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_allowed boolean; v_money boolean;
begin
  select allowed, can_money into v_allowed, v_money from public.analytics_authz(p_org_id);
  if not v_allowed then return; end if;
  return query
  select extract(dow from scheduled_date)::int,
         extract(hour from scheduled_time)::int,
         count(*)::bigint
  from appointments where organization_id=p_org_id
    and status in ('confirmed','in_progress','completed','pending')
    and scheduled_date between p_start and p_end
  group by 1,2;
end; $$;

-- ---- 6. cancellations + reasons (reasons from routing log) ----
create or replace function public.analytics_cancellations(p_org_id uuid, p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_allowed boolean; v_money boolean;
  v_total bigint; v_cancelled bigint;
  v_len int := (p_end - p_start) + 1;
  v_pstart date := p_start - v_len; v_pend date := p_start - 1;
  v_pcancel bigint; v_ptotal bigint; v_reasons jsonb;
begin
  select allowed, can_money into v_allowed, v_money from public.analytics_authz(p_org_id);
  if not v_allowed then return null; end if;

  select count(*) filter (where status='cancelled'), count(*)
    into v_cancelled, v_total
    from appointments where organization_id=p_org_id and scheduled_date between p_start and p_end;
  select count(*) filter (where status='cancelled'), count(*)
    into v_pcancel, v_ptotal
    from appointments where organization_id=p_org_id and scheduled_date between v_pstart and v_pend;

  -- reasons: latest declined routing-log reason per cancelled appt; remainder = not_recorded
  with cx as (
    select a.id from appointments a
    where a.organization_id=p_org_id and a.status='cancelled' and a.scheduled_date between p_start and p_end
  ),
  reason_per as (
    select cx.id,
      (select rl.decline_reason from appointment_routing_log rl
        where rl.appointment_id=cx.id and rl.response='declined' and rl.decline_reason is not null
        order by rl.sent_at desc limit 1) as reason
    from cx
  )
  select coalesce(jsonb_agg(jsonb_build_object('reason', coalesce(reason,'not_recorded'), 'count', c) order by c desc), '[]'::jsonb)
    into v_reasons
    from (select coalesce(reason,'not_recorded') as reason, count(*) c from reason_per group by 1) t;

  return jsonb_build_object(
    'total', v_total, 'cancelled', v_cancelled,
    'rate', case when v_total=0 then 0 else round(v_cancelled::numeric/v_total,4) end,
    'prevRate', case when v_ptotal=0 then 0 else round(v_pcancel::numeric/v_ptotal,4) end,
    'byReason', v_reasons
  );
end; $$;

grant execute on function public.analytics_authz(uuid) to authenticated;
grant execute on function public.analytics_summary(uuid,date,date) to authenticated;
grant execute on function public.analytics_revenue_timeseries(uuid,date,date,text) to authenticated;
grant execute on function public.analytics_service_mix(uuid,date,date) to authenticated;
grant execute on function public.analytics_cleaner_leaderboard(uuid,date,date) to authenticated;
grant execute on function public.analytics_demand_heatmap(uuid,date,date) to authenticated;
grant execute on function public.analytics_cancellations(uuid,date,date) to authenticated;
```

- [ ] **Step 2: Rebuild the schema to verify the migration applies cleanly**

Run: `npx supabase db reset`
Expected: completes without error; the six functions appear (no syntax errors). If `db reset` reports a function error, fix the SQL and re-run.

- [ ] **Step 3: Smoke-test one RPC against local Supabase**

Run (psql via supabase): `npx supabase db reset && echo "select public.analytics_summary('00000000-0000-0000-0000-000000000000'::uuid, current_date-30, current_date);" | npx supabase db query -` (or run the SELECT in Studio at :54323)
Expected: returns `null` (caller is not authed as a member of that org in raw SQL → `auth.uid()` is null → not allowed). This confirms the authz path denies by default.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/094_analytics_rpcs.sql
git commit -m "feat(analytics): add 6 SECURITY DEFINER analytics RPCs (migration 094)"
```

---

### Task 2: Shared types + query keys

**Files:**
- Create: `src/components/redesign/analytics/analytics-types.ts`
- Modify: `src/lib/queryKeys.ts`

**Interfaces — Produces:** every later task imports these types. `keys.analytics.summary(orgId, rangeKey)` etc.

- [ ] **Step 1: Write `analytics-types.ts`**

```typescript
export type RangePreset = "7d" | "30d" | "90d" | "12m";
export type Grain = "day" | "week" | "month";

export interface ResolvedRange {
  preset: RangePreset;
  start: string;      // ISO date (YYYY-MM-DD)
  end: string;
  prevStart: string;
  prevEnd: string;
  grain: Grain;
  rangeKey: string;   // stable cache key, e.g. "30d"
}

export interface AnalyticsSummary {
  revenueCents: number | null;
  revenuePrevCents: number | null;
  bookedCents: number | null;
  jobsCompleted: number;
  jobsTotal: number;
  cancelled: number;
  cancelRate: number;          // 0..1
  recurringCents: number | null;
  oneoffCents: number | null;
  runRateCents: number | null;
  forecast30Cents: number | null;
  arAging: { current: number; d1_7: number; d8_30: number; d30plus: number } | null;
}

export interface TimeseriesPoint {
  bucketStart: string;
  collectedCents: number | null;
  bookedCents: number | null;
  jobs: number;
}
export interface ServiceMixRow {
  serviceTypeId: string; name: string;
  revenueCents: number | null; jobs: number; avgTicketCents: number | null;
}
export interface LeaderRow {
  cleanerId: string; name: string; jobs: number;
  revenueCents: number | null; avgRating: number | null;
}
export interface DemandCell { dow: number; hour: number; jobs: number }
export interface CancellationsData {
  total: number; cancelled: number; rate: number; prevRate: number;
  byReason: { reason: string; count: number }[];
}

export type DeltaTone = "good" | "bad" | "neutral";
export interface Kpi {
  key: string;
  label: string;
  value: string;               // preformatted display ("$48.2k", "132", "4.2%")
  rawValue: number | null;     // for NumberFlow; null = "—"
  unit?: string;
  delta?: { dir: "up" | "down" | "flat"; label: string; tone: DeltaTone };
  spark: number[];
  iconKey: "revenue" | "booked" | "jobs" | "recurring" | "cancel" | "avg";
  money: boolean;              // hidden entirely when viewer lacks can_view_payments
}

export interface InsightVM {
  id: string;
  tone: "pos" | "warn" | "crit" | "brand";
  iconKey: "trend" | "alert" | "repeat" | "users";
  text: string;                // may contain **bold** markers handled by the panel
}
```

- [ ] **Step 2: Extend `keys.analytics` in `src/lib/queryKeys.ts`**

Replace the existing `analytics` entry with:

```typescript
  analytics: {
    all: ['analytics'] as const,
    summary: (orgId: string, range: string) => ['analytics', 'summary', orgId, range] as const,
    timeseries: (orgId: string, range: string) => ['analytics', 'timeseries', orgId, range] as const,
    serviceMix: (orgId: string, range: string) => ['analytics', 'serviceMix', orgId, range] as const,
    leaderboard: (orgId: string, range: string) => ['analytics', 'leaderboard', orgId, range] as const,
    demand: (orgId: string, range: string) => ['analytics', 'demand', orgId, range] as const,
    cancellations: (orgId: string, range: string) => ['analytics', 'cancellations', orgId, range] as const,
  },
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -i analytics`
Expected: no NEW errors referencing these files (pre-existing repo CVA noise is fine).

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/analytics/analytics-types.ts src/lib/queryKeys.ts
git commit -m "feat(analytics): shared view-model types + analytics query keys"
```

---

### Task 3: `deriveAnalytics.ts` — range math, KPI build, AR/heatmap/CSV (TDD)

**Files:**
- Create: `src/components/redesign/analytics/deriveAnalytics.ts`
- Test: `src/components/redesign/analytics/deriveAnalytics.test.ts`

**Interfaces — Consumes:** `analytics-types.ts`. **Produces:** `resolveRange(preset, today) -> ResolvedRange`; `buildKpis(summary, timeseries, money) -> Kpi[]`; `normalizeHeatmap(cells) -> { dow:number; hours:number[] }[]` (intensity 0..1, 7 rows × 24); `bucketAging(summary) -> {label,cents,tone}[]`; `pctDelta(cur, prev) -> {dir,label,tone}`; `buildCsvRows(...) -> string[][]`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { resolveRange, pctDelta, normalizeHeatmap, bucketAging, buildKpis } from "./deriveAnalytics";
import type { AnalyticsSummary, TimeseriesPoint, DemandCell } from "./analytics-types";

const TODAY = new Date("2026-06-23T12:00:00Z");

describe("resolveRange", () => {
  it("30d spans 30 days ending today, prev window is the 30 before, grain=day", () => {
    const r = resolveRange("30d", TODAY);
    expect(r.end).toBe("2026-06-23");
    expect(r.start).toBe("2026-05-25");        // 29 days back inclusive = 30 days
    expect(r.prevEnd).toBe("2026-05-24");
    expect(r.prevStart).toBe("2026-04-25");
    expect(r.grain).toBe("day");
    expect(r.rangeKey).toBe("30d");
  });
  it("12m uses month grain", () => {
    expect(resolveRange("12m", TODAY).grain).toBe("month");
  });
});

describe("pctDelta", () => {
  it("up when current exceeds previous", () => {
    expect(pctDelta(112, 100)).toEqual({ dir: "up", label: "12%", tone: "good" });
  });
  it("flat when previous is 0 and current 0", () => {
    expect(pctDelta(0, 0).dir).toBe("flat");
  });
  it("inverted tone supported for bad-is-up metrics", () => {
    expect(pctDelta(5, 4, { upIsGood: false }).tone).toBe("bad");
  });
});

describe("normalizeHeatmap", () => {
  it("returns 7 rows, scales the busiest cell to 1", () => {
    const cells: DemandCell[] = [{ dow: 1, hour: 10, jobs: 8 }, { dow: 2, hour: 9, jobs: 4 }];
    const rows = normalizeHeatmap(cells);
    expect(rows).toHaveLength(7);
    const peak = rows.flatMap((r) => r.hours).reduce((a, b) => Math.max(a, b), 0);
    expect(peak).toBe(1);
  });
});

describe("bucketAging", () => {
  it("maps the four buckets with tones, dollars from cents", () => {
    const s = { arAging: { current: 182000, d1_7: 124000, d8_30: 76000, d30plus: 41000 } } as AnalyticsSummary;
    const b = bucketAging(s);
    expect(b.map((x) => x.label)).toEqual(["Current", "1-7 days", "8-30 days", "30+ days"]);
    expect(b[0].dollars).toBe(1820);
    expect(b[3].tone).toBe("critical");
  });
  it("returns empty when arAging is null (no money access)", () => {
    expect(bucketAging({ arAging: null } as AnalyticsSummary)).toEqual([]);
  });
});

describe("buildKpis", () => {
  it("hides money KPIs when money=false; emits 3 non-money KPIs", () => {
    const s = { jobsCompleted: 132, jobsTotal: 140, cancelRate: 0.042 } as AnalyticsSummary;
    const kpis = buildKpis(s, [], false);
    expect(kpis.every((k) => !k.money)).toBe(true);
    expect(kpis.find((k) => k.key === "jobs")?.value).toBe("132");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- deriveAnalytics`
Expected: FAIL ("resolveRange is not a function").

- [ ] **Step 3: Implement `deriveAnalytics.ts`**

```typescript
import type { AnalyticsSummary, DemandCell, Grain, Kpi, RangePreset, ResolvedRange, TimeseriesPoint } from "./analytics-types";

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }

const SPAN: Record<RangePreset, { days: number; grain: Grain }> = {
  "7d": { days: 7, grain: "day" },
  "30d": { days: 30, grain: "day" },
  "90d": { days: 90, grain: "week" },
  "12m": { days: 365, grain: "month" },
};

export function resolveRange(preset: RangePreset, today: Date): ResolvedRange {
  const { days, grain } = SPAN[preset];
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = addDays(end, -(days - 1));
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  return { preset, start: iso(start), end: iso(end), prevStart: iso(prevStart), prevEnd: iso(prevEnd), grain, rangeKey: preset };
}

export function pctDelta(cur: number | null, prev: number | null, opts: { upIsGood?: boolean } = {}): { dir: "up" | "down" | "flat"; label: string; tone: "good" | "bad" | "neutral" } {
  const upIsGood = opts.upIsGood ?? true;
  if (cur == null || prev == null || prev === 0) {
    if ((cur ?? 0) === 0) return { dir: "flat", label: "0%", tone: "neutral" };
    return { dir: "up", label: "new", tone: upIsGood ? "good" : "bad" };
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const good = dir === "flat" ? "neutral" : (dir === "up") === upIsGood ? "good" : "bad";
  return { dir, label: `${Math.abs(pct)}%`, tone: good };
}

export function normalizeHeatmap(cells: DemandCell[]): { dow: number; hours: number[] }[] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const c of cells) if (c.dow >= 0 && c.dow < 7 && c.hour >= 0 && c.hour < 24) grid[c.dow][c.hour] = c.jobs;
  const peak = Math.max(1, ...grid.flat());
  return grid.map((hours, dow) => ({ dow, hours: hours.map((v) => v / peak) }));
}

export function bucketAging(s: AnalyticsSummary): { label: string; dollars: number; tone: "positive" | "info" | "caution" | "critical" }[] {
  if (!s.arAging) return [];
  const a = s.arAging;
  return [
    { label: "Current", dollars: Math.round(a.current / 100), tone: "positive" },
    { label: "1-7 days", dollars: Math.round(a.d1_7 / 100), tone: "info" },
    { label: "8-30 days", dollars: Math.round(a.d8_30 / 100), tone: "caution" },
    { label: "30+ days", dollars: Math.round(a.d30plus / 100), tone: "critical" },
  ];
}

function fmtMoneyShort(cents: number | null): string {
  if (cents == null) return "—";
  const d = cents / 100;
  return d >= 1000 ? `$${(d / 1000).toFixed(1)}k` : `$${Math.round(d)}`;
}

export function buildKpis(s: AnalyticsSummary, series: TimeseriesPoint[], money: boolean): Kpi[] {
  const collectedSpark = series.map((p) => (p.collectedCents ?? 0) / 100);
  const jobsSpark = series.map((p) => p.jobs);
  const moneyKpis: Kpi[] = money
    ? [
        { key: "revenue", label: "Revenue collected", value: fmtMoneyShort(s.revenueCents), rawValue: (s.revenueCents ?? 0) / 100, delta: pctDelta(s.revenueCents, s.revenuePrevCents), spark: collectedSpark, iconKey: "revenue", money: true },
        { key: "booked", label: "Booked pipeline", value: fmtMoneyShort(s.bookedCents), rawValue: (s.bookedCents ?? 0) / 100, spark: collectedSpark, iconKey: "booked", money: true },
        { key: "recurring", label: "Recurring share", value: `${Math.round(recurringShare(s) * 100)}%`, rawValue: Math.round(recurringShare(s) * 100), unit: "%", spark: [], iconKey: "recurring", money: true },
        { key: "avg", label: "Avg job value", value: fmtMoneyShort(avgJob(s)), rawValue: avgJob(s) == null ? null : avgJob(s)! / 100, spark: [], iconKey: "avg", money: true },
      ]
    : [];
  const baseKpis: Kpi[] = [
    { key: "jobs", label: "Jobs completed", value: `${s.jobsCompleted}`, rawValue: s.jobsCompleted, delta: { dir: "flat", label: `of ${s.jobsTotal}`, tone: "neutral" }, spark: jobsSpark, iconKey: "jobs", money: false },
    { key: "cancel", label: "Cancel rate", value: `${(s.cancelRate * 100).toFixed(1)}%`, rawValue: +(s.cancelRate * 100).toFixed(1), unit: "%", delta: { dir: "flat", label: "vs prev", tone: "neutral" }, spark: [], iconKey: "cancel", money: false },
  ];
  // order: revenue, booked, jobs, recurring, cancel, avg (money ones interleaved when present)
  return money ? [moneyKpis[0], moneyKpis[1], baseKpis[0], moneyKpis[2], baseKpis[1], moneyKpis[3]] : baseKpis;
}

function recurringShare(s: AnalyticsSummary): number {
  const r = s.recurringCents ?? 0, o = s.oneoffCents ?? 0;
  return r + o === 0 ? 0 : r / (r + o);
}
function avgJob(s: AnalyticsSummary): number | null {
  if (s.revenueCents == null || s.jobsCompleted === 0) return null;
  return Math.round(s.revenueCents / s.jobsCompleted);
}

export function buildCsvRows(series: TimeseriesPoint[]): string[][] {
  const header = ["bucket_start", "collected", "booked", "jobs"];
  const rows = series.map((p) => [p.bucketStart, String((p.collectedCents ?? 0) / 100), String((p.bookedCents ?? 0) / 100), String(p.jobs)]);
  return [header, ...rows];
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npm run test:unit -- deriveAnalytics`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/analytics/deriveAnalytics.ts src/components/redesign/analytics/deriveAnalytics.test.ts
git commit -m "feat(analytics): pure range/KPI/aging/heatmap derive layer + tests"
```

---

### Task 4: `deriveInsights.ts` — Insights-panel sentences (TDD)

**Files:**
- Create: `src/components/redesign/analytics/deriveInsights.ts`
- Test: `src/components/redesign/analytics/deriveInsights.test.ts`

**Interfaces — Consumes:** `analytics-types.ts` + `pctDelta`. **Produces:** `deriveInsights({ summary, serviceMix, leaderboard, cancellations }) -> InsightVM[]` (max 4, ordered by importance; honest about missing data).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { deriveInsights } from "./deriveInsights";
import type { AnalyticsSummary, ServiceMixRow, LeaderRow, CancellationsData } from "./analytics-types";

const summary = (o: Partial<AnalyticsSummary> = {}): AnalyticsSummary => ({
  revenueCents: 4820000, revenuePrevCents: 4300000, bookedCents: 6100000,
  jobsCompleted: 132, jobsTotal: 140, cancelled: 6, cancelRate: 0.042,
  recurringCents: 2790000, oneoffCents: 2030000, runRateCents: 58100000, forecast30Cents: 5000000,
  arAging: { current: 182000, d1_7: 124000, d8_30: 76000, d30plus: 41000 }, ...o,
});

describe("deriveInsights", () => {
  it("leads with a revenue-up sentence naming the top service", () => {
    const mix: ServiceMixRow[] = [{ serviceTypeId: "1", name: "Deep clean", revenueCents: 520000, jobs: 20, avgTicketCents: 26000 }];
    const out = deriveInsights({ summary: summary(), serviceMix: mix, leaderboard: [], cancellations: { total: 140, cancelled: 6, rate: 0.042, prevRate: 0.05, byReason: [] } });
    expect(out[0].text).toContain("12%");
    expect(out[0].text.toLowerCase()).toContain("deep clean");
  });
  it("emits at most 4 and never throws on empty data", () => {
    const out = deriveInsights({ summary: summary({ revenueCents: null, recurringCents: null, oneoffCents: null }), serviceMix: [], leaderboard: [], cancellations: { total: 0, cancelled: 0, rate: 0, prevRate: 0, byReason: [] } });
    expect(out.length).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `npm run test:unit -- deriveInsights`
Expected: FAIL.

- [ ] **Step 3: Implement `deriveInsights.ts`**

```typescript
import type { AnalyticsSummary, CancellationsData, InsightVM, LeaderRow, ServiceMixRow } from "./analytics-types";
import { pctDelta } from "./deriveAnalytics";

export function deriveInsights(input: {
  summary: AnalyticsSummary;
  serviceMix: ServiceMixRow[];
  leaderboard: LeaderRow[];
  cancellations: CancellationsData;
}): InsightVM[] {
  const { summary: s, serviceMix, leaderboard, cancellations: c } = input;
  const out: InsightVM[] = [];

  if (s.revenueCents != null && s.revenuePrevCents != null && s.revenuePrevCents > 0) {
    const d = pctDelta(s.revenueCents, s.revenuePrevCents);
    const top = serviceMix[0]?.name;
    if (d.dir !== "flat") {
      out.push({
        id: "rev", tone: d.tone === "good" ? "pos" : "warn", iconKey: "trend",
        text: `**Revenue ${d.dir === "up" ? "up" : "down"} ${d.label}** vs the previous period${top ? `, driven by **${top}**` : ""}.`,
      });
    }
  }

  const recur = (s.recurringCents ?? 0) + (s.oneoffCents ?? 0);
  if (recur > 0) {
    const share = Math.round(((s.recurringCents ?? 0) / recur) * 100);
    out.push({ id: "recur", tone: "brand", iconKey: "repeat", text: `**${share}% of revenue is recurring** repeat work, the predictable backbone.` });
  }

  if (c.total > 0 && c.rate > c.prevRate) {
    const topReason = c.byReason.find((r) => r.reason !== "not_recorded");
    out.push({ id: "cancel", tone: "warn", iconKey: "alert", text: `**Cancellations rose to ${(c.rate * 100).toFixed(1)}%**${topReason ? `, mostly ${topReason.reason.replace(/_/g, " ")}` : ""}.` });
  }

  if (leaderboard.length >= 1 && leaderboard[0].revenueCents != null) {
    const total = leaderboard.reduce((a, b) => a + (b.revenueCents ?? 0), 0);
    if (total > 0) {
      const share = Math.round((leaderboard[0].revenueCents! / total) * 100);
      if (share >= 25) out.push({ id: "lead", tone: "brand", iconKey: "users", text: `**${leaderboard[0].name}** drives ${share}% of revenue this period.` });
    }
  }

  return out.slice(0, 4);
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm run test:unit -- deriveInsights`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/analytics/deriveInsights.ts src/components/redesign/analytics/deriveInsights.test.ts
git commit -m "feat(analytics): pure Insights-panel sentence generation + tests"
```

---

### Task 5: Presenters + chart tokens + deps + AnimatedNumber

**Files:**
- Create: `src/components/redesign/analytics/analytics-presenters.tsx`
- Create: `src/components/ui/animated-number.tsx`
- Create: `src/components/ui/chart.tsx`
- Modify: `src/app/globals.css`
- Modify: `package.json` (via npm install)

**Interfaces — Produces:** `money2(cents)`, `pctLabel`, `KPI_ICONS`, `INSIGHT_ICONS`; `<AnimatedNumber value unit prefix />`; `<ChartFrame>` (themed ResponsiveContainer wrapper); CSS `--chart-1..6`.

- [ ] **Step 1: Install the animated-number dependency**

Run: `npm install @number-flow/react`
Expected: adds `@number-flow/react` to `package.json` dependencies; `npm run test` still green.

- [ ] **Step 2: Add chart tokens to `globals.css`** (append into both `:root` and `.dark`)

In `:root`:
```css
  --chart-1: 221 99% 50%;   /* brand #0150FC */
  --chart-2: 211 89% 60%;   /* sky */
  --chart-3: 152 70% 40%;   /* positive */
  --chart-4: 38 92% 50%;    /* caution */
  --chart-5: 0 72% 51%;     /* critical */
  --chart-6: 255 90% 67%;   /* violet accent */
```
In `.dark` (slightly lifted for contrast on dark cards):
```css
  --chart-1: 221 99% 63%;
  --chart-2: 211 89% 68%;
  --chart-3: 152 60% 52%;
  --chart-4: 38 92% 58%;
  --chart-5: 0 80% 65%;
  --chart-6: 255 90% 75%;
```

- [ ] **Step 3: Write `animated-number.tsx`**

```tsx
"use client";
import NumberFlow from "@number-flow/react";

// Reduced-motion is handled by NumberFlow internally (respondsToReducedMotion).
export function AnimatedNumber({ value, prefix, suffix, className }: { value: number | null; prefix?: string; suffix?: string; className?: string }) {
  if (value == null) return <span className={className}>—</span>;
  return <NumberFlow value={value} prefix={prefix} suffix={suffix} className={className} />;
}
```

- [ ] **Step 4: Write `chart.tsx` (shadcn-style frame)**

```tsx
"use client";
import * as React from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

// Minimal themed wrapper. Series colors are referenced in chart components as
// `var(--chart-N)`. Height is fixed by the caller; width is responsive.
export function ChartFrame({ height = 300, className, children }: { height?: number; className?: string; children: React.ReactElement }) {
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export const CHART_AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 11 };
export const CHART_GRID = { stroke: "hsl(var(--border))" };
```

- [ ] **Step 5: Write `analytics-presenters.tsx`**

```tsx
import { DollarSign, CalendarDays, CheckCircle2, Repeat, XCircle, TrendingUp, AlertTriangle, Users, type LucideIcon } from "lucide-react";
import type { Kpi, InsightVM } from "./analytics-types";

export function money2(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function pctLabel(frac: number): string { return `${(frac * 100).toFixed(1)}%`; }

export const KPI_ICONS: Record<Kpi["iconKey"], LucideIcon> = {
  revenue: DollarSign, booked: CalendarDays, jobs: CheckCircle2, recurring: Repeat, cancel: XCircle, avg: TrendingUp,
};
export const INSIGHT_ICONS: Record<InsightVM["iconKey"], LucideIcon> = {
  trend: TrendingUp, alert: AlertTriangle, repeat: Repeat, users: Users,
};
```

- [ ] **Step 6: Verify build + tests**

Run: `npm run test:unit -- deriveAnalytics && npx tsc --noEmit 2>&1 | grep -iE "analytics-presenters|animated-number|chart.tsx" || echo "no new errors"`
Expected: tests PASS; no new type errors in these files.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/app/globals.css src/components/ui/animated-number.tsx src/components/ui/chart.tsx src/components/redesign/analytics/analytics-presenters.tsx
git commit -m "feat(analytics): chart tokens, ChartFrame primitive, NumberFlow wrapper, presenters"
```

---

### Task 6: Data hooks — six `useOrgQuery` hooks + range resolver

**Files:**
- Create: `src/hooks/useAnalytics.ts`

**Interfaces — Consumes:** `useOrgQuery`, `supabase`, `keys.analytics.*`, `analytics-types`, `resolveRange`. **Produces:** `useAnalyticsRange()` (reads `?range` param, returns `ResolvedRange` + setter); `useAnalyticsSummary(range)`, `useAnalyticsRevenueSeries(range)`, `useAnalyticsServiceMix(range)`, `useAnalyticsLeaderboard(range)`, `useAnalyticsDemand(range)`, `useAnalyticsCancellations(range)` — each returns `{ data, loading }` typed to the §2 shapes.

- [ ] **Step 1: Write `useAnalytics.ts`**

```typescript
"use client";
import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useOrgQuery } from "@/lib/useOrgQuery";
import { keys } from "@/lib/queryKeys";
import { resolveRange } from "@/components/redesign/analytics/deriveAnalytics";
import type {
  AnalyticsSummary, CancellationsData, DemandCell, LeaderRow, RangePreset,
  ResolvedRange, ServiceMixRow, TimeseriesPoint,
} from "@/components/redesign/analytics/analytics-types";

const PRESETS: RangePreset[] = ["7d", "30d", "90d", "12m"];

export function useAnalyticsRange(): { range: ResolvedRange; setPreset: (p: RangePreset) => void } {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("range");
  const preset: RangePreset = (PRESETS as string[]).includes(raw ?? "") ? (raw as RangePreset) : "30d";
  const range = resolveRange(preset, new Date());
  const setPreset = useCallback((p: RangePreset) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("range", p);
    router.replace(`?${sp.toString()}`, { scroll: false });
  }, [params, router]);
  return { range, setPreset };
}

export function useAnalyticsSummary(range: ResolvedRange) {
  const q = useOrgQuery({
    queryKey: keys.analytics.summary("", range.rangeKey),
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase.rpc("analytics_summary", { p_org_id: orgId, p_start: range.start, p_end: range.end });
      if (error) throw error;
      return (data ?? null) as AnalyticsSummary | null;
    },
  });
  return { summary: q.data ?? null, loading: q.isLoading };
}

export function useAnalyticsRevenueSeries(range: ResolvedRange) {
  const q = useOrgQuery({
    queryKey: keys.analytics.timeseries("", range.rangeKey),
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase.rpc("analytics_revenue_timeseries", { p_org_id: orgId, p_start: range.start, p_end: range.end, p_grain: range.grain });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((r): TimeseriesPoint => ({
        bucketStart: String(r.bucket_start), collectedCents: r.collected_cents == null ? null : Number(r.collected_cents),
        bookedCents: r.booked_cents == null ? null : Number(r.booked_cents), jobs: Number(r.jobs ?? 0),
      }));
    },
  });
  return { series: q.data ?? [], loading: q.isLoading };
}

export function useAnalyticsServiceMix(range: ResolvedRange) {
  const q = useOrgQuery({
    queryKey: keys.analytics.serviceMix("", range.rangeKey),
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase.rpc("analytics_service_mix", { p_org_id: orgId, p_start: range.start, p_end: range.end });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((r): ServiceMixRow => ({
        serviceTypeId: String(r.service_type_id), name: String(r.name),
        revenueCents: r.revenue_cents == null ? null : Number(r.revenue_cents), jobs: Number(r.jobs ?? 0),
        avgTicketCents: r.avg_ticket_cents == null ? null : Number(r.avg_ticket_cents),
      }));
    },
  });
  return { rows: q.data ?? [], loading: q.isLoading };
}

export function useAnalyticsLeaderboard(range: ResolvedRange) {
  const q = useOrgQuery({
    queryKey: keys.analytics.leaderboard("", range.rangeKey),
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase.rpc("analytics_cleaner_leaderboard", { p_org_id: orgId, p_start: range.start, p_end: range.end });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((r): LeaderRow => ({
        cleanerId: String(r.cleaner_id), name: String(r.name).trim() || "Cleaner", jobs: Number(r.jobs ?? 0),
        revenueCents: r.revenue_cents == null ? null : Number(r.revenue_cents), avgRating: r.avg_rating == null ? null : Number(r.avg_rating),
      }));
    },
  });
  return { rows: q.data ?? [], loading: q.isLoading };
}

export function useAnalyticsDemand(range: ResolvedRange) {
  const q = useOrgQuery({
    queryKey: keys.analytics.demand("", range.rangeKey),
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase.rpc("analytics_demand_heatmap", { p_org_id: orgId, p_start: range.start, p_end: range.end });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((r): DemandCell => ({ dow: Number(r.dow), hour: Number(r.hour), jobs: Number(r.jobs ?? 0) }));
    },
  });
  return { cells: q.data ?? [], loading: q.isLoading };
}

export function useAnalyticsCancellations(range: ResolvedRange) {
  const q = useOrgQuery({
    queryKey: keys.analytics.cancellations("", range.rangeKey),
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase.rpc("analytics_cancellations", { p_org_id: orgId, p_start: range.start, p_end: range.end });
      if (error) throw error;
      return (data ?? null) as CancellationsData | null;
    },
  });
  return { data: q.data ?? null, loading: q.isLoading };
}
```

> NOTE: `useOrgQuery` injects the real `orgId` into the queryFn context; the empty string in the `queryKey` factory call is replaced at runtime by the bridge (mirrors how `usePaymentStats` builds its key with the resolved id — confirm and, if `useOrgQuery` does not auto-substitute, pass `currentOrganizationId` from `useAuth()` into the key like the Payments hooks do).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -i "useAnalytics" || echo "clean"`
Expected: `clean` (or only pre-existing unrelated noise).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAnalytics.ts
git commit -m "feat(analytics): six useOrgQuery RPC hooks + URL range resolver"
```

---

### Task 7: Chart components (recharts + Tailwind heatmap)

**Files:**
- Create: `src/components/redesign/analytics/charts/RevenueComposedChart.tsx`
- Create: `src/components/redesign/analytics/charts/RecurringDonut.tsx`
- Create: `src/components/redesign/analytics/charts/RunRateSparkline.tsx`
- Create: `src/components/redesign/analytics/charts/DemandHeatmap.tsx`
- Create: `src/components/redesign/analytics/charts/ServiceMixBars.tsx`
- Create: `src/components/redesign/analytics/charts/Leaderboard.tsx`
- Create: `src/components/redesign/analytics/charts/Cancellations.tsx`
- Create: `src/components/redesign/analytics/charts/ArAging.tsx`
- Create: `src/components/redesign/analytics/charts/KpiSparkline.tsx`

**Interfaces — Consumes:** `analytics-types`, `ChartFrame`, recharts. Each is a pure `'use client'` component taking already-derived props. **Produces:** the visual building blocks the View composes. Match `docs/redesign/mockups/analytics/final.html`.

Implementation note: all chart components accept an `animate: boolean` prop (recharts `isAnimationActive={animate}`) so the Data component can disable animation after first mount. They render an empty-state line ("No data for this period") when their data is empty.

- [ ] **Step 1: Implement the recharts charts** (full code; each file is one component)

`RevenueComposedChart.tsx`:
```tsx
"use client";
import { Bar, ComposedChart, Line, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { ChartFrame, CHART_AXIS, CHART_GRID } from "@/components/ui/chart";
import type { TimeseriesPoint } from "../analytics-types";

export function RevenueComposedChart({ data, targetCents, animate }: { data: TimeseriesPoint[]; targetCents?: number; animate: boolean }) {
  if (!data.length) return <EmptyChart />;
  const rows = data.map((p) => ({ x: p.bucketStart.slice(5), collected: (p.collectedCents ?? 0) / 100, pending: Math.max(0, ((p.bookedCents ?? 0) - (p.collectedCents ?? 0)) / 100) }));
  return (
    <ChartFrame height={300}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} {...CHART_GRID} />
        <XAxis dataKey="x" tickLine={false} axisLine={false} {...CHART_AXIS} />
        <YAxis tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`} tickLine={false} axisLine={false} width={48} {...CHART_AXIS} />
        <Tooltip cursor={{ fill: "hsl(var(--muted)/0.4)" }} formatter={(v: number) => `$${v.toLocaleString()}`} />
        <Bar dataKey="collected" stackId="r" fill="var(--chart-1)" radius={[0, 0, 0, 0]} isAnimationActive={animate} />
        <Bar dataKey="pending" stackId="r" fill="var(--chart-2)" radius={[4, 4, 0, 0]} isAnimationActive={animate} />
        {targetCents ? <ReferenceLine y={targetCents / 100} stroke="var(--chart-4)" strokeDasharray="5 5" /> : null}
      </ComposedChart>
    </ChartFrame>
  );
}
function EmptyChart() { return <div className="grid h-[300px] place-items-center text-sm text-muted-foreground">No data for this period</div>; }
```

`RecurringDonut.tsx`:
```tsx
"use client";
import { Cell, Pie, PieChart } from "recharts";
import { ChartFrame } from "@/components/ui/chart";

export function RecurringDonut({ recurringCents, oneoffCents, animate }: { recurringCents: number | null; oneoffCents: number | null; animate: boolean }) {
  const r = recurringCents ?? 0, o = oneoffCents ?? 0;
  if (r + o === 0) return <div className="grid h-[160px] place-items-center text-sm text-muted-foreground">No revenue yet</div>;
  const share = Math.round((r / (r + o)) * 100);
  const data = [{ name: "Recurring", value: r }, { name: "One-off", value: o }];
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[150px] w-[150px]">
        <ChartFrame height={150}>
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={50} outerRadius={66} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={animate}>
              <Cell fill="var(--chart-1)" /><Cell fill="hsl(var(--muted))" />
            </Pie>
          </PieChart>
        </ChartFrame>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center"><div className="text-2xl font-extrabold tnum">{share}%</div><div className="text-[11px] text-muted-foreground">recurring</div></div>
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <Legend color="var(--chart-1)" label="Recurring" value={`$${Math.round(r / 100).toLocaleString()}`} />
        <Legend color="hsl(var(--muted))" label="One-off" value={`$${Math.round(o / 100).toLocaleString()}`} />
      </div>
    </div>
  );
}
function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return <div className="flex items-center gap-2"><span className="size-3 rounded" style={{ background: color }} /><span className="text-muted-foreground">{label}</span><span className="ml-auto font-bold tnum">{value}</span></div>;
}
```

`RunRateSparkline.tsx`:
```tsx
"use client";
import { Area, AreaChart } from "recharts";
import { ChartFrame } from "@/components/ui/chart";
import { AnimatedNumber } from "@/components/ui/animated-number";

export function RunRateSparkline({ runRateCents, series, animate }: { runRateCents: number | null; series: number[]; animate: boolean }) {
  const rows = series.map((v, i) => ({ i, v }));
  return (
    <div className="space-y-1">
      <div className="text-[32px] font-extrabold leading-none tracking-tight tnum"><AnimatedNumber value={runRateCents == null ? null : Math.round(runRateCents / 100)} prefix="$" /></div>
      <div className="text-xs font-semibold text-muted-foreground">Annualized run-rate, trailing 30 days</div>
      <ChartFrame height={70}>
        <AreaChart data={rows} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
          <defs><linearGradient id="rr" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--chart-1)" stopOpacity="0.25" /><stop offset="1" stopColor="var(--chart-1)" stopOpacity="0" /></linearGradient></defs>
          <Area dataKey="v" stroke="var(--chart-1)" strokeWidth={2.2} fill="url(#rr)" isAnimationActive={animate} />
        </AreaChart>
      </ChartFrame>
    </div>
  );
}
```

`ServiceMixBars.tsx`:
```tsx
"use client";
import type { ServiceMixRow } from "../analytics-types";

export function ServiceMixBars({ rows }: { rows: ServiceMixRow[] }) {
  if (!rows.length) return <Empty />;
  const max = Math.max(1, ...rows.map((r) => r.revenueCents ?? 0));
  return (
    <div className="space-y-3">
      {rows.slice(0, 6).map((r) => (
        <div key={r.serviceTypeId}>
          <div className="mb-1 flex justify-between text-[12.5px]"><span className="font-semibold">{r.name}</span><span className="text-muted-foreground tnum">{r.revenueCents == null ? "—" : `$${(r.revenueCents / 100 / 1000).toFixed(1)}k`}</span></div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${((r.revenueCents ?? 0) / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
function Empty() { return <div className="grid h-24 place-items-center text-sm text-muted-foreground">No services billed this period</div>; }
```

`Leaderboard.tsx`:
```tsx
"use client";
import type { LeaderRow } from "../analytics-types";
import { cn } from "@/lib/utils";

const MEDAL = ["bg-amber-400 text-amber-950", "bg-slate-300 text-slate-700", "bg-orange-300 text-orange-900"];

export function Leaderboard({ rows }: { rows: LeaderRow[] }) {
  if (!rows.length) return <div className="grid h-24 place-items-center text-sm text-muted-foreground">No completed jobs this period</div>;
  const max = Math.max(1, ...rows.map((r) => r.revenueCents ?? 0));
  return (
    <div className="divide-y divide-border">
      {rows.slice(0, 6).map((r, i) => (
        <div key={r.cleanerId} className="grid grid-cols-[24px_1fr_auto] items-center gap-3 py-2.5">
          <span className={cn("grid size-6 place-items-center rounded-md text-xs font-extrabold", MEDAL[i] ?? "bg-muted text-muted-foreground")}>{i + 1}</span>
          <div>
            <div className="text-[13px] font-bold">{r.name}</div>
            <div className="text-[11.5px] text-muted-foreground">{r.jobs} jobs{r.avgRating != null ? ` · ${r.avgRating.toFixed(1)}★` : ""}</div>
            <div className="mt-1.5 h-[5px] w-32 overflow-hidden rounded bg-muted"><span className="block h-full rounded bg-[var(--chart-1)]" style={{ width: `${((r.revenueCents ?? 0) / max) * 100}%` }} /></div>
          </div>
          <span className="text-sm font-extrabold tnum">{r.revenueCents == null ? "—" : `$${Math.round(r.revenueCents / 100).toLocaleString()}`}</span>
        </div>
      ))}
    </div>
  );
}
```

`Cancellations.tsx`:
```tsx
"use client";
import type { CancellationsData } from "../analytics-types";
import { routingDeclineReasonLabel } from "@/types";

export function Cancellations({ data }: { data: CancellationsData | null }) {
  if (!data) return <div className="grid h-24 place-items-center text-sm text-muted-foreground">No data</div>;
  const down = data.rate <= data.prevRate;
  const max = Math.max(1, ...data.byReason.map((r) => r.count));
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2.5">
        <span className="text-2xl font-extrabold tnum text-critical-700 dark:text-destructive">{(data.rate * 100).toFixed(1)}%</span>
        <span className={down ? "text-xs font-semibold text-positive-700 dark:text-positive" : "text-xs font-semibold text-critical-700 dark:text-destructive"}>{down ? "down" : "up"} vs prev</span>
        <span className="ml-auto text-xs text-muted-foreground">{data.cancelled} of {data.total} jobs</span>
      </div>
      <div className="space-y-2.5">
        {data.byReason.map((r) => (
          <div key={r.reason}>
            <div className="mb-1 flex justify-between text-[12.5px]"><span className="font-semibold">{r.reason === "not_recorded" ? "Reason not recorded" : routingDeclineReasonLabel(r.reason)}</span><span className="text-muted-foreground tnum">{r.count}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[var(--chart-4)]" style={{ width: `${(r.count / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

`ArAging.tsx`:
```tsx
"use client";
import type { AnalyticsSummary } from "../analytics-types";
import { bucketAging } from "../deriveAnalytics";

const TONE: Record<string, string> = { positive: "bg-[var(--chart-3)]", info: "bg-[var(--chart-2)]", caution: "bg-[var(--chart-4)]", critical: "bg-[var(--chart-5)]" };

export function ArAging({ summary }: { summary: AnalyticsSummary | null }) {
  const buckets = summary ? bucketAging(summary) : [];
  if (!buckets.length) return <div className="grid h-24 place-items-center text-sm text-muted-foreground">No outstanding balances</div>;
  const total = buckets.reduce((a, b) => a + b.dollars, 0);
  const max = Math.max(1, ...buckets.map((b) => b.dollars));
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2.5"><span className="text-2xl font-extrabold tnum">${total.toLocaleString()}</span><span className="text-xs font-semibold text-muted-foreground">owed</span></div>
      <div className="flex h-[150px] items-end gap-3.5 pt-2">
        {buckets.map((b) => (
          <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
            <span className="text-[12.5px] font-extrabold tnum">${(b.dollars / 1000).toFixed(1)}k</span>
            <div className={`w-full rounded-t-lg ${TONE[b.tone]}`} style={{ height: `${(b.dollars / max) * 100}%` }} />
            <span className="text-[11px] font-semibold text-muted-foreground">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

`KpiSparkline.tsx`:
```tsx
"use client";
import { Area, AreaChart } from "recharts";

export function KpiSparkline({ values, color = "var(--chart-1)" }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
  const id = `sk${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <div className="h-[30px] w-[92px]">
      <AreaChart width={92} height={30} data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.22" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <Area dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} />
      </AreaChart>
    </div>
  );
}
```

- [ ] **Step 2: Implement the Tailwind heatmap** (`DemandHeatmap.tsx`)

```tsx
"use client";
import { normalizeHeatmap } from "../deriveAnalytics";
import type { DemandCell } from "../analytics-types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 12 }, (_, i) => i + 7); // 7am..6pm

export function DemandHeatmap({ cells }: { cells: DemandCell[] }) {
  if (!cells.length) return <div className="grid h-24 place-items-center text-sm text-muted-foreground">No bookings this period</div>;
  const rows = normalizeHeatmap(cells); // 7 rows × 24 hours, 0..1
  return (
    <div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `34px repeat(${HOURS.length}, 1fr)` }}>
        <div />
        {HOURS.map((h) => <div key={h} className="pb-0.5 text-center text-[9.5px] font-semibold text-muted-foreground">{h > 12 ? h - 12 : h}</div>)}
        {rows.map((r) => (
          <FragmentRow key={r.dow} label={DAYS[r.dow]} hours={HOURS.map((h) => r.hours[h])} />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground"><span>Quiet</span>{[0.1, 0.3, 0.5, 0.7, 0.9, 1].map((a) => <span key={a} className="h-2.5 w-3.5 rounded-sm" style={{ background: `rgb(1 80 252 / ${a})` }} />)}<span>Busy</span></div>
    </div>
  );
}
function FragmentRow({ label, hours }: { label: string; hours: number[] }) {
  return (
    <>
      <div className="flex items-center text-[10.5px] font-bold text-muted-foreground">{label}</div>
      {hours.map((v, i) => <div key={i} className="aspect-square rounded-[6px]" style={{ background: `rgb(1 80 252 / ${(0.06 + (v || 0) * 0.94).toFixed(2)})` }} />)}
    </>
  );
}
```

- [ ] **Step 3: Type-check the charts**

Run: `npx tsc --noEmit 2>&1 | grep -i "analytics/charts" || echo "clean"`
Expected: `clean` (CVA noise aside).

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/analytics/charts
git commit -m "feat(analytics): themed recharts charts + Tailwind demand heatmap"
```

---

### Task 8: KPI rail, Insights panel, range control

**Files:**
- Create: `src/components/redesign/analytics/KpiRail.tsx`
- Create: `src/components/redesign/analytics/InsightsPanel.tsx`
- Create: `src/components/redesign/analytics/AnalyticsRangeControl.tsx`

**Interfaces — Consumes:** `Kpi`/`InsightVM` types, `AnimatedNumber`, `KpiSparkline`, `KPI_ICONS`/`INSIGHT_ICONS`, `SegmentedControl`. **Produces:** `<KpiRail kpis />`, `<InsightsPanel insights />`, `<AnalyticsRangeControl preset onChange />`.

- [ ] **Step 1: Implement the three components**

`AnalyticsRangeControl.tsx`:
```tsx
"use client";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { RangePreset } from "./analytics-types";

export function AnalyticsRangeControl({ preset, onChange }: { preset: RangePreset; onChange: (p: RangePreset) => void }) {
  return (
    <SegmentedControl
      value={preset}
      onChange={onChange}
      options={[{ value: "7d", label: "7D" }, { value: "30d", label: "30D" }, { value: "90d", label: "90D" }, { value: "12m", label: "12M" }]}
    />
  );
}
```

`KpiRail.tsx`:
```tsx
"use client";
import { Card } from "@/components/ui/card";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { KpiSparkline } from "./charts/KpiSparkline";
import { KPI_ICONS } from "./analytics-presenters";
import { cn } from "@/lib/utils";
import type { Kpi } from "./analytics-types";

export function KpiRail({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      {kpis.map((k) => {
        const Icon = KPI_ICONS[k.iconKey];
        const prefix = k.iconKey === "revenue" || k.iconKey === "booked" || k.iconKey === "avg" ? "$" : "";
        return (
          <Card key={k.key} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground">{k.label}</p>
              <span className="grid size-7 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950"><Icon className="size-4" /></span>
            </div>
            <p className="mt-2 text-2xl font-extrabold tracking-tight tnum">
              {k.rawValue == null ? "—" : <AnimatedNumber value={k.rawValue} prefix={prefix} suffix={k.unit} />}
            </p>
            <div className="mt-2 flex items-center justify-between">
              {k.delta ? <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-bold", k.delta.tone === "good" ? "bg-positive-50 text-positive-700" : k.delta.tone === "bad" ? "bg-critical-50 text-critical-700" : "bg-muted text-muted-foreground")}>{k.delta.dir === "up" ? "▲" : k.delta.dir === "down" ? "▼" : ""} {k.delta.label}</span> : <span />}
              <KpiSparkline values={k.spark} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
```

`InsightsPanel.tsx`:
```tsx
"use client";
import { INSIGHT_ICONS } from "./analytics-presenters";
import { cn } from "@/lib/utils";
import type { InsightVM } from "./analytics-types";

const TONE: Record<InsightVM["tone"], string> = {
  pos: "bg-positive-50 text-positive-700", warn: "bg-caution-50 text-caution-700",
  crit: "bg-critical-50 text-critical-700", brand: "bg-brand-50 text-brand-600",
};

function renderBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((seg, i) => seg.startsWith("**") ? <b key={i} className="font-bold text-foreground">{seg.slice(2, -2)}</b> : <span key={i}>{seg}</span>);
}

export function InsightsPanel({ insights }: { insights: InsightVM[] }) {
  if (!insights.length) return <p className="text-sm text-muted-foreground">Insights appear as data accrues this period.</p>;
  return (
    <div className="flex flex-col gap-3">
      {insights.map((it) => {
        const Icon = INSIGHT_ICONS[it.iconKey];
        return (
          <div key={it.id} className="flex gap-3 rounded-card border border-border bg-card p-3">
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", TONE[it.tone])}><Icon className="size-4" /></span>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{renderBold(it.text)}</p>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -iE "KpiRail|InsightsPanel|AnalyticsRangeControl" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/analytics/KpiRail.tsx src/components/redesign/analytics/InsightsPanel.tsx src/components/redesign/analytics/AnalyticsRangeControl.tsx
git commit -m "feat(analytics): KPI rail, Insights panel, range control"
```

---

### Task 9: Pure `OperatorAnalyticsView` + dev preview route

**Files:**
- Create: `src/components/redesign/analytics/OperatorAnalyticsView.tsx`
- Create: `src/app/(dev)/analytics-preview/page.tsx`

**Interfaces — Consumes:** all chart + rail components. **Produces:** `OperatorAnalyticsViewProps` (pure props) + the four-section layout matching the mockup; a dev preview feeding mock data.

- [ ] **Step 1: Implement `OperatorAnalyticsView.tsx`**

```tsx
"use client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { AnalyticsRangeControl } from "./AnalyticsRangeControl";
import { KpiRail } from "./KpiRail";
import { RevenueComposedChart } from "./charts/RevenueComposedChart";
import { RunRateSparkline } from "./charts/RunRateSparkline";
import { RecurringDonut } from "./charts/RecurringDonut";
import { DemandHeatmap } from "./charts/DemandHeatmap";
import { ServiceMixBars } from "./charts/ServiceMixBars";
import { Leaderboard } from "./charts/Leaderboard";
import { Cancellations } from "./charts/Cancellations";
import { ArAging } from "./charts/ArAging";
import type { AnalyticsSummary, CancellationsData, DemandCell, Kpi, LeaderRow, RangePreset, ServiceMixRow, TimeseriesPoint } from "./analytics-types";
import type { ReactNode } from "react";

export type OperatorAnalyticsViewProps = {
  preset: RangePreset;
  onPresetChange: (p: RangePreset) => void;
  kpis: Kpi[];
  summary: AnalyticsSummary | null;
  series: TimeseriesPoint[];
  runRateSpark: number[];
  serviceMix: ServiceMixRow[];
  leaderboard: LeaderRow[];
  demand: DemandCell[];
  cancellations: CancellationsData | null;
  insightsSlot: ReactNode;
  animate: boolean;
  onExport?: () => void;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-3 text-xs font-extrabold uppercase tracking-[0.08em] text-muted-foreground after:h-px after:flex-1 after:bg-border after:content-['']">{title}</h2>
      {children}
    </section>
  );
}
function Panel({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return <Card className="p-4"><div className="mb-3"><div className="text-sm font-bold">{title}</div>{desc ? <div className="text-xs text-muted-foreground">{desc}</div> : null}</div>{children}</Card>;
}

export function OperatorAnalyticsView(p: OperatorAnalyticsViewProps) {
  return (
    <div className="max-w-[1700px] space-y-7">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">Compared to the previous period</p>
        </div>
        <div className="flex items-center gap-3">
          <AnalyticsRangeControl preset={p.preset} onChange={p.onPresetChange} />
          {p.onExport ? <Button variant="outline" onClick={p.onExport}><Download className="size-4" /> Export</Button> : null}
        </div>
      </header>

      <KpiRail kpis={p.kpis} />

      <Section title="Are we on pace?">
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Panel title="Realized vs booked revenue" desc="Cash collected vs scheduled but not yet landed">
            <RevenueComposedChart data={p.series} animate={p.animate} />
          </Panel>
          <Panel title="Insights">{p.insightsSlot}</Panel>
        </div>
      </Section>

      <Section title="What's driving revenue?">
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Run-rate & forecast" desc="Are we on pace to target?"><RunRateSparkline runRateCents={p.summary?.runRateCents ?? null} series={p.runRateSpark} animate={p.animate} /></Panel>
          <Panel title="Recurring vs one-off" desc="Predictable backbone"><RecurringDonut recurringCents={p.summary?.recurringCents ?? null} oneoffCents={p.summary?.oneoffCents ?? null} animate={p.animate} /></Panel>
          <Panel title="Revenue by service" desc="Which lines pay"><ServiceMixBars rows={p.serviceMix} /></Panel>
        </div>
      </Section>

      <Section title="Who's doing the work?">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Cleaner leaderboard" desc="Top performers this period"><Leaderboard rows={p.leaderboard} /></Panel>
          <Panel title="Demand by day & hour" desc="Busiest windows for staffing"><DemandHeatmap cells={p.demand} /></Panel>
        </div>
      </Section>

      <Section title="What's leaking?">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Cancellations" desc="Lost revenue, and why"><Cancellations data={p.cancellations} /></Panel>
          <Panel title="Owed money, AR aging" desc="Collections worklist"><ArAging summary={p.summary} /></Panel>
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 2: Implement `src/app/(dev)/analytics-preview/page.tsx`** (mock data → pure View, mirrors payments-preview)

```tsx
"use client";
import { useState } from "react";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorAnalyticsView } from "@/components/redesign/analytics/OperatorAnalyticsView";
import { InsightsPanel } from "@/components/redesign/analytics/InsightsPanel";
import { buildKpis } from "@/components/redesign/analytics/deriveAnalytics";
import { deriveInsights } from "@/components/redesign/analytics/deriveInsights";
import type { AnalyticsSummary, CancellationsData, DemandCell, LeaderRow, RangePreset, ServiceMixRow, TimeseriesPoint } from "@/components/redesign/analytics/analytics-types";

const SUMMARY: AnalyticsSummary = { revenueCents: 4820000, revenuePrevCents: 4300000, bookedCents: 6100000, jobsCompleted: 132, jobsTotal: 140, cancelled: 6, cancelRate: 0.042, recurringCents: 2790000, oneoffCents: 2030000, runRateCents: 58100000, forecast30Cents: 5000000, arAging: { current: 182000, d1_7: 124000, d8_30: 76000, d30plus: 41000 } };
const SERIES: TimeseriesPoint[] = ["05-05","05-12","05-19","05-26","06-02","06-09","06-16"].map((d, i) => ({ bucketStart: `2026-${d}`, collectedCents: (420 + i * 60) * 1000, bookedCents: (520 + i * 75) * 1000, jobs: 14 + i }));
const MIX: ServiceMixRow[] = [{ serviceTypeId: "1", name: "Deep clean", revenueCents: 520000, jobs: 20, avgTicketCents: 26000 }, { serviceTypeId: "2", name: "Standard", revenueCents: 400000, jobs: 30, avgTicketCents: 13300 }, { serviceTypeId: "3", name: "Move-out", revenueCents: 310000, jobs: 8, avgTicketCents: 38750 }];
const LEADERS: LeaderRow[] = [{ cleanerId: "1", name: "Wanda P.", jobs: 28, revenueCents: 358400, avgRating: 4.9 }, { cleanerId: "2", name: "Marco D.", jobs: 22, revenueCents: 214000, avgRating: 4.8 }, { cleanerId: "3", name: "Lena R.", jobs: 19, revenueCents: 192000, avgRating: 5 }];
const DEMAND: DemandCell[] = Array.from({ length: 7 }, (_, d) => Array.from({ length: 12 }, (_, h) => ({ dow: d, hour: h + 7, jobs: Math.round(Math.max(0, Math.sin((h) / 3) * 6 + (d === 5 || d === 6 ? 3 : 0))) }))).flat();
const CANCEL: CancellationsData = { total: 432, cancelled: 18, rate: 0.042, prevRate: 0.05, byReason: [{ reason: "too_far", count: 7 }, { reason: "sick", count: 5 }, { reason: "expired", count: 3 }, { reason: "not_recorded", count: 3 }] };

export default function AnalyticsPreviewPage() {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const kpis = buildKpis(SUMMARY, SERIES, true);
  const insights = deriveInsights({ summary: SUMMARY, serviceMix: MIX, leaderboard: LEADERS, cancellations: CANCEL });
  return (
    <OperatorShell active="analytics" onNewBooking={() => {}}>
      <OperatorAnalyticsView
        preset={preset} onPresetChange={setPreset} kpis={kpis} summary={SUMMARY} series={SERIES}
        runRateSpark={SERIES.map((p) => (p.collectedCents ?? 0) / 100)} serviceMix={MIX} leaderboard={LEADERS}
        demand={DEMAND} cancellations={CANCEL} insightsSlot={<InsightsPanel insights={insights} />} animate onExport={() => {}}
      />
    </OperatorShell>
  );
}
```

- [ ] **Step 3: Render + screenshot-match against the mockup**

Run: `npm install` (if not yet in this worktree), copy `.env.development.local` from the main tree, then `npm run dev -- -p 3100`. Open `http://localhost:3100/analytics-preview`. Compare to `docs/redesign/mockups/analytics/shot-final.png` using Playwright MCP at desktop (1500 wide) and mobile (390 wide). Fix spacing/wrapping until it matches.
Expected: four labelled sections, hero + insights, 3-up, two 2-ups; mobile single-column.

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/analytics/OperatorAnalyticsView.tsx "src/app/(dev)/analytics-preview/page.tsx"
git commit -m "feat(analytics): pure OperatorAnalyticsView + dev preview route"
```

---

### Task 10: Container gate + Data component + live route

**Files:**
- Create: `src/components/redesign/analytics/OperatorAnalytics.tsx`
- Create: `src/app/(redesign)/app/admin-dashboard/analytics/page.tsx`

**Interfaces — Consumes:** the hooks (Task 6), derive (Task 3/4), View (Task 9). **Produces:** `<OperatorAnalytics/>` (gate → data) + the route page.

- [ ] **Step 1: Implement `OperatorAnalytics.tsx`** (gate + data, single file like Payments)

```tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { EmptyState } from "@/components/ui/empty-state";
import { InsightsPanel } from "./InsightsPanel";
import { OperatorAnalyticsView } from "./OperatorAnalyticsView";
import { buildKpis, buildCsvRows } from "./deriveAnalytics";
import { deriveInsights } from "./deriveInsights";
import {
  useAnalyticsRange, useAnalyticsSummary, useAnalyticsRevenueSeries, useAnalyticsServiceMix,
  useAnalyticsLeaderboard, useAnalyticsDemand, useAnalyticsCancellations,
} from "@/hooks/useAnalytics";

export function OperatorAnalytics() {
  const { currentOrgRole } = useAuth();
  const { permissions, loading: permsLoading } = useManagerPermissions();
  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canView = privileged || !!permissions?.can_view_analytics;
  const canMoney = privileged || !!permissions?.can_view_payments;

  if (!privileged && permsLoading) {
    return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!canView) {
    return <div className="grid min-h-[40vh] place-items-center"><EmptyState icon={<ShieldAlert />} title="You do not have access to analytics" description="Ask an owner or admin to grant you the analytics permission." /></div>;
  }
  return <OperatorAnalyticsData canMoney={canMoney} />;
}

function OperatorAnalyticsData({ canMoney }: { canMoney: boolean }) {
  const { range, setPreset } = useAnalyticsRange();
  const { summary } = useAnalyticsSummary(range);
  const { series } = useAnalyticsRevenueSeries(range);
  const { rows: serviceMix } = useAnalyticsServiceMix(range);
  const { rows: leaderboard } = useAnalyticsLeaderboard(range);
  const { cells: demand } = useAnalyticsDemand(range);
  const { data: cancellations } = useAnalyticsCancellations(range);

  // animate ONCE on first mount; realtime refetch must not redraw.
  const [animate, setAnimate] = useState(true);
  const mounted = useRef(false);
  useEffect(() => { if (mounted.current) return; mounted.current = true; const t = setTimeout(() => setAnimate(false), 1200); return () => clearTimeout(t); }, []);

  const kpis = useMemo(() => (summary ? buildKpis(summary, series, canMoney) : []), [summary, series, canMoney]);
  const insights = useMemo(() => (summary && cancellations ? deriveInsights({ summary, serviceMix, leaderboard, cancellations }) : []), [summary, serviceMix, leaderboard, cancellations]);
  const runRateSpark = useMemo(() => series.map((p) => (p.collectedCents ?? 0) / 100), [series]);

  const onExport = () => {
    const rows = buildCsvRows(series);
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `analytics-${range.rangeKey}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <OperatorAnalyticsView
      preset={range.preset} onPresetChange={setPreset} kpis={kpis} summary={summary} series={series}
      runRateSpark={runRateSpark} serviceMix={serviceMix} leaderboard={leaderboard} demand={demand}
      cancellations={cancellations} insightsSlot={<InsightsPanel insights={insights} />} animate={animate}
      onExport={canMoney ? onExport : undefined}
    />
  );
}
```

- [ ] **Step 2: Implement the live route** (copy the Payments route page verbatim, swap names + `active="analytics"`)

```tsx
"use client";
import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorAnalytics } from "@/components/redesign/analytics/OperatorAnalytics";

function Spinner() {
  return <div className="grid min-h-screen place-items-center bg-background"><div className="text-center"><Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-brand-600" /><p className="text-muted-foreground">Loading...</p></div></div>;
}
function OperatorAnalyticsInner() {
  const router = useRouter();
  const { user, loading, orgStatus, reloadOrganization } = useAuth();
  useEffect(() => { if (!loading && !user) router.push("/login"); }, [user, loading, router]);
  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <Spinner />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;
  const goNewBooking = () => router.push("/admin-dashboard?tab=bookings");
  return <OperatorShell active="analytics" onNewBooking={goNewBooking}><OperatorAnalytics /></OperatorShell>;
}
export default function OperatorAnalyticsPage() {
  return <Suspense fallback={<Spinner />}><OperatorAnalyticsInner /></Suspense>;
}
```

- [ ] **Step 3: Verify against dev Supabase (logged in)**

Run dev server; log in as an admin; open `http://localhost:3100/app/admin-dashboard/analytics`. Confirm real data renders, range presets refetch, money hidden path works (test with a manager lacking `can_view_payments` if available). Screenshot desktop + mobile via Playwright MCP.
Expected: live cockpit matches the preview; switching range updates the URL `?range=` and refetches.

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/analytics/OperatorAnalytics.tsx "src/app/(redesign)/app/admin-dashboard/analytics/page.tsx"
git commit -m "feat(analytics): permission gate + data container + live route"
```

---

### Task 11: Motion pass — entrance stagger + sliding pill + draw-once

**Files:**
- Modify: `src/components/redesign/analytics/OperatorAnalyticsView.tsx`
- Modify: `src/components/redesign/analytics/AnalyticsRangeControl.tsx` (sliding pill)

**Interfaces:** no signature changes; purely additive motion. Wrap the View body in `<MotionConfig reducedMotion="user">` and stagger sections; add a Motion `layoutId` pill to the range control.

- [ ] **Step 1: Wrap the View in MotionConfig + stagger sections**

In `OperatorAnalyticsView.tsx`, import `{ MotionConfig, motion }` from `motion/react`, wrap the outer `<div>` content in `<MotionConfig reducedMotion="user">`, and convert each `<Section>` wrapper to a `motion.section` with:
```tsx
initial={{ opacity: 0, y: 10 }}
whileInView={{ opacity: 1, y: 0 }}
viewport={{ once: true, margin: "-80px" }}
transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
```
(KPI rail gets the same on mount with `animate` instead of `whileInView`.)

- [ ] **Step 2: Add the sliding pill to the range control**

Replace `AnalyticsRangeControl` body with a Motion shared-layout pill:
```tsx
"use client";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import type { RangePreset } from "./analytics-types";
const OPTS: { value: RangePreset; label: string }[] = [{ value: "7d", label: "7D" }, { value: "30d", label: "30D" }, { value: "90d", label: "90D" }, { value: "12m", label: "12M" }];
export function AnalyticsRangeControl({ preset, onChange }: { preset: RangePreset; onChange: (p: RangePreset) => void }) {
  return (
    <div className="inline-flex rounded-pill border border-border bg-card p-1 shadow-soft-sm">
      {OPTS.map((o) => {
        const active = o.value === preset;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} className={cn("relative rounded-pill px-3.5 py-1.5 text-sm font-semibold", active ? "text-white" : "text-muted-foreground hover:text-foreground")}>
            {active ? <motion.span layoutId="range-pill" className="absolute inset-0 rounded-pill bg-brand-600" style={{ zIndex: -1 }} transition={{ type: "spring", stiffness: 400, damping: 32 }} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Verify motion + reduced-motion**

Run dev; reload `/analytics-preview`: KPI numbers roll up once, charts draw once, sections fade-rise once, range pill slides. Toggle OS "reduce motion" and confirm animations collapse (NumberFlow + recharts self-gate; MotionConfig drops transforms). Reload after a simulated refetch (switch range back and forth) and confirm charts do NOT re-draw once `animate` is false.
Expected: smooth first paint; static on refetch; reduced-motion honored.

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/analytics/OperatorAnalyticsView.tsx src/components/redesign/analytics/AnalyticsRangeControl.tsx
git commit -m "feat(analytics): motion pass (stagger, draw-once, sliding range pill)"
```

---

### Task 12: RPC authorization integration test

**Files:**
- Create: `src/lib/analytics/__tests__/analytics_rpcs.integration.test.ts`

**Interfaces — Consumes:** `tests/helpers/{supabase,db,fixtures}`. Asserts the §3/§6 security contract. Use the `create-tests` skill conventions.

- [ ] **Step 1: Write the integration test**

```typescript
import { describe, expect, it, beforeAll } from "vitest";
import { createTestSupabaseClient } from "@/../tests/helpers/supabase";
import { withTestOrg } from "@/../tests/helpers/fixtures";

// Requires `npx supabase start` + .env.test.local (see CLAUDE.md "Running tests").
describe("analytics RPC authorization", () => {
  it("non-member gets null/empty", async () => {
    const { orgId, asOutsider } = await withTestOrg();
    const { data } = await asOutsider.rpc("analytics_summary", { p_org_id: orgId, p_start: "2026-01-01", p_end: "2026-02-01" });
    expect(data).toBeNull();
  });

  it("manager without can_view_analytics gets null", async () => {
    const { orgId, asManager } = await withTestOrg({ manager: { can_view_analytics: false } });
    const { data } = await asManager.rpc("analytics_summary", { p_org_id: orgId, p_start: "2026-01-01", p_end: "2026-02-01" });
    expect(data).toBeNull();
  });

  it("manager with analytics but not payments sees jobs but null money", async () => {
    const { orgId, asManager } = await withTestOrg({ manager: { can_view_analytics: true, can_view_payments: false } });
    const { data } = await asManager.rpc("analytics_summary", { p_org_id: orgId, p_start: "2026-01-01", p_end: "2026-02-01" });
    expect(data).not.toBeNull();
    expect(data.revenueCents).toBeNull();
    expect(typeof data.jobsTotal).toBe("number");
  });

  it("owner sees money + leaderboard is org-scoped", async () => {
    const { orgId, otherOrgId, asOwner } = await withTestOrg();
    const { data: lb } = await asOwner.rpc("analytics_cleaner_leaderboard", { p_org_id: orgId, p_start: "2026-01-01", p_end: "2030-01-01" });
    const { data: other } = await asOwner.rpc("analytics_cleaner_leaderboard", { p_org_id: otherOrgId, p_start: "2026-01-01", p_end: "2030-01-01" });
    expect(Array.isArray(lb)).toBe(true);
    expect(other).toEqual([]); // owner of org A cannot read org B
  });
});
```

> If `withTestOrg` does not yet support `manager`/`asOutsider`/`otherOrgId` options, extend the helper (`tests/helpers/fixtures.ts`) minimally to seed a second org, a manager member, and a manager_permissions row. Keep the extension generic.

- [ ] **Step 2: Run it**

Run: `npx supabase start` (if not running), then `npm run test:integration -- analytics_rpcs`
Expected: PASS (4 cases). If `withTestOrg` lacks options, implement them first, then re-run.

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics/__tests__/analytics_rpcs.integration.test.ts tests/helpers/fixtures.ts
git commit -m "test(analytics): RPC authz + org-scope integration tests"
```

---

### Task 13: Repoint nav + full verification + Codex review

**Files:**
- Modify: `src/components/redesign/shell/nav-items.ts`

- [ ] **Step 1: Repoint the analytics nav href**

In `nav-items.ts`, change the analytics entry:
```typescript
  { id: "analytics", label: "Analytics", href: "/app/admin-dashboard/analytics", icon: BarChart3 },
```
(`OperatorShell.deriveActive` longest-prefix already resolves `/analytics` to the `analytics` id.)

- [ ] **Step 2: Run all CI gates**

Run: `npm run test`
Expected: all tests PASS (new derive + integration green).
Run: `npx tsc --noEmit`
Expected: no NEW errors in analytics files (pre-existing CVA noise excepted).
Run: `npm run lint`
Expected: clean for new files.

- [ ] **Step 3: Logged-in Playwright verification (dev Supabase)**

Open `/app/admin-dashboard/analytics` as admin; click the Analytics nav item from another screen and confirm it lands here (not legacy); verify range switching, export download, mobile layout, and the manager-without-payments path. Screenshot-match `shot-final.png`.

- [ ] **Step 4: Codex pre-push review, apply valid findings, commit**

Run: `node "<codex-plugin>/scripts/codex-companion.mjs" review --scope branch --base master` (resolve the plugin path at runtime).
Apply valid findings only; commit as a separate `fix: address Codex review` commit.

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feat/redesign-operator-analytics
```
Open a PR to `master`; ensure CI / E2E / Migrate checks pass; merge after green.

---

## Self-Review

**Spec coverage:** §2 insights → Tasks 7-9 (every card has a component + a View slot); §3 RPCs → Task 1; §4 architecture (Container/Data/View/derive/types/presenters/charts/route/preview) → Tasks 2-10; §5 motion → Task 11; §6 gating → Task 1 (server) + Task 10 (client); §7 range/compare/export/realtime → Tasks 3/6/10 (realtime invalidation is covered by the shared `useSupabaseRealtimeSync` consumers; analytics keys invalidate via the standard appointments/payments subscriptions already wired in `useAdminData` — if a dedicated subscription is wanted, add it in Task 10 Step 1 as a `useSupabaseRealtimeSync({ type: 'invalidate', keys: [keys.analytics.all] })`); §8 mobile → Task 9 Step 3 + responsive grids; §9 testing → Tasks 3,4,12. **No gaps.**

**Placeholder scan:** all code steps contain full code; SQL is complete; the one runtime caveat (does `useOrgQuery` auto-substitute orgId into the key) is called out with the concrete fallback (pass `currentOrganizationId` like the Payments hooks). No "TBD"/"handle edge cases".

**Type consistency:** `AnalyticsSummary`, `Kpi`, `TimeseriesPoint`, `ServiceMixRow`, `LeaderRow`, `DemandCell`, `CancellationsData`, `InsightVM`, `RangePreset`, `ResolvedRange` are defined once in Task 2 and used verbatim in Tasks 3-10. `buildKpis`/`bucketAging`/`normalizeHeatmap`/`resolveRange`/`deriveInsights`/`buildCsvRows` names match across producer (Task 3/4) and consumers (Tasks 9/10). RPC names match between Task 1 (SQL) and Task 6 (hooks).

**One open verification (flagged, not a gap):** confirm at build time that `useOrgQuery`'s key-substitution behavior matches the Payments hooks; adjust the `keys.analytics.*("", ...)` calls if it requires the resolved org id inline.
