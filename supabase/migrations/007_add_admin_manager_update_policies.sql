-- Migration: Add RLS policies for admins/managers to update user_profiles, appointments, and cleaner_profiles
-- This migration adds the necessary policies for admins/managers to update records in their organization

-- ============================================================================
-- USER_PROFILES UPDATE POLICIES
-- ============================================================================

-- Drop existing policies if they exist (to allow re-running migration)
DROP POLICY IF EXISTS "Admins and managers can update org user profiles" ON user_profiles;

-- Create a SECURITY DEFINER function to check if admin/manager can update a user profile
-- This prevents recursion by using SECURITY DEFINER to bypass RLS when checking organization_members
CREATE OR REPLACE FUNCTION public.can_admin_update_user_profile(admin_user_id UUID, target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    -- Check if admin_user_id is an admin/manager and target_user_id is in the same organization
    -- This query runs with postgres privileges and bypasses RLS
    RETURN EXISTS (
        SELECT 1
        FROM public.organization_members om_admin
        INNER JOIN public.organization_members om_target
            ON om_admin.organization_id = om_target.organization_id
        WHERE om_admin.user_id = admin_user_id
        AND om_admin.role IN ('owner', 'admin', 'manager')
        AND om_target.user_id = target_user_id
    );
END;
$$;

-- Ensure the function is owned by postgres (superuser) to guarantee RLS bypass
ALTER FUNCTION public.can_admin_update_user_profile(UUID, UUID) OWNER TO postgres;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.can_admin_update_user_profile(UUID, UUID) TO authenticated;

-- RLS policy for admins/managers to update user_profiles in their organization
CREATE POLICY "Admins and managers can update org user profiles" ON user_profiles
    FOR UPDATE USING (
        -- Allow users to update their own profile (existing policy)
        auth.uid() = id
        OR
        -- Allow admins/managers to update profiles of users in their organization
        -- Use SECURITY DEFINER function to prevent recursion
        public.can_admin_update_user_profile(auth.uid(), user_profiles.id)
    );

-- ============================================================================
-- APPOINTMENTS UPDATE POLICIES
-- ============================================================================

-- Drop existing policies if they exist (to allow re-running migration)
DROP POLICY IF EXISTS "Admins and managers can view org appointments" ON appointments;
DROP POLICY IF EXISTS "Admins and managers can update org appointments" ON appointments;

-- RLS policy for admins/managers to view appointments in their organization
CREATE POLICY "Admins and managers can view org appointments" ON appointments
    FOR SELECT USING (
        -- Allow homeowners to view their own appointments (existing policy)
        auth.uid() = homeowner_id
        OR
        -- Allow cleaners to view their own appointments (existing policy)
        auth.uid() = cleaner_id
        OR
        -- Allow admins/managers to view appointments in their organization
        -- Appointments are linked through homeowners who are in organization_members
        EXISTS (
            SELECT 1 FROM organization_members om_viewer
            WHERE om_viewer.user_id = auth.uid()
            AND om_viewer.role IN ('owner', 'admin', 'manager')
            AND EXISTS (
                SELECT 1 FROM organization_members om_homeowner
                WHERE om_homeowner.user_id = appointments.homeowner_id
                AND om_homeowner.organization_id = om_viewer.organization_id
            )
        )
    );

-- RLS policy for admins/managers to update appointments in their organization
CREATE POLICY "Admins and managers can update org appointments" ON appointments
    FOR UPDATE USING (
        -- Allow homeowners to update their own appointments (existing policy)
        auth.uid() = homeowner_id
        OR
        -- Allow cleaners to update appointment status (existing policy)
        auth.uid() = cleaner_id
        OR
        -- Allow admins/managers to update appointments in their organization
        -- Appointments are linked through homeowners who are in organization_members
        EXISTS (
            SELECT 1 FROM organization_members om_viewer
            WHERE om_viewer.user_id = auth.uid()
            AND om_viewer.role IN ('owner', 'admin', 'manager')
            AND EXISTS (
                SELECT 1 FROM organization_members om_homeowner
                WHERE om_homeowner.user_id = appointments.homeowner_id
                AND om_homeowner.organization_id = om_viewer.organization_id
            )
        )
    );

-- ============================================================================
-- CLEANER_PROFILES UPDATE POLICIES
-- ============================================================================

-- Create a SECURITY DEFINER function to check if admin/manager can update a cleaner profile
-- This prevents recursion by using SECURITY DEFINER to bypass RLS when checking organization_members
CREATE OR REPLACE FUNCTION public.can_admin_update_cleaner_profile(admin_user_id UUID, cleaner_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    -- Check if admin/manager and cleaner are in the same organization
    -- This query runs with postgres privileges and bypasses RLS
    RETURN EXISTS (
        SELECT 1
        FROM public.organization_members om_admin
        INNER JOIN public.organization_members om_cleaner
            ON om_admin.organization_id = om_cleaner.organization_id
        WHERE om_admin.user_id = admin_user_id
        AND om_admin.role IN ('owner', 'admin', 'manager')
        AND om_cleaner.user_id = cleaner_profile_id
        AND om_cleaner.role = 'cleaner'
    );
END;
$$;

-- Ensure the function is owned by postgres (superuser) to guarantee RLS bypass
ALTER FUNCTION public.can_admin_update_cleaner_profile(UUID, UUID) OWNER TO postgres;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.can_admin_update_cleaner_profile(UUID, UUID) TO authenticated;

-- Drop existing policies if they exist (to allow re-running migration)
DROP POLICY IF EXISTS "Admins and managers can update org cleaner profiles" ON cleaner_profiles;

-- RLS policy for admins/managers to update cleaner_profiles in their organization
CREATE POLICY "Admins and managers can update org cleaner profiles" ON cleaner_profiles
    FOR UPDATE USING (
        -- Allow cleaners to update their own profile (existing policy)
        auth.uid() = id
        OR
        -- Allow admins/managers to update cleaner profiles in their organization
        -- Use SECURITY DEFINER function to prevent recursion
        public.can_admin_update_cleaner_profile(auth.uid(), cleaner_profiles.id)
    );

