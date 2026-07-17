-- 110_platform_stats_rpc.sql
-- Platform-owner overview metrics in a single round trip.
--
-- SECURITY DEFINER so it can aggregate across every tenant (a platform admin is
-- not a member of any org, so RLS can't serve this). Authorization is enforced
-- upstream at the route (requirePlatformAdmin); the function has no auth.uid()
-- context because it is called by the service role. As defense-in-depth, EXECUTE
-- is revoked from the API roles and granted only to service_role, so a stray
-- authenticated caller cannot read platform-wide money.
--
-- Money is returned in integer cents: payments.amount is dollars numeric(10,2)
-- (x100), application_fees.amount / refunded_amount are already cents (bigint).

create or replace function public.platform_stats()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'tenants',
      (select count(*) from organizations),
    'active_plans',
      (select count(*) from organizations where subscription_status = 'active'),
    'trialing',
      (select count(*) from organizations where subscription_status = 'trialing'),
    'payments_ready',
      (select count(*) from organizations
         where stripe_connect_charges_enabled and stripe_connect_payouts_enabled),
    'platform_fees_cents',
      (select (coalesce(sum(amount), 0) - coalesce(sum(refunded_amount), 0))::bigint
         from application_fees),
    'gmv_cents',
      (select coalesce(round(sum(amount) * 100), 0)::bigint
         from payments where status = 'paid' and payment_type = 'revenue'),
    'total_appointments',
      (select count(*) from appointments),
    'new_tenants_30d',
      (select count(*) from organizations where created_at > now() - interval '30 days')
  );
$$;

revoke execute on function public.platform_stats() from public;
revoke execute on function public.platform_stats() from anon;
revoke execute on function public.platform_stats() from authenticated;
grant execute on function public.platform_stats() to service_role;
