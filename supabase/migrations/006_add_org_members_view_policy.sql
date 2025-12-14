-- Migration: Add RLS policies to allow users to view organization members
-- This enables the "New Conversation" feature to show all team members
-- 
-- This migration fixes RLS policies to prevent recursion
-- The key is using SECURITY DEFINER function that runs with postgres superuser privileges

-- Step 1: Drop any existing problematic policies and functions
DROP POLICY IF EXISTS "Users can view members of their organization" ON organization_members;
DROP POLICY IF EXISTS "Users can view their own organization memberships" ON organization_members;
DROP POLICY IF EXISTS "Users can view members of their organizations" ON organization_members;
DROP POLICY IF EXISTS "Users can view profiles of organization members" ON user_profiles;
DROP FUNCTION IF EXISTS public.get_user_organization_ids(UUID);
DROP FUNCTION IF EXISTS public.users_share_organization(UUID, UUID);

-- Step 2: Create a SECURITY DEFINER function that bypasses RLS
-- SECURITY DEFINER means the function runs with the privileges of the function owner (postgres)
-- This allows it to query organization_members without triggering RLS policies
-- 
-- IMPORTANT: The function must be owned by a superuser (postgres) to truly bypass RLS
CREATE OR REPLACE FUNCTION public.get_user_organization_ids(check_user_id UUID)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    org_ids UUID[];
BEGIN
    -- Query organization_members with postgres superuser privileges
    -- This completely bypasses RLS because the function runs as the function owner (postgres)
    SELECT ARRAY_AGG(organization_id)
    INTO org_ids
    FROM public.organization_members
    WHERE user_id = check_user_id;
    
    RETURN COALESCE(org_ids, ARRAY[]::UUID[]);
END;
$$;

-- Ensure the function is owned by postgres (superuser) to guarantee RLS bypass
ALTER FUNCTION public.get_user_organization_ids(UUID) OWNER TO postgres;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_user_organization_ids(UUID) TO authenticated;

-- Step 3: Ensure RLS is enabled on organization_members
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- Step 4: Create RLS policy for organization_members
-- IMPORTANT: The function call here will NOT cause recursion because:
-- 1. The function is SECURITY DEFINER (runs as postgres superuser)
-- 2. The function's query bypasses RLS completely
-- 3. PostgreSQL recognizes this and doesn't re-evaluate RLS when the function queries the table
CREATE POLICY "Users can view members of their organization" ON organization_members
    FOR SELECT USING (
        -- Allow users to see their own records (direct check, no recursion)
        user_id = auth.uid()
        OR
        -- Allow users to see other members in organizations they belong to
        -- The function bypasses RLS, so this check doesn't cause recursion
        organization_id = ANY(public.get_user_organization_ids(auth.uid()))
    );

-- Step 3: Create a SECURITY DEFINER function to check if two users share an organization
-- This function does ALL organization_members queries internally, preventing recursion
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

-- Step 5: RLS policy for user_profiles to view organization members
-- CRITICAL: Use the helper function instead of querying organization_members directly
-- This prevents recursion because the function does all queries internally with SECURITY DEFINER
CREATE POLICY "Users can view profiles of organization members" ON user_profiles
    FOR SELECT USING (
        -- Always allow users to view their own profile
        auth.uid() = id
        OR
        -- Allow viewing profiles of users who share at least one organization
        -- The function does all organization_members queries internally, preventing recursion
        public.users_share_organization(auth.uid(), user_profiles.id)
    );

