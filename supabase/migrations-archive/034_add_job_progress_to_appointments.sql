-- Migration: Add job_progress column to appointments table
-- This enables tracking of cleaner workflow progress through before photos, checklist, and after photos

-- ============================================================================
-- PART 1: Create job_progress enum type
-- ============================================================================

CREATE TYPE job_progress AS ENUM (
  'not_started',
  'before_photos',
  'checklist',
  'after_photos',
  'completed'
);

-- ============================================================================
-- PART 2: Add job_progress column to appointments table
-- ============================================================================

ALTER TABLE appointments 
ADD COLUMN job_progress job_progress DEFAULT 'not_started';

-- ============================================================================
-- PART 3: Set existing in_progress appointments to before_photos
-- ============================================================================

UPDATE appointments 
SET job_progress = 'before_photos' 
WHERE status = 'in_progress';

-- ============================================================================
-- PART 4: Create index for performance
-- ============================================================================

CREATE INDEX idx_appointments_job_progress ON appointments(job_progress);

-- ============================================================================
-- PART 5: Add comment for documentation
-- ============================================================================

COMMENT ON COLUMN appointments.job_progress IS 'Tracks cleaner workflow progress: not_started -> before_photos -> checklist -> after_photos -> completed';
