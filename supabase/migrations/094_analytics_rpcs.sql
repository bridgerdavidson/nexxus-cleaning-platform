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
