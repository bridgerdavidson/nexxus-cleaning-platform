# Quick Test Steps

## Step 1: Verify Migration Was Applied

Run this in PROD SQL editor to check if the policy exists:

```sql
SELECT policyname, cmd 
FROM pg_policies 
WHERE tablename = 'user_profiles' 
AND policyname = 'Users can view profiles of organization members';
```

If you get a row back, the policy exists. If empty, the migration didn't apply correctly.

## Step 2: Check Browser Console

1. Open your production app in browser
2. Log in as admin
3. Open Developer Tools (F12)
4. Go to Console tab
5. Look for any red error messages
6. Take a screenshot or copy the errors

## Step 3: Check Network Request

1. In Developer Tools, go to Network tab
2. Refresh the page
3. Filter for "appointments" 
4. Click on the request to `/rest/v1/appointments`
5. Check the Response tab - does it show data or empty array `[]`?
6. Check if there are any errors in the response

## Step 4: Test Query Directly

Run this in PROD SQL editor while logged in as admin:

```sql
-- Test if you can see homeowner profiles
SELECT up.id, up.first_name, up.last_name, up.email
FROM user_profiles up
WHERE up.id IN (
    SELECT DISTINCT homeowner_id 
    FROM appointments 
    WHERE organization_id = 'aba70ac8-2e5f-4a30-95c1-76f2e80c59a0'
)
LIMIT 5;
```

If this returns rows, the policy is working. If empty, the policy isn't working correctly.

