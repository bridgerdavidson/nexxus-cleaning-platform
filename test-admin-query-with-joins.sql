-- Test the exact query structure used by the app
-- Run this as an admin user to see if the joins are causing issues
-- Organization ID from your test: 'aba70ac8-2e5f-4a30-95c1-76f2e80c59a0'

-- Test 1: Simple query without joins (should work based on previous test)
SELECT 
    id,
    scheduled_date,
    scheduled_time,
    status,
    total_price,
    organization_id
FROM appointments
WHERE organization_id = 'aba70ac8-2e5f-4a30-95c1-76f2e80c59a0'
ORDER BY scheduled_date DESC
LIMIT 5;

-- Test 2: Query with homeowner join (using actual SQL syntax)
SELECT 
    a.id,
    a.scheduled_date,
    a.scheduled_time,
    a.status,
    a.total_price,
    h.first_name as homeowner_first_name,
    h.last_name as homeowner_last_name,
    h.email as homeowner_email
FROM appointments a
LEFT JOIN user_profiles h ON a.homeowner_id = h.id
WHERE a.organization_id = 'aba70ac8-2e5f-4a30-95c1-76f2e80c59a0'
ORDER BY a.scheduled_date DESC
LIMIT 5;

-- Test 3: Full query with all joins (testing if RLS allows these joins)
-- This tests the same data the app tries to fetch, but using SQL JOIN syntax
SELECT 
    a.id,
    a.scheduled_date,
    a.scheduled_time,
    a.status,
    a.total_price,
    a.special_requests,
    a.notes,
    -- Homeowner data
    h.first_name as homeowner_first_name,
    h.last_name as homeowner_last_name,
    h.email as homeowner_email,
    -- Cleaner data (if exists)
    cp.id as cleaner_profile_id,
    cu.first_name as cleaner_first_name,
    cu.last_name as cleaner_last_name,
    -- Property data
    p.name as property_name,
    p.address as property_address,
    p.city as property_city,
    p.state as property_state,
    -- Service type data
    st.name as service_type_name,
    st.description as service_type_description
FROM appointments a
LEFT JOIN user_profiles h ON a.homeowner_id = h.id
LEFT JOIN cleaner_profiles cp ON a.cleaner_id = cp.id
LEFT JOIN user_profiles cu ON cp.id = cu.id
LEFT JOIN properties p ON a.property_id = p.id
LEFT JOIN service_types st ON a.service_type_id = st.id
WHERE a.organization_id = 'aba70ac8-2e5f-4a30-95c1-76f2e80c59a0'
ORDER BY a.scheduled_date DESC;

-- Test 4: Check if you can query user_profiles for homeowners
SELECT 
    id,
    first_name,
    last_name,
    email
FROM user_profiles
WHERE id IN (
    SELECT DISTINCT homeowner_id 
    FROM appointments 
    WHERE organization_id = 'aba70ac8-2e5f-4a30-95c1-76f2e80c59a0'
)
LIMIT 5;

-- Test 5: Check if you can query properties
SELECT 
    id,
    name,
    address,
    city,
    state
FROM properties
WHERE id IN (
    SELECT DISTINCT property_id 
    FROM appointments 
    WHERE organization_id = 'aba70ac8-2e5f-4a30-95c1-76f2e80c59a0'
)
LIMIT 5;

