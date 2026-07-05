-- supabase/migrations/101_onboarding_flags.sql
-- Onboarding wizard (R4-C): additive nullable flags/markers. No RLS change needed
-- (existing user_profiles_update + org update policies already cover new columns).

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS welcome_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS setup_checklist_dismissed_at timestamptz;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS setup_checklist_dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_configured_at timestamptz,
  ADD COLUMN IF NOT EXISTS hours_policy_configured_at timestamptz;

COMMENT ON COLUMN public.user_profiles.welcome_seen_at IS 'Onboarding: when the user first dismissed/completed the welcome moment.';
COMMENT ON COLUMN public.organizations.payout_configured_at IS 'Onboarding: when the owner first saved cleaner payout settings (a default percent cannot be distinguished from an intentional one).';
COMMENT ON COLUMN public.organizations.hours_policy_configured_at IS 'Onboarding: when the owner first saved business hours / policy.';
