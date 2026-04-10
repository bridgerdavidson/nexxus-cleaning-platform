-- Migration: 045_payout_lifecycle_columns.sql
-- Extends the payouts table with lifecycle tracking for Stripe transfer
-- and bank payout states, enabling accurate cleaner earnings display.

ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS stripe_payout_id TEXT,
  ADD COLUMN IF NOT EXISTS bank_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payouts_cleaner_status
  ON payouts (cleaner_id, status);

CREATE INDEX IF NOT EXISTS idx_payouts_stripe_transfer_id
  ON payouts (stripe_transfer_id)
  WHERE stripe_transfer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payouts_stripe_payout_id
  ON payouts (stripe_payout_id)
  WHERE stripe_payout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payouts_paid_at
  ON payouts (paid_at);
