-- storage_buckets_versioned
--
-- Follow-up to the 2026-08-27 job-photos incident (#267). That bug was a raw
-- `EXISTS (SELECT ... FROM appointments)` inside a storage.objects policy: the
-- subquery runs under the CALLER's RLS, so removing the cleaner's SELECT arm on
-- appointments silently denied every upload. It went unnoticed for 26 days
-- because storage.objects is not in the public-only baseline dump, so
-- `supabase db reset` never created the bucket and no test could reach it.
--
-- This migration closes the same blind spot for the two buckets that were still
-- unversioned, and de-fangs the one whose policy has the same fragile shape.
--
-- AUDIT RESULT (verified against production 2026-08-28, by running a real
-- INSERT as a real writer inside a rolled-back transaction). Nothing else is
-- currently broken: `appointments` was the only table whose cleaner SELECT arm
-- the seal removed, and the other policies read tables their writers can still
-- see (a cleaner sees 0 appointments but 2 properties, 1 conversation, 1 org).
--
--   bucket               cross-table read   versioned before this
--   avatars              none (path-based)  NO   <- fixed here
--   message-attachments  conversations      NO   <- fixed here, + helper
--   property-photos      properties         yes (079)
--   org-branding         organizations      yes (121)
--   job-photos           helper             yes (#267)
--
-- WHAT THIS DOES
-- 1. Re-declares the `avatars` and `message-attachments` buckets and every one
--    of their policies, idempotently, matching production exactly. This is
--    mostly a no-op on dev/prod; the point is that a fresh `db reset` now
--    reproduces them so they are finally reachable from tests and CI.
-- 2. Adds public.is_conversation_participant() and moves the
--    message-attachments write policies onto it. That bucket was the only one
--    carrying BOTH risks: a raw subquery AND no version control. Cleaners are
--    conversation participants, so a future narrowing of `conversations` RLS
--    would have reproduced the job-photos outage one table over, invisibly.
--
-- NOT CHANGED: `avatars` policies compare auth.uid() against the object path
-- and read no other table, so they are immune to this class by construction and
-- are reproduced verbatim. property-photos and org-branding keep their raw
-- subqueries: both are already versioned and therefore reviewable, and
-- property-photos has a three-branch policy not worth reworking without cause.
--
-- Path conventions (see src/lib/image-upload/uploadOne.ts):
--   avatars              users/{userId}/avatar/{uuid}.jpg   -> split_part(name,'/',2)
--   message-attachments  {conversationId}/{uuid}.jpg        -> split_part(name,'/',1)

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Buckets (idempotent; values mirror production)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars', 'avatars', true, 5242880,
     ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
  ('message-attachments', 'message-attachments', true, 10485760,
     ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SECURITY DEFINER helper for conversation membership
--    Mirrors public.is_assigned_cleaner from the price-seal migration.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND ((SELECT auth.uid()) IN (c.participant_1_id, c.participant_2_id))
  );
$$;

COMMENT ON FUNCTION public.is_conversation_participant(uuid) IS
  'SECURITY DEFINER: is the current user one of the two participants on this conversation. Lets the message-attachments storage policies authorize without reading conversations under the caller''s RLS, the failure mode that broke job-photos uploads in #267.';

REVOKE ALL ON FUNCTION public.is_conversation_participant(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_conversation_participant(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. avatars policies (reproduced verbatim; path-based, no cross-table read)
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
CREATE POLICY "Users can upload own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (auth.uid())::text = split_part(name, '/', 2)
  );

DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
CREATE POLICY "Users can update own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (auth.uid())::text = split_part(name, '/', 2)
  );

DROP POLICY IF EXISTS "Users can delete own avatar" ON storage.objects;
CREATE POLICY "Users can delete own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (auth.uid())::text = split_part(name, '/', 2)
  );

DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;
CREATE POLICY "Anyone can view avatars"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'avatars');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. message-attachments policies, now via the helper
--    Same access as before: the two conversation participants, nobody else.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Participants can upload message attachments" ON storage.objects;
CREATE POLICY "Participants can upload message attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'message-attachments'
    AND public.is_conversation_participant((split_part(storage.objects.name, '/', 1))::uuid)
  );

DROP POLICY IF EXISTS "Participants can delete message attachments" ON storage.objects;
CREATE POLICY "Participants can delete message attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'message-attachments'
    AND public.is_conversation_participant((split_part(storage.objects.name, '/', 1))::uuid)
  );

DROP POLICY IF EXISTS "Anyone can view message attachments" ON storage.objects;
CREATE POLICY "Anyone can view message attachments"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'message-attachments');

COMMIT;
