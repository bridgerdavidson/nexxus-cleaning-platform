-- 082_payments_processing_fee_and_status.sql
--
-- Supports payer-funded Stripe processing fees and ACH (delayed-settlement) charges.
--
--   1. payment_status gains 'processing' -- an ACH (us_bank_account) charge sits here
--      from initiation until it settles (PaymentIntent processing -> succeeded), up to
--      ~4 business days. Cards never use it (they authorize -> capture -> paid).
--   2. payments.processing_fee_cents -- the Stripe processing fee passed through to the
--      payer (charge = service price + this fee). NULL on legacy rows that did not pass
--      the fee through. Settlement splits on (captured - processing_fee_cents) so the
--      platform nets the service price and never goes negative.
--
-- The card vs bank distinction reuses the existing payment_method enum ('card','ach').

-- 1. new status value. PG15 permits ALTER TYPE ... ADD VALUE inside a transaction as
--    long as the new value is not USED in the same transaction (it is not, here).
ALTER TYPE "public"."payment_status" ADD VALUE IF NOT EXISTS 'processing';

-- 2. processing-fee snapshot (cents), matching the bigint/cents convention of the
--    accounting columns added in migration 065.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS processing_fee_cents bigint;

COMMENT ON COLUMN public.payments.processing_fee_cents IS
  'Stripe processing fee passed through to the payer (charge = service price + this fee). NULL = legacy/no passthrough. Settlement base = captured_amount - processing_fee_cents.';
