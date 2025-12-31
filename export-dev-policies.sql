-- Run this in your DEV database to export all RLS policies
-- This will help us see what's working in dev that might be missing in prod

-- 1. Export all appointments table policies
SELECT 
    'appointments' as table_name,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'appointments'
ORDER BY policyname;

-- 2. Export all user_profiles table policies
SELECT 
    'user_profiles' as table_name,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'user_profiles'
ORDER BY policyname;

-- 3. Export all properties table policies
SELECT 
    'properties' as table_name,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'properties'
ORDER BY policyname;

-- 4. Check function definitions
SELECT 
    p.proname AS function_name,
    pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
    AND p.proname IN (
        'is_admin_or_manager_in_org',
        'user_shares_org_with_homeowner',
        'get_user_organization_ids',
        'users_share_organization'
    )
ORDER BY p.proname;

-- 5. Check if RLS is enabled on key tables
SELECT 
    tablename,
    CASE WHEN rowsecurity THEN 'ENABLED' ELSE 'DISABLED' END AS rls_status
FROM pg_tables
WHERE schemaname = 'public' 
    AND tablename IN ('appointments', 'user_profiles', 'properties', 'organization_members')
ORDER BY tablename;

