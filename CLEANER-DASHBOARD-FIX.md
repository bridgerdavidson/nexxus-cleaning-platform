# 🔧 Cleaner Dashboard Fix - Missing Homeowner & Property Data

## 🐛 The Problem

**Symptoms:**
- ❌ Homeowner names show as "Unknown Homeowner"
- ❌ Addresses show as "Address not available"
- ✅ Appointments load correctly
- ✅ Dates and times display correctly

**Root Cause:**
The **RLS (Row Level Security) policies** are blocking cleaners from seeing homeowner profiles and property data, even for appointments they're assigned to!

---

## 🔍 Diagnosis

1. **Check browser console** - You'll see logs like:
   ```
   📦 Raw appointments data: [...]
   🔍 First appointment raw: {...}
     - Homeowner: null  ❌
     - Property: null   ❌
   ```

2. **Current RLS Policies** block:
   - `user_profiles`: Only allows users to see their own profile
   - `properties`: Only allows homeowners to see their own properties
   
3. **Cleaners need to see**:
   - Homeowner profiles for their appointments
   - Property details for their appointments

---

## ✅ The Fix

### **Step 1: Run the SQL Migration**

Open **Supabase SQL Editor** and run this script:

```sql
-- supabase/migrations/003_fix_cleaner_access_policies.sql
```

Or copy/paste the contents of `supabase/migrations/003_fix_cleaner_access_policies.sql` into Supabase SQL Editor.

### **Step 2: Verify Policies Were Created**

Run this verification query:

```sql
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies 
WHERE tablename IN ('user_profiles', 'properties', 'cleaner_profiles')
AND policyname LIKE '%Cleaners%'
ORDER BY tablename, policyname;
```

**Expected output:**
```
| tablename      | policyname                                                  |
|----------------|-------------------------------------------------------------|
| properties     | Cleaners can view properties for their appointments         |
| user_profiles  | Cleaners can view homeowner profiles for their appointments |
```

### **Step 3: Refresh Your Dashboard**

1. Hard refresh the cleaner dashboard (Ctrl+Shift+R or Cmd+Shift+R)
2. Open browser console (F12)
3. Look for the logs:
   ```
   📦 Raw appointments data: [...]
   🔍 First appointment raw: {...}
     - Homeowner: {first_name: "John", last_name: "Smith", ...}  ✅
     - Property: {address: "123 Main St", city: "Phoenix", ...}  ✅
   ```

---

## 🎯 What the Migration Does

### Policy 1: Cleaners Can See Homeowner Profiles
```sql
CREATE POLICY "Cleaners can view homeowner profiles for their appointments" 
ON user_profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM appointments 
    WHERE appointments.homeowner_id = user_profiles.id 
    AND appointments.cleaner_id = auth.uid()
  )
);
```

**Translation:** "A cleaner can see a homeowner's profile IF that homeowner has an appointment assigned to the cleaner."

### Policy 2: Cleaners Can See Properties
```sql
CREATE POLICY "Cleaners can view properties for their appointments" 
ON properties
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM appointments 
    WHERE appointments.property_id = properties.id 
    AND appointments.cleaner_id = auth.uid()
  )
);
```

**Translation:** "A cleaner can see a property IF that property is linked to an appointment assigned to the cleaner."

---

## 🔒 Security Notes

These policies are **secure** because:
- ✅ Cleaners can ONLY see homeowner data for THEIR appointments
- ✅ Cleaners can ONLY see properties for THEIR appointments
- ✅ Cleaners CANNOT see all homeowners or all properties
- ✅ The policies use `auth.uid()` to verify the current user

---

## 📊 After the Fix

Your dashboard will show:

**Today's Schedule:**
```
┌─────────────────────────────────────────────────┐
│ 🟢 6:48 PM [●confirmed]                         │
│    John Smith                          ✅       │
│    123 Main St, Phoenix, AZ            ✅       │
│    Regular Cleaning                    $500     │
│                              [View Details]     │
└─────────────────────────────────────────────────┘
```

**Upcoming Jobs:**
- Will NOT show today's jobs (no duplicates)
- Will show future jobs with full details

---

## 🚨 Troubleshooting

### Issue: Still shows "Unknown Homeowner"

**Check:**
1. Did the SQL script run successfully?
2. Are there errors in the browser console?
3. Run the verification query above

### Issue: SQL Error "policy already exists"

**Solution:** The policies might already exist. Drop and recreate:

```sql
DROP POLICY IF EXISTS "Cleaners can view homeowner profiles for their appointments" ON user_profiles;
DROP POLICY IF EXISTS "Cleaners can view properties for their appointments" ON properties;

-- Then run the migration script again
```

---

## ✅ Checklist

- [ ] Run `003_fix_cleaner_access_policies.sql` in Supabase SQL Editor
- [ ] Verify policies with verification query
- [ ] Hard refresh cleaner dashboard
- [ ] Check browser console for logs
- [ ] Verify homeowner names appear
- [ ] Verify property addresses appear
- [ ] Verify today's jobs don't duplicate in "Upcoming Jobs"

---

**Once done, all cleaner dashboard data should display correctly!** 🎉

