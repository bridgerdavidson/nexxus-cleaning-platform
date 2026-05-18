-- Migration: 049_dashboard_rpcs.sql
-- Adds Postgres RPCs that collapse the per-tab "stats waterfall" hooks into a
-- single round trip. Replaces (in order):
--   * useAdminStats        — 8 sequential count/SUM queries
--   * useCleanerStats      — 6 sequential count/SUM queries
--   * usePaymentStats      — 3 sequential aggregate queries
--   * useAdminCustomers    — 4 parallel queries + lossy client-side merge
--
-- Each RPC is `security invoker` so existing RLS policies still apply — the
-- caller's permissions decide what they see. Test against a non-admin role
-- before merging.

-- ============================================================================
-- admin_dashboard_stats(p_org_id uuid) -> jsonb
-- ============================================================================
create or replace function public.admin_dashboard_stats(p_org_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total_bookings bigint;
  v_active_cleaners bigint;
  v_pending_approvals bigint;
  v_completed_jobs bigint;
  v_total_revenue numeric;
  v_avg_rating numeric;
  v_recent_jobs bigint;
begin
  select count(*) into v_total_bookings
    from appointments where organization_id = p_org_id;

  select count(*) into v_active_cleaners
    from cleaner_profiles where organization_id = p_org_id and is_available = true;

  select count(*) into v_pending_approvals
    from appointments where organization_id = p_org_id and status = 'pending';

  select count(*) into v_completed_jobs
    from appointments where organization_id = p_org_id and status = 'completed';

  select coalesce(sum(amount), 0) into v_total_revenue
    from payments where organization_id = p_org_id and status = 'paid';

  select coalesce(avg(rating), 0) into v_avg_rating
    from reviews where organization_id = p_org_id;

  select count(*) into v_recent_jobs
    from appointments
    where organization_id = p_org_id
      and created_at >= (now() - interval '30 days');

  return jsonb_build_object(
    'totalBookings', v_total_bookings,
    'activeCleaners', v_active_cleaners,
    'pendingApprovals', v_pending_approvals,
    'completedJobs', v_completed_jobs,
    'totalRevenue', v_total_revenue,
    'avgRating', round(v_avg_rating::numeric, 1),
    'recentJobs', v_recent_jobs,
    'completionRate', case
      when v_total_bookings = 0 then 0
      else round((v_completed_jobs::numeric / v_total_bookings) * 100, 1)
    end,
    'avgJobsPerDay', round(v_recent_jobs::numeric / 30, 1),
    'avgJobValue', case
      when v_total_bookings = 0 then 0
      else round(v_total_revenue / v_total_bookings)
    end
  );
end;
$$;

grant execute on function public.admin_dashboard_stats(uuid) to authenticated;

-- ============================================================================
-- cleaner_stats(p_cleaner_id uuid, p_org_id uuid) -> jsonb
-- ============================================================================
-- Returns counters for a single cleaner. Note: `cleaner_profiles.id` IS the
-- user's auth.users.id (per CLAUDE.md), so p_cleaner_id == auth.uid() for the
-- cleaner viewing their own dashboard. RLS still scopes the join.
create or replace function public.cleaner_stats(p_cleaner_id uuid, p_org_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_payout_percent numeric;
  v_total_jobs bigint;
  v_completed_jobs bigint;
  v_upcoming_jobs bigint;
  v_completed_this_week bigint;
  v_total_earnings_gross numeric;
  v_paid_amount numeric;
  v_cleaner_earnings numeric;
begin
  select coalesce(payout_percent, 0) into v_payout_percent
    from cleaner_profiles
    where id = p_cleaner_id and organization_id = p_org_id;

  if not found then
    raise exception 'cleaner profile not found' using errcode = 'PGRST116';
  end if;

  select count(*) into v_total_jobs
    from appointments
    where cleaner_id = p_cleaner_id and organization_id = p_org_id;

  select count(*) into v_completed_jobs
    from appointments
    where cleaner_id = p_cleaner_id and organization_id = p_org_id and status = 'completed';

  select count(*) into v_upcoming_jobs
    from appointments
    where cleaner_id = p_cleaner_id and organization_id = p_org_id
      and status in ('pending', 'confirmed', 'in_progress');

  select count(*) into v_completed_this_week
    from appointments
    where cleaner_id = p_cleaner_id and organization_id = p_org_id
      and status = 'completed'
      and scheduled_date >= (current_date - interval '7 days');

  select coalesce(sum(total_price), 0) into v_total_earnings_gross
    from appointments
    where cleaner_id = p_cleaner_id and organization_id = p_org_id and status = 'completed';

  v_cleaner_earnings := v_total_earnings_gross * (v_payout_percent / 100.0);

  select coalesce(sum(p.amount), 0) into v_paid_amount
    from payments p
    join appointments a on a.id = p.appointment_id
    where a.cleaner_id = p_cleaner_id
      and a.organization_id = p_org_id
      and a.status = 'completed'
      and p.status = 'paid';

  return jsonb_build_object(
    'totalJobs', v_total_jobs,
    'completedJobs', v_completed_jobs,
    'upcomingJobs', v_upcoming_jobs,
    'completedThisWeek', v_completed_this_week,
    'totalEarnings', round(v_cleaner_earnings),
    'pendingPayouts', round(greatest(0, v_cleaner_earnings - v_paid_amount))
  );
end;
$$;

grant execute on function public.cleaner_stats(uuid, uuid) to authenticated;

-- ============================================================================
-- payment_stats(p_org_id uuid) -> jsonb
-- ============================================================================
create or replace function public.payment_stats(p_org_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total_revenue numeric;
  v_pending_payouts numeric;
  v_this_month_revenue numeric;
  v_first_of_month timestamptz := date_trunc('month', now());
begin
  select coalesce(sum(amount), 0) into v_total_revenue
    from payments
    where organization_id = p_org_id
      and status = 'paid'
      and payment_type = 'revenue';

  select coalesce(sum(amount), 0) into v_pending_payouts
    from payouts
    where organization_id = p_org_id and status = 'pending';

  select coalesce(sum(amount), 0) into v_this_month_revenue
    from payments
    where organization_id = p_org_id
      and status = 'paid'
      and payment_type = 'revenue'
      and created_at >= v_first_of_month;

  return jsonb_build_object(
    'totalRevenue', round(v_total_revenue),
    'pendingPayouts', round(v_pending_payouts),
    'thisMonthRevenue', round(v_this_month_revenue)
  );
end;
$$;

grant execute on function public.payment_stats(uuid) to authenticated;

-- ============================================================================
-- org_customers_with_counts(p_org_id uuid) -> table
-- ============================================================================
-- Replaces useAdminCustomers's "fetch members + profiles + properties +
-- appointments separately, then merge in JS" pattern. The merge was lossy in
-- some shapes (no LEFT JOIN semantics), so this is also a correctness fix.
create or replace function public.org_customers_with_counts(p_org_id uuid)
returns table (
  id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  avatar_url text,
  created_at timestamptz,
  updated_at timestamptz,
  properties_count bigint,
  appointments_count bigint,
  total_spent numeric,
  last_appointment_date date
)
language sql
security invoker
set search_path = public
as $$
  with homeowners as (
    select om.user_id
    from organization_members om
    where om.organization_id = p_org_id
      and om.role = 'homeowner'
  )
  select
    up.id,
    up.first_name,
    up.last_name,
    up.email,
    up.phone,
    up.avatar_url,
    up.created_at,
    up.updated_at,
    coalesce(p.cnt, 0) as properties_count,
    coalesce(a.cnt, 0) as appointments_count,
    coalesce(a.total_spent, 0) as total_spent,
    a.last_date as last_appointment_date
  from homeowners h
  join user_profiles up on up.id = h.user_id
  left join (
    select owner_id, count(*) as cnt
    from properties
    where organization_id = p_org_id
    group by owner_id
  ) p on p.owner_id = up.id
  left join (
    select
      homeowner_id,
      count(*) as cnt,
      sum(total_price) as total_spent,
      max(scheduled_date) as last_date
    from appointments
    where organization_id = p_org_id
    group by homeowner_id
  ) a on a.homeowner_id = up.id
  order by up.created_at desc;
$$;

grant execute on function public.org_customers_with_counts(uuid) to authenticated;
