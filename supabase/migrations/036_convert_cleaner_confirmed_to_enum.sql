-- Migration: Convert cleaner_confirmed boolean to cleaner_confirmation_status enum
-- This provides three distinct states: awaiting (new), approved (cleaner accepted),
-- rejected (cleaner declined) -- enabling proper UI differentiation.

-- ============================================================================
-- PART 1: Create the enum type
-- ============================================================================

CREATE TYPE cleaner_confirmation_status AS ENUM ('awaiting', 'approved', 'rejected');

-- ============================================================================
-- PART 2: Add new enum column
-- ============================================================================

ALTER TABLE appointments 
ADD COLUMN cleaner_confirmation_status cleaner_confirmation_status DEFAULT 'awaiting';

-- ============================================================================
-- PART 3: Migrate existing data from boolean to enum
-- ============================================================================

-- Existing confirmed appointments → 'approved'
UPDATE appointments 
SET cleaner_confirmation_status = 'approved'
WHERE cleaner_confirmed = true;

-- Existing unconfirmed appointments → 'awaiting'
UPDATE appointments 
SET cleaner_confirmation_status = 'awaiting'
WHERE cleaner_confirmed = false OR cleaner_confirmed IS NULL;

-- ============================================================================
-- PART 4: Drop old boolean column and its index
-- ============================================================================

DROP INDEX IF EXISTS idx_appointments_cleaner_confirmed;
ALTER TABLE appointments DROP COLUMN cleaner_confirmed;

-- ============================================================================
-- PART 5: Create index on new column
-- ============================================================================

CREATE INDEX idx_appointments_cleaner_confirmation_status ON appointments(cleaner_confirmation_status);

-- ============================================================================
-- PART 6: Add documentation comment
-- ============================================================================

COMMENT ON COLUMN appointments.cleaner_confirmation_status IS 'Cleaner availability confirmation status: awaiting (pending cleaner response), approved (cleaner confirmed), rejected (cleaner declined - needs rescheduling). Defaults to awaiting for new appointments.';
