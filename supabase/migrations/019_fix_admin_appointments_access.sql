-- Fix: Ensure admins can view appointments in production
-- This migration ensures the SECURITY DEFINER functions are correctly defined
-- and the RLS policies properly allow admin access

-- Step 1: Drop existing policies first (they depend on the functions)
DROP POLICY IF EXISTS "Admins and managers can view org appointments" ON appointments;
DROP POLICY IF EXISTS "Admins and managers can update org appointments" ON appointments;

-- Step 2: Recreate the helper functions using CREATE OR REPLACE (preserves dependencies)
-- Recreate is_admin_or_manager_in_org with explicit SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.is_admin_or_manager_in_org(check_org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    -- Check if current user is admin/manager/owner in the given organization
    -- SECURITY DEFINER means this runs with postgres privileges and bypasses RLS
    RETURN EXISTS (
        SELECT 1
        FROM public.organization_members om
        WHERE om.user_id = auth.uid()
        AND om.organization_id = check_org_id
        AND om.role IN ('owner', 'admin', 'manager')
    );
END;
$$;

-- Ensure the function is owned by postgres (superuser) to guarantee RLS bypass
ALTER FUNCTION public.is_admin_or_manager_in_org(UUID) OWNER TO postgres;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.is_admin_or_manager_in_org(UUID) TO authenticated;

-- Recreate user_shares_org_with_homeowner with explicit SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.user_shares_org_with_homeowner(check_homeowner_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    -- Check if current user (admin/manager) shares organization with homeowner
    -- SECURITY DEFINER means this runs with postgres privileges and bypasses RLS
    RETURN EXISTS (
        SELECT 1
        FROM public.organization_members om_admin
        INNER JOIN public.organization_members om_homeowner
            ON om_admin.organization_id = om_homeowner.organization_id
        WHERE om_admin.user_id = auth.uid()
        AND om_admin.role IN ('owner', 'admin', 'manager')
        AND om_homeowner.user_id = check_homeowner_id
    );
END;
$$;

-- Ensure the function is owned by postgres (superuser) to guarantee RLS bypass
ALTER FUNCTION public.user_shares_org_with_homeowner(UUID) OWNER TO postgres;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.user_shares_org_with_homeowner(UUID) TO authenticated;

-- Step 3: Recreate the policies with proper logic
-- Recreate the SELECT policy with proper logic
CREATE POLICY "Admins and managers can view org appointments" ON appointments
    FOR SELECT USING (
        -- Allow homeowners to view their own appointments
        auth.uid() = homeowner_id
        OR
        -- Allow cleaners to view their own appointments
        auth.uid() = cleaner_id
        OR
        -- Allow admins/managers to view appointments in their organization
        -- Check directly via organization_id using SECURITY DEFINER function
        (
            appointments.organization_id IS NOT NULL
            AND public.is_admin_or_manager_in_org(appointments.organization_id)
        )
        OR
        -- Fallback: check through homeowner using SECURITY DEFINER function
        -- This handles cases where organization_id might be null
        public.user_shares_org_with_homeowner(appointments.homeowner_id)
    );

-- Recreate the UPDATE policy with proper logic
CREATE POLICY "Admins and managers can update org appointments" ON appointments
    FOR UPDATE USING (
        -- Allow homeowners to update their own appointments
        auth.uid() = homeowner_id
        OR
        -- Allow cleaners to update their own appointments
        auth.uid() = cleaner_id
        OR
        -- Allow admins/managers to update appointments in their organization
        -- Check directly via organization_id using SECURITY DEFINER function
        (
            appointments.organization_id IS NOT NULL
            AND public.is_admin_or_manager_in_org(appointments.organization_id)
        )
        OR
        -- Fallback: check through homeowner using SECURITY DEFINER function
        public.user_shares_org_with_homeowner(appointments.homeowner_id)
    );

-- Step 4: Ensure RLS is enabled on appointments table
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- Step 5: Create a comment documenting the fix
COMMENT ON FUNCTION public.is_admin_or_manager_in_org(UUID) IS 
    'SECURITY DEFINER function that checks if the current user is an admin/manager/owner in the given organization. Bypasses RLS by running with postgres privileges.';

COMMENT ON FUNCTION public.user_shares_org_with_homeowner(UUID) IS 
    'SECURITY DEFINER function that checks if the current admin/manager user shares an organization with the given homeowner. Bypasses RLS by running with postgres privileges.';

