-- Test to verify the policy was created and is working
-- Run this while logged in as an admin user

-- 1. Check if the policy exists
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'user_profiles'
AND policyname = 'Users can view profiles of organization members';

-- 2. Test if you can query user_profiles for homeowners in your organization
-- This tests if the policy allows you to see homeowner profiles
SELECT 
    up.id,
    up.first_name,
    up.last_name,
    up.email,
    up.role
FROM user_profiles up
WHERE up.role = 'homeowner'
AND EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.homeowner_id = up.id
    AND a.organization_id = 'aba70ac8-2e5f-4a30-95c1-76f2e80c59a0'
)
LIMIT 5;

-- 3. Test the full appointment query with joins (same as the app uses)
-- This should work now if the policy is correct
SELECT 
    a.id,
    a.scheduled_date,
    a.scheduled_time,
    a.status,
    h.first_name as homeowner_first_name,
    h.last_name as homeowner_last_name,
    h.email as homeowner_email
FROM appointments a
LEFT JOIN user_profiles h ON a.homeowner_id = h.id
WHERE a.organization_id = 'aba70ac8-2e5f-4a30-95c1-76f2e80c59a0'
ORDER BY a.scheduled_date DESC
LIMIT 5;

-- 4. Test the users_share_organization function directly
-- Replace USER_ID_HERE with a homeowner ID from the appointments
-- This tests if the function works
-- SELECT public.users_share_organization(auth.uid(), 'USER_ID_HERE'::uuid);

