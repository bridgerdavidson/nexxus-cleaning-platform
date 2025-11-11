-- =====================================================
-- Fix RLS Policies: Allow Cleaners to See Appointment Details
-- =====================================================
-- 
-- Problem: Cleaners can't see homeowner profiles or property details
-- for appointments they're assigned to because RLS policies block them.
--
-- Solution: Add policies that allow cleaners to see homeowner data
-- and property data for their assigned appointments.
-- =====================================================

-- ==========================================
-- 1. Allow cleaners to see homeowner profiles for their appointments
-- ==========================================

CREATE POLICY "Cleaners can view homeowner profiles for their appointments" 
ON user_profiles
FOR SELECT
USING (
  -- Allow if this user is a homeowner for any appointment assigned to the current cleaner
  EXISTS (
    SELECT 1 FROM appointments 
    WHERE appointments.homeowner_id = user_profiles.id 
    AND appointments.cleaner_id = auth.uid()
  )
);

-- ==========================================
-- 2. Allow cleaners to view properties for their appointments
-- ==========================================

CREATE POLICY "Cleaners can view properties for their appointments" 
ON properties
FOR SELECT
USING (
  -- Allow if this property is linked to an appointment assigned to the current cleaner
  EXISTS (
    SELECT 1 FROM appointments 
    WHERE appointments.property_id = properties.id 
    AND appointments.cleaner_id = auth.uid()
  )
);

-- ==========================================
-- 3. (Optional) Allow anyone to view public cleaner profiles
-- ==========================================
-- This is already in the schema, but let's make sure it exists:

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'cleaner_profiles' 
    AND policyname = 'Anyone can view cleaner profiles'
  ) THEN
    CREATE POLICY "Anyone can view cleaner profiles" ON cleaner_profiles
      FOR SELECT USING (true);
  END IF;
END $$;

-- ==========================================
-- VERIFICATION QUERY
-- ==========================================
-- Run this to verify the policies were created:
--
-- SELECT schemaname, tablename, policyname, cmd, qual
-- FROM pg_policies 
-- WHERE tablename IN ('user_profiles', 'properties', 'cleaner_profiles')
-- ORDER BY tablename, policyname;

