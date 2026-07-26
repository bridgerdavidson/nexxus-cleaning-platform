-- Migration 114: cleaner-request pay model (flexible contractor umbrella).
-- Spec: docs/superpowers/specs/2026-07-26-cleaner-request-pay-model-design.md
-- 1) WIDEN the payout-model value space: 'percentage' joins as the new spelling
--    of 'percentage_contractor'; 'flat' and 'request' join as new modes. The
--    constraints are PERMISSIVE (old spelling stays legal) and this migration
--    deliberately does NOT backfill data or flip column defaults: old readers
--    that compare against 'percentage_contractor' keep working until every
--    server/bundle understands both spellings. The backfill + default flip +
--    write-side cutover ship together in migration 115 (PR 2 of this feature).
-- 2) organizations.min_margin_bps  - request-mode auto-approve threshold.
-- 3) cleaner_profiles.flat_rate_cents - flat-per-job mode parameter.
-- 4) pay_requests + pay_request_offers - negotiation thread. Writes are
--    service-role only (no INSERT/UPDATE policies); reads mirror payouts_select
--    but with the ORG-SCOPED manager_permissions join (the 104/106 pattern -
--    a multi-org manager's payment visibility must come from THIS org's row).
-- 5) payouts.pay_request_id + payout_model_snapshot.
-- Idempotent.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1a. organizations.default_payout_model (constraint widening only; no data)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_default_payout_model_chk;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_default_payout_model_chk
  CHECK (default_payout_model IN ('percentage','flat','request','hourly_external','percentage_contractor'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b. cleaner_profiles.payout_model (constraint widening only; no data)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cleaner_profiles DROP CONSTRAINT IF EXISTS cleaner_profiles_payout_model_chk;
ALTER TABLE public.cleaner_profiles ADD CONSTRAINT cleaner_profiles_payout_model_chk
  CHECK (payout_model IN ('percentage','flat','request','hourly_external','percentage_contractor'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Auto-approve threshold: the org must keep at least this share of the job
--    price for a cleaner's pay request to approve automatically.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS min_margin_bps integer NOT NULL DEFAULT 2000;
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_min_margin_bps_chk;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_min_margin_bps_chk
  CHECK (min_margin_bps >= 0 AND min_margin_bps <= 10000);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Flat-per-job rate.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cleaner_profiles
  ADD COLUMN IF NOT EXISTS flat_rate_cents integer;
ALTER TABLE public.cleaner_profiles DROP CONSTRAINT IF EXISTS cleaner_profiles_flat_rate_cents_chk;
ALTER TABLE public.cleaner_profiles ADD CONSTRAINT cleaner_profiles_flat_rate_cents_chk
  CHECK (flat_rate_cents IS NULL OR flat_rate_cents >= 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4a. pay_requests: one negotiation thread per appointment.
--     State machine lives in app code (src/lib/payments/payRequests/).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pay_requests (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES public.organizations(id),
  appointment_id            uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  cleaner_id                uuid NOT NULL REFERENCES public.cleaner_profiles(id) ON DELETE CASCADE,
  status                    text NOT NULL CHECK (status IN ('pending_org','pending_cleaner','approved')),
  job_price_cents_snapshot  integer NOT NULL CHECK (job_price_cents_snapshot >= 0),
  approved_amount_cents     integer CHECK (approved_amount_cents >= 0),
  approved_via              text CHECK (approved_via IN ('auto','org','cleaner_accept')),
  approved_by               uuid,
  approved_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pay_requests_appointment_uniq UNIQUE (appointment_id),
  CONSTRAINT pay_requests_approved_shape CHECK (
    (status = 'approved') = (approved_amount_cents IS NOT NULL AND approved_via IS NOT NULL AND approved_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_pay_requests_org_status ON public.pay_requests (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pay_requests_cleaner    ON public.pay_requests (cleaner_id, status);

-- Keep updated_at honest under the CAS status flips (same convention as
-- refunds/disputes in migration 065).
DROP TRIGGER IF EXISTS pay_requests_set_updated_at ON public.pay_requests;
CREATE TRIGGER pay_requests_set_updated_at BEFORE UPDATE ON public.pay_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.pay_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pay_requests_select ON public.pay_requests;
CREATE POLICY pay_requests_select ON public.pay_requests
  FOR SELECT TO authenticated
  USING (
    cleaner_id = (select auth.uid())
    OR EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = pay_requests.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON om.user_id = mp.manager_id AND mp.organization_id = om.organization_id WHERE om.organization_id = pay_requests.organization_id AND om.user_id = (select auth.uid()) AND om.role = 'manager'::public.org_role AND mp.can_view_payments = true)
    OR public.is_platform_admin((select auth.uid()))
  );
-- No INSERT/UPDATE/DELETE policies: service-role routes only.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4b. pay_request_offers: append-only offer history (cleaner asks, org
--     counters, cleaner counter-backs). min_margin_bps_snapshot records the
--     threshold each CLEANER offer was judged against at that moment.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pay_request_offers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_request_id           uuid NOT NULL REFERENCES public.pay_requests(id) ON DELETE CASCADE,
  actor                    text NOT NULL CHECK (actor IN ('cleaner','org')),
  actor_user_id            uuid NOT NULL,
  amount_cents             integer NOT NULL CHECK (amount_cents >= 0),
  note                     text,
  min_margin_bps_snapshot  integer,
  auto_approved            boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pay_request_offers_request ON public.pay_request_offers (pay_request_id, created_at);

ALTER TABLE public.pay_request_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pay_request_offers_select ON public.pay_request_offers;
CREATE POLICY pay_request_offers_select ON public.pay_request_offers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pay_requests pr
       WHERE pr.id = pay_request_offers.pay_request_id
         AND (
           pr.cleaner_id = (select auth.uid())
           OR EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = pr.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
           OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON om.user_id = mp.manager_id AND mp.organization_id = om.organization_id WHERE om.organization_id = pr.organization_id AND om.user_id = (select auth.uid()) AND om.role = 'manager'::public.org_role AND mp.can_view_payments = true)
           OR public.is_platform_admin((select auth.uid()))
         )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4c. Realtime (org queue badge + cleaner thread views).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pay_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pay_requests;
  END IF;
END $$;
ALTER TABLE public.pay_requests REPLICA IDENTITY FULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. payouts provenance: which mode produced the amount, and which thread.
-- ─────────────────────────────────────────────────────────────────────────────
-- ON DELETE SET NULL so the cleaner-deletion cascade through pay_requests can
-- never violate this reference (the payout row itself cascades via cleaner_id
-- on its own FK, but ordering between the two cascades is not guaranteed).
ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS pay_request_id uuid REFERENCES public.pay_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payout_model_snapshot text;
