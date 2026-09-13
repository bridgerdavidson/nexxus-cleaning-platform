-- 20260913032635_saas_billing_phase1.sql
-- Phase 1b: SaaS subscription billing.
--
-- Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md §5.
--
-- Adds the billing columns the paywall derives access from, widens the
-- subscription_status CHECK to carry Stripe's `unpaid` (retries exhausted,
-- which freezes) as distinct from `past_due` (still retrying, which does not),
-- and comps every organization that predates this migration so no pilot tenant
-- can hit a trial wall when enforcement is switched on.
--
-- Idempotent: safe to apply more than once on the shared dev database.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. organizations — billing columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_ends_at             timestamptz,
  ADD COLUMN IF NOT EXISTS trial_extended_at         timestamptz,
  ADD COLUMN IF NOT EXISTS comped_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS plan_tier                 text,
  ADD COLUMN IF NOT EXISTS billing_period            text,
  ADD COLUMN IF NOT EXISTS seat_count                integer,
  ADD COLUMN IF NOT EXISTS subscription_cancel_at    timestamptz,
  ADD COLUMN IF NOT EXISTS billing_paused_at         timestamptz,
  ADD COLUMN IF NOT EXISTS billing_pause_resumes_at  timestamptz;

COMMENT ON COLUMN public.organizations.trial_ends_at IS
  'End of the free trial. Dormant while comped_at is set. "Trial expired" is derived, never stored.';
COMMENT ON COLUMN public.organizations.comped_at IS
  'Non-null = complimentary: no trial clock, no freeze, no seat cap. Doubles as the audit stamp.';
COMMENT ON COLUMN public.organizations.seat_count IS
  'Purchased seats, truthed from Stripe webhooks. Adding or removing a cleaner never changes it.';

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_plan_tier_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_plan_tier_chk
  CHECK (plan_tier IS NULL OR plan_tier IN ('starter','growth','pro'));

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_billing_period_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_billing_period_chk
  CHECK (billing_period IS NULL OR billing_period IN ('monthly','annual'));

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_seat_count_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_seat_count_chk
  CHECK (seat_count IS NULL OR seat_count > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. subscription_status — the CHECK gains 'unpaid'
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_subscription_status_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_subscription_status_chk
  CHECK (subscription_status IN ('none','trialing','active','past_due','unpaid','canceled'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.organizations
   SET subscription_status = 'trialing'
 WHERE subscription_status = 'none';

UPDATE public.organizations
   SET trial_ends_at = now() + interval '14 days'
 WHERE subscription_status = 'trialing'
   AND trial_ends_at IS NULL;

-- Every organization that predates this migration was hand-provisioned for the
-- pilot, so comp it: nothing can freeze on deploy or on the later flag flip.
-- The cutoff is this migration's own version timestamp, so a re-application on
-- the shared dev database never comps an org created after it.
UPDATE public.organizations
   SET comped_at = now()
 WHERE comped_at IS NULL
   AND created_at < '2026-09-13 03:26:35+00';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. platform_tenant_notes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.platform_tenant_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_tenant_notes_org_created_idx
  ON public.platform_tenant_notes (organization_id, created_at DESC);

-- RLS on with no policies: service-role only, through the platform routes.
-- Same posture as platform_audit_log.
ALTER TABLE public.platform_tenant_notes ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. platform_stats() — billing counters
-- ─────────────────────────────────────────────────────────────────────────────
--
-- MRR is deliberately absent: pricing lives in TypeScript (src/lib/billing/plans.ts)
-- and the platform organizations route computes it per org from the catalog.

CREATE OR REPLACE FUNCTION public.platform_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'tenants',
      (SELECT count(*) FROM organizations),
    'active_plans',
      (SELECT count(*) FROM organizations WHERE subscription_status = 'active'),
    'trialing',
      (SELECT count(*) FROM organizations WHERE subscription_status = 'trialing'),
    'payments_ready',
      (SELECT count(*) FROM organizations
         WHERE stripe_connect_charges_enabled AND stripe_connect_payouts_enabled),
    'platform_fees_cents',
      (SELECT (coalesce(sum(amount), 0) - coalesce(sum(refunded_amount), 0))::bigint
         FROM application_fees),
    'gmv_cents',
      (SELECT coalesce(round(sum(amount) * 100), 0)::bigint
         FROM payments WHERE status = 'paid' AND payment_type = 'revenue'),
    'total_appointments',
      (SELECT count(*) FROM appointments),
    'new_tenants_30d',
      (SELECT count(*) FROM organizations WHERE created_at > now() - interval '30 days'),
    'past_due',
      (SELECT count(*) FROM organizations WHERE subscription_status = 'past_due'),
    'unpaid',
      (SELECT count(*) FROM organizations WHERE subscription_status = 'unpaid'),
    'trial_expired',
      (SELECT count(*) FROM organizations
         WHERE comped_at IS NULL
           AND subscription_status = 'trialing'
           AND trial_ends_at IS NOT NULL
           AND trial_ends_at < now()),
    'trial_expiring_7d',
      (SELECT count(*) FROM organizations
         WHERE comped_at IS NULL
           AND subscription_status = 'trialing'
           AND trial_ends_at IS NOT NULL
           AND trial_ends_at >= now()
           AND trial_ends_at < now() + interval '7 days'),
    'comped',
      (SELECT count(*) FROM organizations WHERE comped_at IS NOT NULL),
    'paused',
      (SELECT count(*) FROM organizations WHERE billing_paused_at IS NOT NULL)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.platform_stats() FROM public;
REVOKE EXECUTE ON FUNCTION public.platform_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.platform_stats() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.platform_stats() TO service_role;
