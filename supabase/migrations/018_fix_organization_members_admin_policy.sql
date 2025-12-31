-- Fix: The organization_members policies check user_profiles.role = 'admin'
-- But our appointment policies need to query organization_members to check role
-- This creates a circular dependency - admins can't query organization_members
-- unless user_profiles.role = 'admin', but we're checking organization_members.role
--
-- Solution: Add a policy that allows users to query organization_members records
-- where they are the user_id OR where they share an organization (via the helper function)

-- The existing policy "Users can view members of their organization" from migration 006
-- should handle this, but let's make sure it works correctly
-- It uses: organization_id = ANY(public.get_user_organization_ids(auth.uid()))
-- This function should work, but let's verify the policy exists and add one if needed

-- Check if we need to add a policy that allows checking your own role in organization_members
-- Actually, "Users can view their own memberships" should cover this:
-- qual: (auth.uid() = user_id)

-- But the real issue is: when querying organization_members in a subquery to check
-- if someone ELSE is in the organization, we need to be able to see their records.
-- The "Users can view members of their organization" policy should handle this.

-- However, if that policy isn't working, we might need to ensure the helper function works.
-- Let's add an explicit policy that allows checking organization_members.role for users
-- in the same organization

-- Actually, wait - the real fix is simpler. The appointment policies are trying to check
-- organization_members.role, but if the admin can't query organization_members (because
-- user_profiles.role != 'admin'), then the EXISTS clause fails.

-- The solution: Make sure admins can ALWAYS query organization_members for their own records
-- and for records where they share an organization. The "Users can view members of their organization"
-- policy should work, but maybe it's not being applied correctly.

-- Let's ensure the helper function exists and works, and verify the policy is correct
-- Actually, migration 006 should have created this. Let me check if we need to recreate it.

-- Since we can't easily test the function, let's add a simpler policy that definitely works:
-- Allow users to see organization_members records where:
-- 1. They are the user_id (already covered)
-- 2. The organization_id matches any organization they're in (should be covered by migration 006)

-- But actually, I think the real issue is that the appointment policies need to use a
-- SECURITY DEFINER function to check organization_members, similar to how migration 006 does it.

-- For now, let's create a simpler approach: Use the existing function from migration 006
-- which should allow checking organization membership. But wait, that function returns
-- organization_ids, not whether a user is an admin.

-- The real fix: Create a SECURITY DEFINER function that checks if the current user
-- is an admin/manager in the same organization as a given organization_id

CREATE OR REPLACE FUNCTION public.is_admin_or_manager_in_org(check_org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    -- Check if current user is admin/manager/owner in the given organization
    -- This runs with postgres privileges and bypasses RLS
    RETURN EXISTS (
        SELECT 1
        FROM public.organization_members om
        WHERE om.user_id = auth.uid()
        AND om.organization_id = check_org_id
        AND om.role IN ('owner', 'admin', 'manager')
    );
END;
$$;

-- Ensure the function is owned by postgres
ALTER FUNCTION public.is_admin_or_manager_in_org(UUID) OWNER TO postgres;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.is_admin_or_manager_in_org(UUID) TO authenticated;

-- Create a function to check if user shares organization with homeowner
CREATE OR REPLACE FUNCTION public.user_shares_org_with_homeowner(check_homeowner_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    -- Check if current user (admin/manager) shares organization with homeowner
    -- This runs with postgres privileges and bypasses RLS
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

ALTER FUNCTION public.user_shares_org_with_homeowner(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.user_shares_org_with_homeowner(UUID) TO authenticated;

-- Now update the appointment policies to use these functions
DROP POLICY IF EXISTS "Admins and managers can view org appointments" ON appointments;
DROP POLICY IF EXISTS "Admins and managers can update org appointments" ON appointments;

-- Recreate using the SECURITY DEFINER functions
CREATE POLICY "Admins and managers can view org appointments" ON appointments
    FOR SELECT USING (
        auth.uid() = homeowner_id
        OR
        auth.uid() = cleaner_id
        OR
        -- Use SECURITY DEFINER function to check admin status (bypasses RLS on organization_members)
        (
            appointments.organization_id IS NOT NULL
            AND public.is_admin_or_manager_in_org(appointments.organization_id)
        )
        OR
        -- Fallback: check through homeowner using SECURITY DEFINER function
        public.user_shares_org_with_homeowner(appointments.homeowner_id)
    );

CREATE POLICY "Admins and managers can update org appointments" ON appointments
    FOR UPDATE USING (
        auth.uid() = homeowner_id
        OR
        auth.uid() = cleaner_id
        OR
        (
            appointments.organization_id IS NOT NULL
            AND public.is_admin_or_manager_in_org(appointments.organization_id)
        )
        OR
        public.user_shares_org_with_homeowner(appointments.homeowner_id)
    );

