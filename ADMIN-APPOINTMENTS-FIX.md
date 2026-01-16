# Fix: Admin Cannot See Appointments in Production

## Problem
Admins cannot see appointments in production, but cleaners and managers can see them correctly.

## Root Cause Analysis

The issue is likely related to Row Level Security (RLS) policies on the `appointments` table. The policies use SECURITY DEFINER functions (`is_admin_or_manager_in_org` and `user_shares_org_with_homeowner`) to check if a user is an admin/manager in an organization. 

Possible causes:
1. The helper functions don't exist in production
2. The functions aren't marked as SECURITY DEFINER
3. The functions aren't owned by postgres (required for RLS bypass)
4. The functions lack proper execute permissions
5. The RLS policies are missing or incorrectly defined

## Solution

### Step 1: Run Diagnostic Script

Run `debug-admin-appointments.sql` in your Supabase SQL editor to check the current state of your database. This will show:
- Whether the helper functions exist and are configured correctly
- Current RLS policies on appointments table
- Sample data (admins, organizations, appointments)
- Function permissions

**Important**: Run this as an admin user (postgres) in Supabase, not as a regular user.

### Step 2: Review Diagnostic Results

Look for:
- Functions that don't exist or aren't SECURITY DEFINER
- Missing or incorrect RLS policies
- Admin users that aren't in organization_members with the correct role
- Appointments without organization_id set

### Step 3: Apply Fix Migration

Apply the migration `019_fix_admin_appointments_access.sql` which:
- Ensures the SECURITY DEFINER functions are correctly defined
- Makes sure functions are owned by postgres
- Grants proper execute permissions
- Recreates the RLS policies correctly

To apply:
1. Copy the contents of `supabase/migrations/019_fix_admin_appointments_access.sql`
2. Run it in your Supabase SQL editor (as postgres/admin)
3. Verify the migration completed successfully

### Step 4: Test the Fix

1. Log in as an admin user in your production app
2. Navigate to the admin dashboard
3. Check if appointments are now visible
4. Verify that managers can still see appointments (regression test)

## Files Created

1. **debug-admin-appointments.sql** - Diagnostic script to check database state
2. **supabase/migrations/019_fix_admin_appointments_access.sql** - Fix migration
3. **test-admin-access.sql** - Additional test script for verification

## How the Fix Works

The RLS policy for appointments uses two SECURITY DEFINER functions:

1. `is_admin_or_manager_in_org(organization_id)` - Checks if the current user is an admin/manager/owner in the given organization
2. `user_shares_org_with_homeowner(homeowner_id)` - Checks if the current admin/manager shares an organization with the homeowner

These functions run with postgres privileges (SECURITY DEFINER), which allows them to bypass RLS when querying the `organization_members` table. This prevents circular dependency issues.

The policy allows access if:
- User is the homeowner
- User is the cleaner
- User is an admin/manager in the appointment's organization (via `is_admin_or_manager_in_org`)
- User is an admin/manager who shares an org with the homeowner (via `user_shares_org_with_homeowner`)

## Additional Notes

- If the issue persists after applying the fix, check the diagnostic results for data inconsistencies
- Ensure admin users have entries in `organization_members` with role 'admin', 'manager', or 'owner'
- Ensure appointments have `organization_id` set correctly
- The functions must be owned by postgres (superuser) for SECURITY DEFINER to work properly




