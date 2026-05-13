-- Migration: 056_realtime_publication_expansion.sql
-- Adds every table the app subscribes to via `useSupabaseRealtimeSync` to the
-- supabase_realtime publication and sets REPLICA IDENTITY FULL on each.
--
-- Background: only `invites` had REPLICA IDENTITY FULL on prod, and a subset
-- of messaging tables were in the publication but `payments` was missing,
-- which made the admin "live payment status" patch silently no-op. Without
-- REPLICA IDENTITY FULL, server-side filters like `organization_id=eq.<id>`
-- cannot match UPDATEs that don't touch the filter column, so UPDATE events
-- silently drop.
--
-- The DO blocks make the `ADD TABLE` idempotent — some envs have tables in
-- the publication already (added out-of-band), and the bare ADD TABLE form
-- errors on duplicates. REPLICA IDENTITY FULL is itself idempotent.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'appointments',
    'payments',
    'service_types',
    'messages',
    'conversations',
    'message_attachments',
    'properties',
    'organization_members',
    'cleaner_profiles',
    'user_profiles',
    'manager_permissions',
    'checklists'
  ]
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION
      WHEN duplicate_object THEN
        -- Already in the publication; nothing to do.
        NULL;
    END;
  END LOOP;
END
$$;

ALTER TABLE public.appointments         REPLICA IDENTITY FULL;
ALTER TABLE public.payments             REPLICA IDENTITY FULL;
ALTER TABLE public.service_types        REPLICA IDENTITY FULL;
ALTER TABLE public.messages             REPLICA IDENTITY FULL;
ALTER TABLE public.conversations        REPLICA IDENTITY FULL;
ALTER TABLE public.message_attachments  REPLICA IDENTITY FULL;
ALTER TABLE public.properties           REPLICA IDENTITY FULL;
ALTER TABLE public.organization_members REPLICA IDENTITY FULL;
ALTER TABLE public.cleaner_profiles     REPLICA IDENTITY FULL;
ALTER TABLE public.user_profiles        REPLICA IDENTITY FULL;
ALTER TABLE public.manager_permissions  REPLICA IDENTITY FULL;
ALTER TABLE public.checklists           REPLICA IDENTITY FULL;
