-- cleaner_pay_configured: make "this cleaner's pay has been set" an explicit fact.
--
-- New cleaners stop inheriting a pay configuration nobody chose (the org
-- "default" stamped percentage/0% at invite acceptance, which reads as a real
-- answer everywhere). Instead of making payout_model nullable — every consumer
-- does `?? 'percentage'`, so a null would silently read as "percentage, 0%" —
-- a NULL payout_configured_at is the unconfigured marker. Named to match the
-- existing organizations.payout_configured_at.

ALTER TABLE public.cleaner_profiles
  ADD COLUMN IF NOT EXISTS payout_configured_at timestamptz;

-- Backfill every existing cleaner as configured: only cleaners created AFTER
-- this migration should ever be unconfigured. Without this, every existing
-- cleaner in every org lights up with a "Pay not set" warning on deploy.
UPDATE public.cleaner_profiles
   SET payout_configured_at = coalesce(created_at, now())
 WHERE payout_configured_at IS NULL;

-- Extend the cleaner_scorecard roster RPC to return the new column so the
-- operator roster/detail can render the unconfigured state. Adding a RETURNS
-- TABLE column requires DROP + CREATE (CREATE OR REPLACE cannot change the OUT
-- parameter list); everything else, including the 093 in-function
-- authorization, is copied unchanged from migration 120.

DROP FUNCTION IF EXISTS public.cleaner_scorecard(uuid);

CREATE FUNCTION public.cleaner_scorecard(p_org_id uuid)
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  avatar_url text,
  payout_percent numeric,
  payout_model text,
  flat_rate_cents integer,
  payout_configured_at timestamptz,
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text;
  v_can_manage boolean := false;
  v_pay boolean := false;
BEGIN
  -- The caller must be a member of this org.
  SELECT om.role INTO v_role
    FROM organization_members om
    WHERE om.organization_id = p_org_id AND om.user_id = auth.uid();
  IF v_role IS NULL THEN
    RETURN; -- not a member: no rows
  END IF;

  IF v_role IN ('owner', 'admin') THEN
    v_can_manage := true;
    v_pay := true;
  ELSIF v_role = 'manager' THEN
    SELECT coalesce(mp.can_manage_cleaners, false), coalesce(mp.can_view_payments, false)
      INTO v_can_manage, v_pay
      FROM manager_permissions mp
      WHERE mp.organization_id = p_org_id AND mp.manager_id = auth.uid();
  END IF;

  IF NOT v_can_manage THEN
    RETURN; -- not allowed to see cleaners: no rows
  END IF;

  RETURN QUERY
  SELECT
    cp.id,
    up.first_name,
    up.last_name,
    up.email,
    up.phone,
    up.avatar_url,
    coalesce(cp.payout_percent, 0)::numeric,
    -- 118 backfilled the legacy spelling, but normalize anyway so a row written
    -- through the 117 deploy window can never surface it to the UI.
    CASE WHEN cp.payout_model = 'percentage_contractor' THEN 'percentage'
         ELSE coalesce(cp.payout_model, 'percentage') END,
    cp.flat_rate_cents,
    cp.payout_configured_at,
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
    -- Earnings + owed are payment data: nulled for callers without payment access.
    -- (Still the percent-based estimate; payout-row-based earnings for flat/request
    -- cleaners is a follow-up.)
    CASE WHEN v_pay THEN
      (SELECT coalesce(sum(a.total_price), 0) FROM appointments a
         WHERE a.cleaner_id = cp.id AND a.organization_id = p_org_id AND a.status = 'completed')
        * coalesce(cp.payout_percent, 0) / 100.0
    ELSE NULL END,
    CASE WHEN v_pay THEN
      (SELECT coalesce(sum(pay.amount), 0) FROM payouts pay
         WHERE pay.cleaner_id = cp.id AND pay.organization_id = p_org_id
           AND pay.status IN ('pending','approved'))
    ELSE NULL END,
    (SELECT count(*) FROM payouts pay
       WHERE pay.cleaner_id = cp.id AND pay.organization_id = p_org_id
         AND pay.status IN ('failed','reversed'))
  FROM cleaner_profiles cp
  JOIN user_profiles up ON up.id = cp.id
  WHERE cp.organization_id = p_org_id
  ORDER BY up.first_name NULLS LAST, up.last_name NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleaner_scorecard(uuid) TO authenticated;
