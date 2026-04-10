-- Migration: 046_extend_payout_status_enum.sql
-- Extends the payout_status enum to include bank_paid and reversed states
-- needed by the Stripe Connect payout lifecycle.

ALTER TYPE payout_status ADD VALUE IF NOT EXISTS 'bank_paid';
ALTER TYPE payout_status ADD VALUE IF NOT EXISTS 'reversed';
ALTER TYPE payout_status ADD VALUE IF NOT EXISTS 'approved';
