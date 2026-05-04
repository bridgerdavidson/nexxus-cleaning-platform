-- Migration: 048_invites_realtime.sql
-- Enables Supabase Realtime broadcasts for the public.invites table so the
-- admin and manager dashboards can react to INSERT/UPDATE/DELETE events
-- without polling. The hook in src/hooks/useInvites.ts already subscribes
-- via supabase.channel(...).on('postgres_changes', ...), but Realtime
-- silently delivers nothing until the table is added to the publication.
--
-- REPLICA IDENTITY FULL is required so UPDATE events broadcast every column
-- (not just the primary key + changed columns). Without it the channel's
-- filter `organization_id=eq.<id>` cannot match UPDATEs that don't touch
-- organization_id, which would break the resend flow (status flips like
-- pending -> superseded -> creating -> pending) and DELETE events.

ALTER PUBLICATION supabase_realtime ADD TABLE public.invites;

ALTER TABLE public.invites REPLICA IDENTITY FULL;
