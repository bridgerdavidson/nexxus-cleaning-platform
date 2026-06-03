-- 077_org_self_pay.sql
-- Organization self-pay — schema groundwork (flag-gated by STRIPE_SELF_PAY_ENABLED).
--
-- Lets an organization (a) own properties with no homeowner attached and
-- (b) pay for a cleaning on ANY property out of its own company card, settling
-- 100% to the cleaner (cleaner cut grossed-up for Stripe fees, no platform fee,
-- no tenant remainder).
--
-- ADDITIVE + idempotent. Two orthogonal axes:
--   • properties.owner_id NULLABLE      → owner_id IS NULL means "org-owned"
--   • appointments.is_self_pay BOOLEAN  → the org pays instead of a homeowner
-- plus the same on recurring_appointment_series, an org-level self-pay Stripe
-- Customer, denormalized is_self_pay flags on payments/payouts for reporting,
-- the properties RLS fix so org-owned (null-owner) rows stay visible to staff,
-- and revenue-stat exclusion of self-pay charges.
--
-- NOTE: payment_type is an existing ENUM {revenue,expense,refund}. We deliberately
-- DO NOT add a 'self_pay' enum value (this repo avoids the non-transactional
-- ALTER TYPE ... ADD VALUE migration pain — see 065). Self-pay charge rows keep
-- payment_type='revenue' and are discriminated by the new is_self_pay boolean,
-- which the revenue stats below exclude.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Property ownership — owner_id becomes nullable. NULL ⇒ org/admin-owned
--    (no homeowner). A homeowner can be attached later by setting owner_id.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.properties ALTER COLUMN owner_id DROP NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Appointments — self-pay flag + nullable homeowner, guarded so a non-self-pay
--    appointment always has a homeowner (only self-pay may omit one).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS is_self_pay boolean NOT NULL DEFAULT false;
ALTER TABLE public.appointments ALTER COLUMN homeowner_id DROP NOT NULL;
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_self_pay_homeowner_chk;
ALTER TABLE public.appointments ADD  CONSTRAINT appointments_self_pay_homeowner_chk
  CHECK (is_self_pay = true OR homeowner_id IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Recurring series — same self-pay flag + nullable homeowner + guard, so
--    org-owned recurring cleanings generate self-pay occurrences.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.recurring_appointment_series ADD COLUMN IF NOT EXISTS is_self_pay boolean NOT NULL DEFAULT false;
ALTER TABLE public.recurring_appointment_series ALTER COLUMN homeowner_id DROP NOT NULL;
ALTER TABLE public.recurring_appointment_series DROP CONSTRAINT IF EXISTS recurring_series_self_pay_homeowner_chk;
ALTER TABLE public.recurring_appointment_series ADD  CONSTRAINT recurring_series_self_pay_homeowner_chk
  CHECK (is_self_pay = true OR homeowner_id IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Organizations — dedicated platform Stripe Customer holding the company card
--    used to fund self-pay cleanings. Kept SEPARATE from stripe_customer_id
--    (which resolves the org for SaaS subscription/invoice webhooks) so the two
--    billing relationships never entangle.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS stripe_self_pay_customer_id text;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_self_pay_customer_id_key
  ON public.organizations (stripe_self_pay_customer_id) WHERE stripe_self_pay_customer_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Reporting denormalization — flag self-pay on the money rows so stats /
--    exports / expense badges need no 3-table join. Written at settle time.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS is_self_pay boolean NOT NULL DEFAULT false;
ALTER TABLE public.payouts  ADD COLUMN IF NOT EXISTS is_self_pay boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Properties RLS — 074's policies gate org-staff access via the owner being a
--    homeowner member, which is false when owner_id IS NULL. Re-create the four
--    consolidated policies with an extra branch: org owner/admin/manager may
--    see+manage org-owned (null-owner) properties in their organization.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "properties_select" ON public.properties;
CREATE POLICY "properties_select" ON public.properties
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = owner_id
    OR EXISTS (
      SELECT 1 FROM public.organization_members om_viewer
      WHERE om_viewer.user_id = (select auth.uid())
        AND om_viewer.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
        AND EXISTS (
          SELECT 1 FROM public.organization_members om_target
          WHERE om_target.user_id = properties.owner_id
            AND om_target.role = 'homeowner'::public.org_role
            AND om_target.organization_id = om_viewer.organization_id
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.appointments
      WHERE appointments.property_id = properties.id
        AND appointments.cleaner_id = (select auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = (select auth.uid())
        AND up.role = ANY (ARRAY['admin'::public.user_role, 'manager'::public.user_role])
    )
    OR public.is_platform_admin((select auth.uid()))
    -- self-pay: org owner/admin/manager can view org-owned (null-owner) properties
    OR (
      properties.owner_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om_self
        WHERE om_self.user_id = (select auth.uid())
          AND om_self.organization_id = properties.organization_id
          AND om_self.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
      )
    )
  );

DROP POLICY IF EXISTS "properties_insert" ON public.properties;
CREATE POLICY "properties_insert" ON public.properties
  FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = owner_id
    OR EXISTS (
      SELECT 1 FROM public.organization_members om_viewer
      WHERE om_viewer.user_id = (select auth.uid())
        AND om_viewer.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
        AND EXISTS (
          SELECT 1 FROM public.organization_members om_target
          WHERE om_target.user_id = properties.owner_id
            AND om_target.role = 'homeowner'::public.org_role
            AND om_target.organization_id = om_viewer.organization_id
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = (select auth.uid())
        AND up.role = 'admin'::public.user_role
    )
    -- self-pay: org owner/admin/manager can create org-owned (null-owner) properties
    OR (
      properties.owner_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om_self
        WHERE om_self.user_id = (select auth.uid())
          AND om_self.organization_id = properties.organization_id
          AND om_self.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
      )
    )
  );

DROP POLICY IF EXISTS "properties_update" ON public.properties;
CREATE POLICY "properties_update" ON public.properties
  FOR UPDATE TO authenticated
  USING (
    (select auth.uid()) = owner_id
    OR EXISTS (
      SELECT 1 FROM public.organization_members om_viewer
      WHERE om_viewer.user_id = (select auth.uid())
        AND om_viewer.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
        AND EXISTS (
          SELECT 1 FROM public.organization_members om_target
          WHERE om_target.user_id = properties.owner_id
            AND om_target.role = 'homeowner'::public.org_role
            AND om_target.organization_id = om_viewer.organization_id
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = (select auth.uid())
        AND up.role = 'admin'::public.user_role
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_members om_owner
      JOIN public.organization_members om_actor
        ON om_actor.organization_id = om_owner.organization_id
      WHERE om_owner.user_id = properties.owner_id
        AND om_actor.user_id = (select auth.uid())
        AND om_actor.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
    )
    -- self-pay: org owner/admin/manager can edit org-owned (null-owner) properties
    -- (this is also what enables "attach a homeowner later" by setting owner_id)
    OR (
      properties.owner_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om_self
        WHERE om_self.user_id = (select auth.uid())
          AND om_self.organization_id = properties.organization_id
          AND om_self.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
      )
    )
  );

DROP POLICY IF EXISTS "properties_delete" ON public.properties;
CREATE POLICY "properties_delete" ON public.properties
  FOR DELETE TO authenticated
  USING (
    (select auth.uid()) = owner_id
    OR EXISTS (
      SELECT 1 FROM public.organization_members om_viewer
      WHERE om_viewer.user_id = (select auth.uid())
        AND om_viewer.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
        AND EXISTS (
          SELECT 1 FROM public.organization_members om_target
          WHERE om_target.user_id = properties.owner_id
            AND om_target.role = 'homeowner'::public.org_role
            AND om_target.organization_id = om_viewer.organization_id
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = (select auth.uid())
        AND up.role = 'admin'::public.user_role
    )
    -- self-pay: org owner/admin/manager can delete org-owned (null-owner) properties
    OR (
      properties.owner_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om_self
        WHERE om_self.user_id = (select auth.uid())
          AND om_self.organization_id = properties.organization_id
          AND om_self.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
      )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Revenue stats — exclude self-pay charges (the org paying its own cleaner is
--    not revenue). Both functions otherwise unchanged; only the revenue sums get
--    an `AND is_self_pay = false` guard. Pending-payout sums are NOT touched —
--    a self-pay cleaner payout is still a real outflow.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."admin_dashboard_stats"("p_org_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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
    from payments where organization_id = p_org_id and status = 'paid' and is_self_pay = false;

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

CREATE OR REPLACE FUNCTION "public"."payment_stats"("p_org_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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
      and payment_type = 'revenue'
      and is_self_pay = false;

  select coalesce(sum(amount), 0) into v_pending_payouts
    from payouts
    where organization_id = p_org_id and status = 'pending';

  select coalesce(sum(amount), 0) into v_this_month_revenue
    from payments
    where organization_id = p_org_id
      and status = 'paid'
      and payment_type = 'revenue'
      and is_self_pay = false
      and created_at >= v_first_of_month;

  return jsonb_build_object(
    'totalRevenue', round(v_total_revenue),
    'pendingPayouts', round(v_pending_payouts),
    'thisMonthRevenue', round(v_this_month_revenue)
  );
end;
$$;

COMMIT;
