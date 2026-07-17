-- 111: platform fee defaults to 1% (100 bps).
--
-- Why: the platform is merchant of record for Connect (fees.payer = application), so Stripe
-- bills Connect platform fees (active-account, payout volume, verification) against the
-- PLATFORM balance. With platform_fee_bps = 0 the platform retained $0 per job, so those fees
-- drove the live balance negative (reconciled -$4.48 on 2026-07-16). A 1% per-appointment fee,
-- retained out of the tenant remainder (homeowner-paid) or charged on top to the org
-- (self-pay), makes every appointment self-funding.
--
-- Column + check constraint were added in 065. Both statements are idempotent: the default is
-- a plain re-assert, and the backfill matches no rows on a re-run (no org is left at 0).
-- 0 was never a deliberate per-org setting, only the old default, so backfilling every 0 is safe.

ALTER TABLE public.organizations
  ALTER COLUMN platform_fee_bps SET DEFAULT 100;

UPDATE public.organizations
   SET platform_fee_bps = 100
 WHERE platform_fee_bps = 0;
