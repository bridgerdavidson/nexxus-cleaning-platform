-- Simplified version - just policy names and commands, easier to compare

-- Section 1: Appointments policies (names only)
SELECT 'appointments' as table_name, policyname, cmd
FROM pg_policies
WHERE tablename = 'appointments'
ORDER BY policyname;

-- Section 2: User profiles policies (names only)
SELECT 'user_profiles' as table_name, policyname, cmd
FROM pg_policies
WHERE tablename = 'user_profiles'
ORDER BY policyname;

-- Section 3: Properties policies (names only)
SELECT 'properties' as table_name, policyname, cmd
FROM pg_policies
WHERE tablename = 'properties'
ORDER BY policyname;

-- Section 4: Function names (do they exist?)
SELECT p.proname AS function_name
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




