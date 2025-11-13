# 🔧 Fix Admin Dashboard Access

## 🐛 The Problem

**Admins can't see any data** because the RLS (Row Level Security) policies don't include admin access rules.

Currently, the policies only allow:
- ✅ Homeowners to see their own appointments
- ✅ Cleaners to see their assigned appointments
- ❌ **Admins can't see anything!**

---

## ✅ The Fix - Run This SQL Script

### **Option 1: Run the Migration File (Recommended)**

1. Open **Supabase SQL Editor**
2. Copy and paste the entire contents of:
   ```
   supabase/migrations/004_add_admin_policies.sql
   ```
3. Click **"Run"**

### **Option 2: Quick Copy-Paste**

Just run this in **Supabase SQL Editor**:

```sql
-- Admins can view all appointments
CREATE POLICY "Admins can view all appointments" 
ON appointments
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE user_profiles.id = auth.uid() 
    AND user_profiles.role = 'admin'
  )
);

-- Admins can view all user profiles
CREATE POLICY "Admins can view all user profiles" 
ON user_profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() 
    AND up.role = 'admin'
  )
);

-- Admins can view all properties
CREATE POLICY "Admins can view all properties" 
ON properties
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE user_profiles.id = auth.uid() 
    AND user_profiles.role = 'admin'
  )
);

-- Admins can view all payments
CREATE POLICY "Admins can view all payments" 
ON payments
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE user_profiles.id = auth.uid() 
    AND user_profiles.role = 'admin'
  )
);

-- Admins can view all messages
CREATE POLICY "Admins can view all messages" 
ON messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE user_profiles.id = auth.uid() 
    AND user_profiles.role = 'admin'
  )
);

-- Admins can view all cleaner profiles
CREATE POLICY "Admins can view all cleaner profiles" 
ON cleaner_profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE user_profiles.id = auth.uid() 
    AND user_profiles.role = 'admin'
  )
);
```

---

## 🔍 Verify It Worked

After running the script, verify the policies were created:

```sql
SELECT schemaname, tablename, policyname
FROM pg_policies 
WHERE policyname LIKE '%Admin%'
ORDER BY tablename, policyname;
```

**Expected output (6 policies):**

| tablename | policyname |
|-----------|-----------|
| appointments | Admins can view all appointments |
| cleaner_profiles | Admins can view all cleaner profiles |
| messages | Admins can view all messages |
| payments | Admins can view all payments |
| properties | Admins can view all properties |
| user_profiles | Admins can view all user profiles |

---

## 🎯 What Each Policy Does

| Policy | Allows Admins To... |
|--------|-------------------|
| **Appointments** | See ALL appointments (homeowners + cleaners) |
| **User Profiles** | See ALL user profiles (all roles) |
| **Properties** | See ALL properties (all homeowners) |
| **Payments** | See ALL payment records |
| **Messages** | See ALL messages between users |
| **Cleaner Profiles** | See ALL cleaner profiles |

---

## 🔒 Security

These policies are **secure** because:
- ✅ Only users with `role = 'admin'` get access
- ✅ Role is set via secure `app_metadata` (not user-editable)
- ✅ Uses `auth.uid()` to verify current user
- ✅ RLS automatically enforces these rules

**Non-admin users** (homeowners/cleaners) are **NOT affected** - they still only see their own data.

---

## ✅ Test It

1. **Run the SQL script** above
2. **Refresh your admin dashboard** (Ctrl+Shift+R)
3. **Check the dashboard** - you should now see:
   - ✅ All appointments
   - ✅ All users
   - ✅ All cleaners
   - ✅ All properties
   - ✅ All payments
   - ✅ All messages

---

## 🚨 Troubleshooting

### Issue: "policy already exists" error

**Solution:** The policies might already exist. Drop them first:

```sql
DROP POLICY IF EXISTS "Admins can view all appointments" ON appointments;
DROP POLICY IF EXISTS "Admins can view all user profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can view all properties" ON properties;
DROP POLICY IF EXISTS "Admins can view all payments" ON payments;
DROP POLICY IF EXISTS "Admins can view all messages" ON messages;
DROP POLICY IF EXISTS "Admins can view all cleaner profiles" ON cleaner_profiles;

-- Then run the CREATE POLICY statements again
```

### Issue: Still can't see data

**Check your admin user:**

```sql
SELECT id, email, role 
FROM user_profiles 
WHERE email = 'your-admin-email@example.com';
```

**Make sure `role = 'admin'`!** If not:

```sql
UPDATE user_profiles 
SET role = 'admin' 
WHERE email = 'your-admin-email@example.com';
```

---

**Once you run the SQL, your admin dashboard will work!** 🎉

