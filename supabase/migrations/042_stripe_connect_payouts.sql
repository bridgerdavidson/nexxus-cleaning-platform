-- Migration: 042_stripe_connect_payouts.sql
-- Adds Stripe Connect fields and per-cleaner payout percentage to cleaner_profiles.

ALTER TABLE cleaner_profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_connect_onboarding_complete BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_percent DECIMAL(5,2) DEFAULT 0.00;

-- Ensure payout_percent is between 0 and 100
ALTER TABLE cleaner_profiles
  ADD CONSTRAINT cleaner_profiles_payout_percent_range
  CHECK (payout_percent >= 0 AND payout_percent <= 100);

-- Add payout_percent snapshot to the payouts table so historical records
-- are preserved even if the org later changes the cleaner's percentage.
ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS payout_percent_snapshot DECIMAL(5,2);
