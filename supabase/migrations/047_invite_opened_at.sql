-- Migration: 047_invite_opened_at.sql
-- Adds opened_at to public.invites so we can detect invites where the
-- recipient consumed the magic link, opened the form, but never completed
-- onboarding. Combined with application-level lazy expiry (1h after
-- opened_at, or expiration_date < now), this lets the admin UI accurately
-- reflect that a pending invite is no longer usable.

ALTER TABLE public.invites
  ADD COLUMN IF NOT EXISTS opened_at timestamp with time zone NULL;

CREATE INDEX IF NOT EXISTS idx_invites_pending_expiry_lookup
  ON public.invites (organization_id, status, expiration_date)
  WHERE status = 'pending'::inv_status;
