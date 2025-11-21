# Database RLS Policy Fix Instructions

## What Was Fixed

### 1. Removed Success Page from Signup Flow ✅
- **Homeowner signup**: Now redirects directly to dashboard without intermediate success page
- **Admin signup**: Now redirects directly to dashboard without intermediate success page  
- **Manager signup**: Now redirects directly to dashboard without intermediate success page

### 2. Fixed Cleaner Names Showing as "Unknown" ✅

The issue was caused by Row Level Security (RLS) policies that prevented admins and managers from viewing user profile data when querying cleaner information.

**Changes Made:**
- Updated database queries to explicitly specify the join column (`user_profiles!id`)
- Created new RLS policies to allow admins and managers to view all user profiles, cleaner profiles, appointments, payments, and messages

## How to Apply the Database Changes

You need to run the SQL script to update your Supabase database with the new RLS policies.

### Option 1: Using Supabase Dashboard (Recommended)

1. Open your Supabase project dashboard
2. Navigate to the **SQL Editor** section in the left sidebar
3. Click **New Query**
4. Open the file `apply-rls-fixes.sql` from your project root
5. Copy and paste the entire contents into the SQL editor
6. Click **Run** to execute the script

### Option 2: Using Supabase CLI

If you have the Supabase CLI installed:

```bash
# Make sure you're in your project directory
cd c:\Builds\CleaningSolutions\nexxus-cleaning-platform

# Apply the migration
supabase db push

# Or run the SQL file directly
supabase db execute --file apply-rls-fixes.sql
```

### Option 3: Manual Execution

If you prefer, you can also run the migration files individually:

1. First run: `supabase/migrations/add_manager_role.sql`
2. Then run: `supabase/migrations/add_admin_manager_policies.sql`

## Verify the Fix

After applying the database changes:

1. **Test the signup flow:**
   - Create a new homeowner/admin/manager account
   - Verify you're redirected directly to the dashboard without seeing a success page

2. **Test cleaner data visibility:**
   - Log in as an admin or manager
   - Navigate to the cleaners section
   - Verify that cleaner names and information are now displayed correctly (not "Unknown")

## What the RLS Policies Do

The new policies allow:

- **Admins**: Full view access to all user profiles, cleaner profiles, appointments, payments, and messages
- **Managers**: Same view access as admins (but can be restricted later if needed)
- **Regular users**: Continue to see only their own data (existing behavior)

## Rollback (if needed)

If you encounter any issues, you can remove the policies by running:

```sql
DROP POLICY IF EXISTS "Admins can view all user profiles" ON user_profiles;
DROP POLICY IF EXISTS "Managers can view all user profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can view all cleaner profiles" ON cleaner_profiles;
DROP POLICY IF EXISTS "Managers can view all cleaner profiles" ON cleaner_profiles;
DROP POLICY IF EXISTS "Admins can view all appointments" ON appointments;
DROP POLICY IF EXISTS "Managers can view all appointments" ON appointments;
DROP POLICY IF EXISTS "Admins can update any appointment" ON appointments;
DROP POLICY IF EXISTS "Managers can update any appointment" ON appointments;
DROP POLICY IF EXISTS "Admins can view all payments" ON payments;
DROP POLICY IF EXISTS "Managers can view all payments" ON payments;
DROP POLICY IF EXISTS "Admins can view all messages" ON messages;
DROP POLICY IF EXISTS "Managers can view all messages" ON messages;
```

## Files Modified

### Frontend Changes (Already Applied)
- `src/app/signup/homeowner/page.tsx` - Removed success page
- `src/app/signup/admin/page.tsx` - Removed success page
- `src/app/signup/manager/page.tsx` - Removed success page
- `src/hooks/useAdminData.ts` - Fixed cleaner profile queries
- `src/hooks/useManagerData.ts` - Fixed cleaner profile queries

### Database Changes (Need to be Applied)
- `apply-rls-fixes.sql` - Combined script with all fixes
- `supabase/migrations/add_manager_role.sql` - Adds manager role to enum
- `supabase/migrations/add_admin_manager_policies.sql` - Adds RLS policies

## Need Help?

If you encounter any issues:
1. Check the Supabase logs for any error messages
2. Verify your admin/manager user has the correct role set in the database
3. Try refreshing your browser cache after applying the changes

