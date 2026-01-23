-- Combined query to see all policies and functions at once

-- All policies (appointments, user_profiles, properties) combined
SELECT 
    'POLICY' as type,
    tablename as name,
    policyname as item_name,
    cmd as details
FROM pg_policies
WHERE tablename IN ('appointments', 'user_profiles', 'properties')
ORDER BY tablename, policyname

UNION ALL

-- All functions
SELECT 
    'FUNCTION' as type,
    'functions' as name,
    p.proname as item_name,
    CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END as details
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
    AND p.proname IN (
        'is_admin_or_manager_in_org',
        'user_shares_org_with_homeowner',
        'get_user_organization_ids',
        'users_share_organization'
    )
ORDER BY type, name, item_name;





