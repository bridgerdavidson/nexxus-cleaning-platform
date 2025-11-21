# Updated RLS Fix Instructions - Resolving Login Error

## The Problem

You're seeing "Error loading user profile: {}" when logging in as an admin. This is caused by a **circular dependency** in the RLS policies:

1. To load your profile, the system queries `user_profiles`
2. The new RLS policies check if you're an admin by querying `user_profiles`
3. But that requires accessing `user_profiles` first! ⚠️ **Circular dependency**

Additionally, **existing users** (created before our fixes) don't have their role stored in the JWT token's `app_metadata`, which the new policies rely on.

## The Solution

We need to:
1. ✅ **Sync existing users' roles** from `user_profiles` to `auth.users` app_metadata
2. ✅ **Update RLS policies** to use JWT metadata instead of database lookups (eliminates circular dependency)

## Step-by-Step Fix

### Step 1: Run the Complete Fix Script

1. Open your **Supabase Dashboard**
2. Go to **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy the entire contents of `COMPLETE-RLS-FIX.sql`
5. Paste it into the SQL editor
6. Click **Run**

This script will:
- Sync all existing users' roles to their JWT tokens
- Replace the problematic RLS policies with JWT-based ones
- Show you a verification table at the end

### Step 2: Verify the Fix

After running the script, you should see a table showing all admin/manager users with their sync status:

```
✅ Synced - Role is properly set in JWT
❌ Out of sync - Needs manual attention
```

All users should show "✅ Synced".

### Step 3: Log Out and Back In

**IMPORTANT:** You must log out and log back in for the JWT token to refresh with the new role metadata.

1. Log out of your admin account
2. Log back in
3. The error should now be gone!

## Why This Works

### Before (Broken):
```sql
-- Policy checked database (circular dependency!)
CREATE POLICY "Admins can view all user profiles" ON user_profiles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() AND up.role = 'admin'
        )
    );
```

### After (Fixed):
```sql
-- Policy checks JWT token (no circular dependency!)
CREATE POLICY "Admins can view all user profiles" ON user_profiles
    FOR SELECT USING (
        (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
    );
```

The JWT token already contains your role from when you logged in, so there's no need to query the database.

## New Users Going Forward

All new admin/manager users created after this fix will automatically have their role in the JWT token because the signup API (`/api/auth/signup/route.ts`) already sets `app_metadata.role` correctly.

## Troubleshooting

### Error: "Failed to sync roles"
- Make sure you have permission to run the script
- Check that the `auth.users` table is accessible
- Try running Part 1 (sync) and Part 2 (policies) separately

### Still getting errors after login?
1. **Clear your browser cache** completely
2. **Log out** and close all browser tabs
3. **Log back in** (this forces a new JWT token)
4. Check the browser console for the actual error message

### Verify your role is set correctly:
Run this query in Supabase SQL Editor:

```sql
SELECT 
    id, 
    email, 
    raw_app_meta_data->>'role' as role_in_jwt
FROM auth.users 
WHERE email = 'your-admin-email@example.com';
```

The `role_in_jwt` column should show 'admin' or 'manager'.

## Files You Can Delete

After successfully applying this fix, you can delete these obsolete files:
- `apply-rls-fixes.sql` (replaced by COMPLETE-RLS-FIX.sql)
- `fix-rls-circular-dependency.sql` (merged into COMPLETE-RLS-FIX.sql)
- `fix-existing-users-metadata.sql` (merged into COMPLETE-RLS-FIX.sql)
- `RLS-FIX-INSTRUCTIONS.md` (replaced by this file)

## Summary

✅ **Fixed signup redirect** - No more success page
✅ **Fixed circular dependency** - Policies use JWT instead of database queries
✅ **Fixed existing users** - Roles synced to JWT tokens
✅ **Fixed cleaner names** - Admins/managers can now see all user data

After running `COMPLETE-RLS-FIX.sql` and logging out/in, everything should work! 🎉

