-- Migration 096: Org toggle for what the cleaner sees on the Complete sheet.
-- Adds:
--   organizations.cleaner_pay_display   text, NOT NULL DEFAULT 'full'
--     'full'        -> cleaner sees the full breakdown (customer charge + cut).
--     'payout_only' -> cleaner sees ONLY their cut (no customer charge, no percentage).
-- A text column (not a boolean) so a future 'cleaner_priced' model can be added
-- with a trivial migration. Idempotent.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS cleaner_pay_display text NOT NULL DEFAULT 'full';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_cleaner_pay_display_chk'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_cleaner_pay_display_chk
      CHECK (cleaner_pay_display IN ('full','payout_only'));
  END IF;
END $$;
