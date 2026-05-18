-- Migration: 051_invite_form_closed_at.sql
-- Adds form_closed_at to public.invites so mark-expired can distinguish a
-- recipient who genuinely abandoned the form from a re-fetch by a scanner /
-- mail prefetcher / link previewer while the recipient is mid-form. The
-- accept-invite page fires navigator.sendBeacon to set this field on
-- pagehide while in the valid form state. mark-expired's guard becomes
--   (opened_at IS NULL OR form_closed_at IS NOT NULL),
-- preserving the protection added in commit 59cb128 (047 opened_at + the
-- IS NULL guard) while letting genuine close → re-click flip pending →
-- expired so the admin UI updates immediately via realtime.

ALTER TABLE public.invites
  ADD COLUMN IF NOT EXISTS form_closed_at timestamp with time zone NULL;
