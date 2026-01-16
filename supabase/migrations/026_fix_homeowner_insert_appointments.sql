-- Fix: Ensure homeowners can create appointments
-- The policy may have been dropped or may need to verify organization membership

-- Drop the policy if it exists (we'll recreate it with better checks)
DROP POLICY IF EXISTS "Homeowners can create appointments" ON appointments;

-- Recreate the INSERT policy for homeowners
-- This allows homeowners to create appointments for themselves
CREATE POLICY "Homeowners can create appointments" ON appointments
    FOR INSERT 
    WITH CHECK (
        -- Homeowner must be creating appointment for themselves
        auth.uid() = homeowner_id
    );

-- Add a comment documenting the policy
COMMENT ON POLICY "Homeowners can create appointments" ON appointments IS
    'Allows homeowners to create appointments for themselves. Verifies that auth.uid() matches homeowner_id.';

