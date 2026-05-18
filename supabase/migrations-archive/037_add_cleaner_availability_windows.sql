-- Migration: Add cleaner availability windows
-- This enables cleaners to suggest time windows (ranges) in addition to specific times
-- when declining appointments. Admins can reschedule within these windows and the
-- appointment will auto-approve.

-- ============================================================================
-- PART 1: Create cleaner_suggested_windows table
-- ============================================================================

CREATE TABLE cleaner_suggested_windows (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    feedback_id UUID REFERENCES cleaner_availability_feedback(id) ON DELETE CASCADE NOT NULL,
    window_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

CREATE INDEX idx_suggested_windows_feedback_id ON cleaner_suggested_windows(feedback_id);

COMMENT ON TABLE cleaner_suggested_windows IS 'Availability windows (time ranges) suggested by cleaners when they decline an appointment. Same-day windows only.';
COMMENT ON COLUMN cleaner_suggested_windows.window_date IS 'The date for this availability window';
COMMENT ON COLUMN cleaner_suggested_windows.start_time IS 'Start time of the availability window';
COMMENT ON COLUMN cleaner_suggested_windows.end_time IS 'End time of the availability window (must be after start_time)';

-- ============================================================================
-- PART 2: Enable RLS on new table
-- ============================================================================

ALTER TABLE cleaner_suggested_windows ENABLE ROW LEVEL SECURITY;

-- Users can view suggested windows for their feedback
CREATE POLICY "Users can view suggested windows for their feedback" ON cleaner_suggested_windows
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM cleaner_availability_feedback f 
            WHERE f.id = feedback_id AND f.cleaner_id = auth.uid()
        )
    );

-- Users can insert suggested windows for their feedback
CREATE POLICY "Users can insert suggested windows for their feedback" ON cleaner_suggested_windows
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM cleaner_availability_feedback f 
            WHERE f.id = feedback_id AND f.cleaner_id = auth.uid()
        )
    );
