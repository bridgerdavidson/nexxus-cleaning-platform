-- Migration 117: payout-model rename backfill + default flip (phase 2 of the
-- two-step rename started in 116).
--
-- 116 widened the constraints so both spellings are legal and shipped readers
-- that treat 'percentage_contractor' exactly like 'percentage'. Every deployed
-- server/bundle now understands both, so it is safe to converge the data and
-- flip the write side (the profile route's transition write flips to
-- 'percentage' in the same PR as this migration).
--
-- The permissive constraints from 116 deliberately REMAIN permissive: a
-- tightening to drop the legacy spelling is a cheap later cleanup once no
-- pre-117 code exists anywhere (not worth a deploy-window risk now).
-- Idempotent.

UPDATE public.organizations SET default_payout_model = 'percentage'
 WHERE default_payout_model = 'percentage_contractor';
ALTER TABLE public.organizations ALTER COLUMN default_payout_model SET DEFAULT 'percentage';

UPDATE public.cleaner_profiles SET payout_model = 'percentage'
 WHERE payout_model = 'percentage_contractor';
ALTER TABLE public.cleaner_profiles ALTER COLUMN payout_model SET DEFAULT 'percentage';
