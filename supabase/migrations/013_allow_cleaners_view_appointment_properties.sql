-- Migration: Allow cleaners to view properties for their assigned appointments
-- This enables cleaners to see property addresses for appointments they're assigned to

-- RLS policy for cleaners to view properties through their appointments
CREATE POLICY "Cleaners can view properties for their appointments" ON properties
    FOR SELECT USING (
        -- Allow homeowners to always see their own properties (existing policy covers this)
        auth.uid() = owner_id
        OR
        -- Allow cleaners to see properties for appointments assigned to them
        EXISTS (
            SELECT 1 FROM appointments
            WHERE appointments.property_id = properties.id
            AND appointments.cleaner_id = auth.uid()
        )
    );

