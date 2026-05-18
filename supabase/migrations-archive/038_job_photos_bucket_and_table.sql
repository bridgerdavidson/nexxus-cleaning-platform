-- Migration: Create job_photos storage bucket and database table
-- Enables cleaners to upload before/after evidence photos for appointments

-- ============================================================================
-- PART 1: Create job-photos storage bucket
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'job-photos',
  'job-photos',
  true,
  10485760, -- 10 MB per file
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- PART 2: Storage RLS policies
-- Path convention: appointments/{appointmentId}/{before|after}/{uuid}.jpg
-- ============================================================================

-- Cleaners can upload photos for their assigned appointments only
CREATE POLICY "Cleaners can upload job photos for own appointments"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'job-photos'
    AND EXISTS (
      SELECT 1 FROM appointments
      WHERE id = (split_part(name, '/', 2))::uuid
        AND cleaner_id = auth.uid()
    )
  );

-- Public read for evidence retrieval (bucket is public, policy makes intent explicit)
CREATE POLICY "Anyone can view job photos"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'job-photos');

-- Cleaners can delete their own job photos
CREATE POLICY "Cleaners can delete own job photos"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND EXISTS (
      SELECT 1 FROM appointments
      WHERE id = (split_part(name, '/', 2))::uuid
        AND cleaner_id = auth.uid()
    )
  );

-- ============================================================================
-- PART 3: Create job_photos table
-- ============================================================================

CREATE TABLE IF NOT EXISTS job_photos (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid        NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  photo_url      text        NOT NULL,
  photo_type     text        NOT NULL CHECK (photo_type IN ('before', 'after', 'during')),
  uploaded_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- PART 4: Indexes for efficient querying
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_job_photos_appointment_id
  ON job_photos(appointment_id);

CREATE INDEX IF NOT EXISTS idx_job_photos_appointment_type
  ON job_photos(appointment_id, photo_type);

-- ============================================================================
-- PART 5: Row Level Security on job_photos
-- ============================================================================

ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;

-- Cleaners can SELECT photos for their own appointments
CREATE POLICY "Cleaners can view own appointment photos"
  ON job_photos
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM appointments
      WHERE id = job_photos.appointment_id
        AND cleaner_id = auth.uid()
    )
  );

-- Cleaners can INSERT photos for their own appointments
CREATE POLICY "Cleaners can insert own appointment photos"
  ON job_photos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM appointments
      WHERE id = appointment_id
        AND cleaner_id = auth.uid()
    )
  );

-- Managers and admins can SELECT any photo within their organization's appointments
CREATE POLICY "Managers can view all job photos in their org"
  ON job_photos
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM appointments a
      JOIN organization_members om ON om.organization_id = a.organization_id
      WHERE a.id = job_photos.appointment_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager')
    )
  );

-- Homeowners can view photos for their own appointments
CREATE POLICY "Homeowners can view photos for their appointments"
  ON job_photos
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM appointments
      WHERE id = job_photos.appointment_id
        AND homeowner_id = auth.uid()
    )
  );

-- Cleaners can delete photos for their own appointments
CREATE POLICY "Cleaners can delete own appointment photos"
  ON job_photos
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM appointments
      WHERE id = job_photos.appointment_id
        AND cleaner_id = auth.uid()
    )
  );

-- ============================================================================
-- PART 6: Documentation
-- ============================================================================

COMMENT ON TABLE job_photos IS 'Evidence photos taken by cleaners during job execution. Photos are stored in Supabase Storage at appointments/{appointmentId}/{before|after}/{uuid}.jpg';
COMMENT ON COLUMN job_photos.photo_type IS 'Stage of job when photo was taken: before (property condition before cleaning), after (property after cleaning), during (mid-job if needed)';
