-- Run each section separately to see all results

-- ============================================================================
-- SECTION 1: Appointments Table Policies
-- ============================================================================
SELECT 
    'appointments' as table_name,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'appointments'
ORDER BY policyname;

-- ============================================================================
-- SECTION 2: User Profiles Table Policies  
-- ============================================================================
SELECT 
    'user_profiles' as table_name,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'user_profiles'
ORDER BY policyname;

-- ============================================================================
-- SECTION 3: Properties Table Policies
-- ============================================================================
SELECT 
    'properties' as table_name,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'properties'
ORDER BY policyname;

-- ============================================================================
-- SECTION 4: Helper Functions
-- ============================================================================
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





