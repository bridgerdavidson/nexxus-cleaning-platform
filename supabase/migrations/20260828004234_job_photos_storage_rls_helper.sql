-- job_photos_storage_rls_helper
--
-- Production incident 2026-08-27: every cleaner job-photo upload failed with
-- `new row violates row-level security policy for table "objects"`. Thirty
-- consecutive attempts, HTTP 400 on all of them, zero photos attached, and the
-- job stranded at the before_photos gate.
--
-- ROOT CAUSE
-- The `job-photos` storage.objects policies (original migration 038, now in
-- migrations-archive/) authorize an upload with a RAW subquery:
--     EXISTS (SELECT 1 FROM appointments
--              WHERE id = split_part(name,'/',2)::uuid AND cleaner_id = auth.uid())
-- A policy subquery evaluates the referenced table's OWN policies, so that read
-- of `appointments` runs under the caller's RLS. Migration
-- 20260801042122_cleaner_price_readpath_seal removed the cleaner arm from
-- `appointments_select`, so a cleaner now sees zero appointment rows, the
-- EXISTS is false, and the INSERT is refused for every file.
--
-- That seal migration states the invariant in its own header: every dependent
-- policy must switch to a SECURITY DEFINER helper BEFORE the cleaner's SELECT
-- arm is removed. It converted the public-schema dependents, including the
-- `job_photos` TABLE, and missed these because storage.objects lives in the
-- `storage` schema and is not captured by the public-only baseline dump (see
-- supabase/BASELINE.md and the same note in migration 079).
--
-- Net effect for 26 days: a cleaner could still SEE job photos (table policy
-- converted, works) but could not ADD one (storage policy not converted).
--
-- WHAT THIS DOES
-- 1. Re-declares the bucket idempotently so `supabase db reset` reproduces it
--    locally and in CI. It previously existed only because archived migration
--    038 ran before the baseline was taken, which is why no test could ever
--    have caught this.
-- 2. Rewrites the INSERT and DELETE policies onto public.is_assigned_cleaner(),
--    exactly as the seal did for the job_photos table. Access semantics are
--    unchanged: the assigned cleaner, and only the assigned cleaner, may write.
-- 3. Re-declares the public SELECT policy unchanged, so a fresh environment
--    gets all three.
--
-- NOT IN SCOPE: no operator/admin upload arm is added. The pre-incident
-- behavior was cleaner-only writes and this migration restores exactly that.
-- Letting org staff attach photos on a cleaner's behalf is a product decision,
-- tracked separately.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Bucket (idempotent; pre-existing in dev/prod, missing on a fresh reset)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'job-photos',
  'job-photos',
  true,
  10485760, -- 10 MB per file; the client compresses to <= 2 MB before upload
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Policies, via the SECURITY DEFINER helper
--    Path convention: appointments/{appointmentId}/{before|after|during}/{uuid}.jpg
--    so split_part(name,'/',2) is the appointment id.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Cleaners can upload job photos for own appointments" ON storage.objects;
CREATE POLICY "Cleaners can upload job photos for own appointments"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'job-photos'
    AND public.is_assigned_cleaner((split_part(storage.objects.name, '/', 2))::uuid)
  );

DROP POLICY IF EXISTS "Cleaners can delete own job photos" ON storage.objects;
CREATE POLICY "Cleaners can delete own job photos"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND public.is_assigned_cleaner((split_part(storage.objects.name, '/', 2))::uuid)
  );

-- Unchanged; re-declared so a fresh environment gets it too. The bucket is
-- public, so this makes the read intent explicit rather than granting anything.
DROP POLICY IF EXISTS "Anyone can view job photos" ON storage.objects;
CREATE POLICY "Anyone can view job photos"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'job-photos');

COMMIT;
