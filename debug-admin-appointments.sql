-- Diagnostic script to check admin appointment access issues
-- Run this in your Supabase SQL editor (run as postgres/admin, not as a regular user)
-- This will give us the information needed to debug the issue

-- ============================================================================
-- 1. Check if the helper functions exist and their properties
-- ============================================================================
SELECT 
    p.proname AS function_name,
    pg_get_userbyid(p.proowner) AS owner,
    CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security_type,
    pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
    AND p.proname IN ('is_admin_or_manager_in_org', 'user_shares_org_with_homeowner')
ORDER BY p.proname;

-- ============================================================================
-- 2. Check current RLS policies on appointments table
-- ============================================================================
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'appointments'
ORDER BY policyname;

-- ============================================================================
-- 3. Check if RLS is enabled on appointments
-- ============================================================================
SELECT 
    tablename,
    CASE WHEN rowsecurity THEN 'ENABLED' ELSE 'DISABLED' END AS rls_status
FROM pg_tables
WHERE schemaname = 'public' 
    AND tablename = 'appointments';

-- ============================================================================
-- 4. Check organization_members - find admin and manager users
-- ============================================================================
SELECT 
    om.user_id,
    om.organization_id,
    om.role,
    up.email,
    up.first_name,
    up.last_name,
    om.created_at
FROM organization_members om
LEFT JOIN user_profiles up ON om.user_id = up.id
WHERE om.role IN ('admin', 'manager', 'owner')
ORDER BY om.role, om.created_at DESC
LIMIT 20;

-- ============================================================================
-- 5. Check sample appointments - see what organization_ids exist
-- ============================================================================
SELECT 
    id,
    homeowner_id,
    cleaner_id,
    organization_id,
    status,
    scheduled_date,
    scheduled_time
FROM appointments
ORDER BY created_at DESC
LIMIT 20;

-- ============================================================================
-- 6. Count appointments by organization_id (to see data distribution)
-- ============================================================================
SELECT 
    organization_id,
    COUNT(*) as appointment_count,
    COUNT(DISTINCT homeowner_id) as unique_homeowners,
    COUNT(DISTINCT cleaner_id) as unique_cleaners
FROM appointments
GROUP BY organization_id
ORDER BY appointment_count DESC;

-- ============================================================================
-- 7. Check for appointments without organization_id (these might cause issues)
-- ============================================================================
SELECT 
    COUNT(*) as total_appointments,
    COUNT(organization_id) as with_org_id,
    COUNT(*) - COUNT(organization_id) as without_org_id
FROM appointments;

-- ============================================================================
-- 8. Check organization_members RLS policies
-- ============================================================================
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'organization_members'
ORDER BY policyname;

-- ============================================================================
-- 9. Check function grants (who can execute the functions)
-- ============================================================================
SELECT 
    p.proname AS function_name,
    pg_get_userbyid(p.proowner) AS owner,
    a.rolname AS grantee,
    has_function_privilege(a.rolname, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
CROSS JOIN pg_roles a
WHERE n.nspname = 'public'
    AND p.proname IN ('is_admin_or_manager_in_org', 'user_shares_org_with_homeowner')
    AND a.rolname IN ('authenticated', 'postgres', 'anon')
ORDER BY p.proname, a.rolname;

-- ============================================================================
-- 10. Check if there are any conflicting policies on appointments
-- ============================================================================
SELECT 
    policyname,
    cmd,
    qual
FROM pg_policies
WHERE tablename = 'appointments'
ORDER BY policyname;

-- ============================================================================
-- 11. Sample data: Get a specific admin's organization and appointments
-- Replace 'YOUR_ADMIN_EMAIL@example.com' with an actual admin email
-- ============================================================================
-- Uncomment and replace email:
/*
WITH admin_info AS (
    SELECT om.user_id, om.organization_id, om.role
    FROM organization_members om
    JOIN user_profiles up ON om.user_id = up.id
    WHERE up.email = 'YOUR_ADMIN_EMAIL@example.com'
    AND om.role IN ('admin', 'manager', 'owner')
    LIMIT 1
)
SELECT 
    ai.user_id as admin_user_id,
    ai.organization_id as admin_org_id,
    ai.role as admin_role,
    COUNT(a.id) as visible_appointments
FROM admin_info ai
LEFT JOIN appointments a ON a.organization_id = ai.organization_id
GROUP BY ai.user_id, ai.organization_id, ai.role;
*/

