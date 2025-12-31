-- Test script to verify admin functions are working
-- Run this while logged in as an admin user in Supabase SQL editor
-- This will help us understand why the functions might not be returning true

-- Step 1: Check what the current user's auth.uid() is
-- (This query will show you your user ID when run as an authenticated user)
SELECT 
    auth.uid() AS current_user_id,
    auth.email() AS current_user_email;

-- Step 2: Check your organization memberships and roles
SELECT 
    om.user_id,
    om.organization_id,
    om.role,
    o.name AS organization_name
FROM organization_members om
JOIN organizations o ON om.organization_id = o.id
WHERE om.user_id = auth.uid()
ORDER BY om.created_at DESC;

-- Step 3: Test the is_admin_or_manager_in_org function
-- Replace ORG_ID_HERE with one of your organization IDs from Step 2
-- SELECT public.is_admin_or_manager_in_org('ORG_ID_HERE'::uuid) AS is_admin_in_org;

-- Step 4: Check what appointments exist and their organization_ids
SELECT 
    COUNT(*) as total_appointments,
    COUNT(DISTINCT organization_id) as unique_organizations,
    COUNT(CASE WHEN organization_id IS NULL THEN 1 END) as appointments_without_org
FROM appointments;

-- Step 5: See appointments with their organization info
SELECT 
    a.id,
    a.organization_id,
    a.homeowner_id,
    a.cleaner_id,
    a.status,
    a.scheduled_date,
    o.name AS organization_name
FROM appointments a
LEFT JOIN organizations o ON a.organization_id = o.id
ORDER BY a.created_at DESC
LIMIT 20;

-- Step 6: Check if you can see appointments (this tests RLS directly)
-- Run this as an admin user - it should return rows if policies are working
SELECT 
    id,
    organization_id,
    homeowner_id,
    cleaner_id,
    status,
    scheduled_date
FROM appointments
LIMIT 10;

-- Step 7: Test the user_shares_org_with_homeowner function
-- Replace HOMEOWNER_ID_HERE with a homeowner_id from an appointment
-- SELECT public.user_shares_org_with_homeowner('HOMEOWNER_ID_HERE'::uuid) AS shares_org_with_homeowner;

-- Step 8: Compare your org memberships with appointment org_ids
-- This shows if there's a mismatch
WITH user_orgs AS (
    SELECT organization_id, role
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role IN ('owner', 'admin', 'manager')
)
SELECT 
    uo.organization_id,
    uo.role AS user_role,
    COUNT(a.id) AS appointment_count
FROM user_orgs uo
LEFT JOIN appointments a ON a.organization_id = uo.organization_id
GROUP BY uo.organization_id, uo.role
ORDER BY appointment_count DESC;

