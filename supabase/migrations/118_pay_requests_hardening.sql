-- Migration 118: pay-request hardening (PR2 adversarial-review findings).
--
-- 1) current_offer_cents: the LIVE offer amount rides the pay_requests row so
--    every negotiation transition is ONE atomic UPDATE (status + amount
--    together) and approve/accept CAS on (status, updated_at) can never bind
--    to a superseded amount. pay_request_offers becomes pure append-only
--    history whose insert ordering no longer matters for correctness.
--    Status implies whose offer it is: pending_org = the cleaner's ask,
--    pending_cleaner = the org's counter.
--
-- 2) Remove the cleaner's SELECT arm from both RLS policies: the row carries
--    job_price_cents_snapshot, which a request-mode cleaner must never see
--    (the whole point of the model). Cleaners read their threads through
--    service-role API routes that shape the payload (the payout_only
--    charge-projection pattern); org staff keep direct reads for the queue.
--
-- The tables shipped earlier in this same PR and have no prod/dev rows, so no
-- backfill is needed. Idempotent.

ALTER TABLE public.pay_requests
  ADD COLUMN IF NOT EXISTS current_offer_cents integer;
ALTER TABLE public.pay_requests DROP CONSTRAINT IF EXISTS pay_requests_current_offer_chk;
ALTER TABLE public.pay_requests ADD CONSTRAINT pay_requests_current_offer_chk
  CHECK (current_offer_cents IS NULL OR current_offer_cents >= 0);

DROP POLICY IF EXISTS pay_requests_select ON public.pay_requests;
CREATE POLICY pay_requests_select ON public.pay_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = pay_requests.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON om.user_id = mp.manager_id AND mp.organization_id = om.organization_id WHERE om.organization_id = pay_requests.organization_id AND om.user_id = (select auth.uid()) AND om.role = 'manager'::public.org_role AND mp.can_view_payments = true)
    OR public.is_platform_admin((select auth.uid()))
  );

DROP POLICY IF EXISTS pay_request_offers_select ON public.pay_request_offers;
CREATE POLICY pay_request_offers_select ON public.pay_request_offers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pay_requests pr
       WHERE pr.id = pay_request_offers.pay_request_id
         AND (
           EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = pr.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
           OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON om.user_id = mp.manager_id AND mp.organization_id = om.organization_id WHERE om.organization_id = pr.organization_id AND om.user_id = (select auth.uid()) AND om.role = 'manager'::public.org_role AND mp.can_view_payments = true)
           OR public.is_platform_admin((select auth.uid()))
         )
    )
  );
