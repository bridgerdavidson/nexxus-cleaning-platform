-- Test script to verify admin appointment access
-- Replace the placeholders with actual values from your database

-- Step 1: Find an admin user and their organization
-- Run this first to get the values you need:
SELECT 
    om.user_id,
    om.organization_id,
    om.role,
    up.email,
    up.first_name,
    up.last_name
FROM organization_members om
JOIN user_profiles up ON om.user_id = up.id
WHERE om.role IN ('admin', 'manager', 'owner')
ORDER BY om.created_at DESC
LIMIT 5;

-- Step 2: Test the helper function with actual values
-- Replace ADMIN_USER_ID and ORG_ID with values from Step 1
-- Example: SELECT public.is_admin_or_manager_in_org('123e4567-e89b-12d3-a456-426614174000'::uuid);
-- 
-- To test, you need to run this as the admin user (not as postgres)
-- In Supabase, use the SQL editor and make sure you're logged in as the admin user
-- 
-- You can't directly test auth.uid() in a SQL query, so instead:

-- Step 3: Check if admin user is in organization_members correctly
-- Replace ADMIN_USER_ID and ORG_ID
SELECT 
    user_id,
    organization_id,
    role,
    created_at
FROM organization_members
WHERE user_id = 'ADMIN_USER_ID_HERE'::uuid
    AND organization_id = 'ORG_ID_HERE'::uuid;

-- Step 4: Check appointments for that organization
SELECT 
    id,
    homeowner_id,
    cleaner_id,
    organization_id,
    status,
    scheduled_date,
    scheduled_time
FROM appointments
WHERE organization_id = 'ORG_ID_HERE'::uuid
LIMIT 10;

-- Step 5: Check if appointments have organization_id set correctly
SELECT 
    COUNT(*) as total_appointments,
    COUNT(organization_id) as appointments_with_org_id,
    COUNT(*) - COUNT(organization_id) as appointments_without_org_id
FROM appointments;

-- Step 6: Test RLS directly (this will show what the current user can see)
-- Run this while logged in as an admin user in Supabase SQL editor
SELECT 
    id,
    homeowner_id,
    cleaner_id,
    organization_id,
    status
FROM appointments
LIMIT 10;

-- Step 7: Check function permissions
SELECT 
    p.proname AS function_name,
    pg_get_userbyid(p.proowner) AS owner,
    p.prosecdef AS is_security_definer,
    pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
    AND p.proname IN ('is_admin_or_manager_in_org', 'user_shares_org_with_homeowner');

