-- Add missing "Users can view profiles of organization members" policy
-- This policy exists in DEV but not in PROD, and is needed for admins to see appointments
-- with joined user_profiles data

-- Step 1: Create the users_share_organization function if it doesn't exist
-- This function is needed by the policy and should exist from migration 006
CREATE OR REPLACE FUNCTION public.users_share_organization(user1_id UUID, user2_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    -- Check if both users are in at least one common organization
    -- This query runs with postgres privileges and bypasses RLS
    RETURN EXISTS (
        SELECT 1
        FROM public.organization_members om1
        INNER JOIN public.organization_members om2 
            ON om1.organization_id = om2.organization_id
        WHERE om1.user_id = user1_id
        AND om2.user_id = user2_id
    );
END;
$$;

-- Ensure the function is owned by postgres (superuser) to guarantee RLS bypass
ALTER FUNCTION public.users_share_organization(UUID, UUID) OWNER TO postgres;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.users_share_organization(UUID, UUID) TO authenticated;

-- Step 2: Check if the policy already exists and drop it if it does (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view profiles of organization members" ON user_profiles;

-- Step 3: Create the policy using the SECURITY DEFINER helper function
-- This prevents RLS recursion by using a function that bypasses RLS
CREATE POLICY "Users can view profiles of organization members" ON user_profiles
    FOR SELECT USING (
        -- Always allow users to view their own profile
        auth.uid() = id
        OR
        -- Allow viewing profiles of users who share at least one organization
        -- The function does all organization_members queries internally, preventing recursion
        public.users_share_organization(auth.uid(), user_profiles.id)
    );

