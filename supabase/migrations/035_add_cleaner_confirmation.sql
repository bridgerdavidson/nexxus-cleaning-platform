-- Migration: Add cleaner confirmation workflow to appointments
-- This enables a two-way confirmation system where cleaners must approve
-- appointment times before they appear on the schedule.

-- ============================================================================
-- PART 1: Add cleaner_confirmed column to appointments table
-- ============================================================================

ALTER TABLE appointments 
ADD COLUMN cleaner_confirmed BOOLEAN DEFAULT false;

-- ============================================================================
-- PART 2: Set all existing appointments to confirmed (true)
-- New appointments will default to false via the column default
-- ============================================================================

UPDATE appointments 
SET cleaner_confirmed = true;

-- ============================================================================
-- PART 3: Create index for performance
-- ============================================================================

CREATE INDEX idx_appointments_cleaner_confirmed ON appointments(cleaner_confirmed);

-- ============================================================================
-- PART 4: Add comment for documentation
-- ============================================================================

COMMENT ON COLUMN appointments.cleaner_confirmed IS 'Whether the assigned cleaner has confirmed their availability for this appointment. Existing appointments default to true; new appointments default to false until cleaner confirms.';

-- ============================================================================
-- PART 5: Create cleaner_availability_feedback table
-- Stores the reason a cleaner declined an appointment
-- ============================================================================

CREATE TABLE cleaner_availability_feedback (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE NOT NULL,
    cleaner_id UUID REFERENCES cleaner_profiles(id) ON DELETE CASCADE NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_feedback_appointment_id ON cleaner_availability_feedback(appointment_id);
CREATE INDEX idx_feedback_cleaner_id ON cleaner_availability_feedback(cleaner_id);

COMMENT ON TABLE cleaner_availability_feedback IS 'Stores feedback from cleaners when they decline an appointment, including reason and suggested alternative times.';

-- ============================================================================
-- PART 6: Create cleaner_suggested_times table
-- Stores alternative time slots suggested by the cleaner
-- ============================================================================

CREATE TABLE cleaner_suggested_times (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    feedback_id UUID REFERENCES cleaner_availability_feedback(id) ON DELETE CASCADE NOT NULL,
    suggested_date DATE NOT NULL,
    suggested_time TIME NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_suggested_times_feedback_id ON cleaner_suggested_times(feedback_id);

COMMENT ON TABLE cleaner_suggested_times IS 'Alternative time slots suggested by a cleaner when they decline an appointment.';

-- ============================================================================
-- PART 7: Enable RLS on new tables
-- ============================================================================

ALTER TABLE cleaner_availability_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaner_suggested_times ENABLE ROW LEVEL SECURITY;

-- Cleaners can view and insert their own feedback
CREATE POLICY "Cleaners can view their own feedback" ON cleaner_availability_feedback
    FOR SELECT USING (auth.uid() = cleaner_id);

CREATE POLICY "Cleaners can insert their own feedback" ON cleaner_availability_feedback
    FOR INSERT WITH CHECK (auth.uid() = cleaner_id);

-- Admins can view all feedback (via service role in API)
-- Suggested times follow feedback access
CREATE POLICY "Users can view suggested times for their feedback" ON cleaner_suggested_times
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM cleaner_availability_feedback f 
            WHERE f.id = feedback_id AND f.cleaner_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert suggested times for their feedback" ON cleaner_suggested_times
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM cleaner_availability_feedback f 
            WHERE f.id = feedback_id AND f.cleaner_id = auth.uid()
        )
    );
