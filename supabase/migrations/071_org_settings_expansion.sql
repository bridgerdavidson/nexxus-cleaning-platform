-- 071_org_settings_expansion.sql
-- Org-wide configuration that the /settings/* UI surfaces:
--   • default cleaner payout % (applied at cleaner-create time)
--   • IANA timezone + weekly business-hours map (drives availability rules)
--   • no-show fee policy (independent from late-cancel fee, which already exists)
--   • reschedule policy (window + fee)
--
-- ADDITIVE only. Every column has a NOT NULL default so existing rows backfill
-- without a manual UPDATE. CHECK constraints are dropped/recreated so re-applying
-- the migration on a previously-patched DB is idempotent.

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_cleaner_payout_percent numeric(5,2) NOT NULL DEFAULT 50.00,
  ADD COLUMN IF NOT EXISTS timezone                       text         NOT NULL DEFAULT 'America/New_York',
  ADD COLUMN IF NOT EXISTS business_hours                 jsonb        NOT NULL DEFAULT '{
    "mon": {"open": "08:00", "close": "17:00", "closed": false},
    "tue": {"open": "08:00", "close": "17:00", "closed": false},
    "wed": {"open": "08:00", "close": "17:00", "closed": false},
    "thu": {"open": "08:00", "close": "17:00", "closed": false},
    "fri": {"open": "08:00", "close": "17:00", "closed": false},
    "sat": {"open": "09:00", "close": "14:00", "closed": false},
    "sun": {"open": "09:00", "close": "14:00", "closed": true}
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS no_show_fee_type               text         NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS no_show_fee_value              numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reschedule_window_hours        integer      NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS reschedule_fee_type            text         NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS reschedule_fee_value           numeric(10,2) NOT NULL DEFAULT 0;

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_default_cleaner_payout_percent_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_default_cleaner_payout_percent_chk
  CHECK (default_cleaner_payout_percent >= 0 AND default_cleaner_payout_percent <= 100);

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_no_show_fee_type_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_no_show_fee_type_chk
  CHECK (no_show_fee_type IN ('none','flat','percent'));

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_no_show_fee_value_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_no_show_fee_value_chk
  CHECK (no_show_fee_value >= 0 AND (no_show_fee_type <> 'percent' OR no_show_fee_value <= 100));

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_reschedule_window_hours_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_reschedule_window_hours_chk
  CHECK (reschedule_window_hours >= 0 AND reschedule_window_hours <= 720);

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_reschedule_fee_type_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_reschedule_fee_type_chk
  CHECK (reschedule_fee_type IN ('none','flat','percent'));

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_reschedule_fee_value_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_reschedule_fee_value_chk
  CHECK (reschedule_fee_value >= 0 AND (reschedule_fee_type <> 'percent' OR reschedule_fee_value <= 100));

COMMIT;
