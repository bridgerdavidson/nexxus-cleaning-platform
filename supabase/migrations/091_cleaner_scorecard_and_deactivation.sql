-- 091_cleaner_scorecard_and_deactivation.sql
-- Soft-bench column + a set-returning per-cleaner scorecard for the operator
-- "Cleaners & team" screen. SECURITY INVOKER so the caller's RLS still governs
-- visibility (mirrors 049_dashboard_rpcs.sql). Never reads cleaner_profiles.rating
-- or .total_jobs (those columns are never written); derives counts from appointments.

ALTER TABLE public.cleaner_profiles
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

CREATE OR REPLACE FUNCTION public.cleaner_scorecard(p_org_id uuid)
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  avatar_url text,
  payout_percent numeric,
  hourly_rate numeric,
  experience_years integer,
  bio text,
  is_available boolean,
  background_check_verified boolean,
  insurance_verified boolean,
  stripe_connect_account_id text,
  stripe_connect_onboarding_complete boolean,
  deactivated_at timestamptz,
  created_at timestamptz,
  total_jobs bigint,
  completed_jobs bigint,
  cancelled_jobs bigint,
  upcoming_jobs bigint,
  upcoming_this_week bigint,
  completed_this_week bigint,
  cleaner_earnings numeric,
  owed_now numeric,
  payouts_failed_count bigint
)
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT
    cp.id,
    up.first_name,
    up.last_name,
    up.email,
    up.phone,
    up.avatar_url,
    coalesce(cp.payout_percent, 0)::numeric,
    cp.hourly_rate::numeric,
    cp.experience_years,
    cp.bio,
    cp.is_available,
    cp.background_check_verified,
    cp.insurance_verified,
    cp.stripe_connect_account_id,
    cp.stripe_connect_onboarding_complete,
    cp.deactivated_at,
    cp.created_at,
    (SELECT count(*) FROM appointments a
       WHERE a.cleaner_id = cp.id AND a.organization_id = p_org_id),
    (SELECT count(*) FROM appointments a
       WHERE a.cleaner_id = cp.id AND a.organization_id = p_org_id AND a.status = 'completed'),
    (SELECT count(*) FROM appointments a
       WHERE a.cleaner_id = cp.id AND a.organization_id = p_org_id AND a.status = 'cancelled'),
    (SELECT count(*) FROM appointments a
       WHERE a.cleaner_id = cp.id AND a.organization_id = p_org_id
         AND a.status IN ('pending','confirmed','in_progress')),
    (SELECT count(*) FROM appointments a
       WHERE a.cleaner_id = cp.id AND a.organization_id = p_org_id
         AND a.status IN ('pending','confirmed','in_progress')
         AND a.scheduled_date >= current_date
         AND a.scheduled_date < current_date + interval '7 days'),
    (SELECT count(*) FROM appointments a
       WHERE a.cleaner_id = cp.id AND a.organization_id = p_org_id
         AND a.status = 'completed'
         AND a.scheduled_date >= current_date - interval '7 days'),
    (SELECT coalesce(sum(a.total_price), 0) FROM appointments a
       WHERE a.cleaner_id = cp.id AND a.organization_id = p_org_id AND a.status = 'completed')
      * coalesce(cp.payout_percent, 0) / 100.0,
    (SELECT coalesce(sum(pay.amount), 0) FROM payouts pay
       WHERE pay.cleaner_id = cp.id AND pay.status IN ('pending','approved','paid')),
    (SELECT count(*) FROM payouts pay
       WHERE pay.cleaner_id = cp.id AND pay.status IN ('failed','reversed'))
  FROM cleaner_profiles cp
  JOIN user_profiles up ON up.id = cp.id
  WHERE cp.organization_id = p_org_id
  ORDER BY up.first_name NULLS LAST, up.last_name NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.cleaner_scorecard(uuid) TO authenticated;
