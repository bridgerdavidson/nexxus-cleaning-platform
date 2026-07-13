-- 107: Properties workspace (R4) — soft-delete/archive flag + realtime publication.

-- 1. Archive flag. NULL = active; a non-null timestamp = archived (hidden everywhere).
--    A property with any appointment history is archived instead of hard-deleted so
--    completed/cancelled records still resolve their property.
ALTER TABLE "public"."properties" ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;

CREATE INDEX IF NOT EXISTS "idx_properties_archived_at" ON "public"."properties" ("archived_at");

-- 2. Add properties to the realtime publication (guarded so re-running is safe).
--    properties already has REPLICA IDENTITY FULL (000_baseline) but was never added
--    to the publication, so the existing properties:${orgId} subscription never fired.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'properties'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.properties';
  END IF;
END $$;
