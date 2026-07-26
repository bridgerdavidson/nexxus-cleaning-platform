-- T1-11: attempt counters for settlement-transfer idempotency-key rotation.
--
-- The three settlement transfer legs (tenant remainder, cleaner %, self-pay cleaner cut) used
-- FIXED idempotency keys: `tenant-payout-{appt}` / `cleaner-payout-{appt}` /
-- `selfpay-cleaner-{appt}`. Stripe saves the first result for a key REGARDLESS of outcome
-- (success or a business error like balance_insufficient) for at least 24h, so after one failed
-- create every retry (the admin Retry button plus the 15-minute reconcile sweep, ~96 tries/day)
-- just replayed the cached failure until the key aged out: a failed payout stayed locked for a
-- day even after the platform balance was topped up.
--
-- The charge path already solved this with appointments.reauth_count; these counters do the same
-- for transfers. Semantics (enforced in src/lib/payments/settleCleanerPayout.ts and
-- settleSelfPay.ts):
--   * attempt 0 -> the historical unsuffixed key, so keys already spent by in-flight
--     settlements stay valid across the deploy;
--   * bumped ONLY in the transfer-create failure catch (set to attempt+1, not incremented, so a
--     double-catch cannot skip a key);
--   * every rotated create is preceded by an adopt-existing scan of the job's transfer_group,
--     because a rotated key no longer collides with a transfer whose create actually landed but
--     whose response was lost.
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS transfer_attempt integer NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tenant_transfer_attempt integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN payouts.transfer_attempt IS
  'T1-11: idempotency-key rotation counter for the cleaner settlement transfer (0 = unsuffixed legacy key; bumped only after a failed create).';
COMMENT ON COLUMN payments.tenant_transfer_attempt IS
  'T1-11: idempotency-key rotation counter for the tenant remainder transfer (0 = unsuffixed legacy key; bumped only after a failed create).';
