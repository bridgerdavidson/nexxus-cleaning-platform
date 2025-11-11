# Security Update: App Metadata for Role Assignment

## 🔒 What Changed

Your application has been updated to use **app_metadata** instead of **user_metadata** for role assignment. This is a critical security improvement.

---

## 🚨 Security Issue (Before)

**Previously**, roles were stored in `user_metadata`:
```typescript
// INSECURE - Users could manipulate their role
await supabase.auth.signUp({
  email,
  password,
  options: {
    data: {
      role: 'admin' // ❌ User could set this to 'admin'
    }
  }
});
```

This was insecure because:
- Users could inspect network requests and modify the `role` field
- A malicious user could elevate themselves to `admin`
- No server-side validation of roles

---

## ✅ New Secure Implementation

**Now**, roles are stored in `app_metadata` using the service role:
```typescript
// SECURE - Only service role can set role
await supabaseAdmin.auth.admin.createUser({
  email,
  password,
  user_metadata: {
    first_name: 'John',
    last_name: 'Doe'
  },
  app_metadata: {
    role: 'homeowner' // ✅ Only backend can set this
  }
});
```

---

## 📁 Files Changed

### 1. Database Function (`supabase/schema.sql`)
```sql
-- Now reads from app_metadata (line 264)
COALESCE(NEW.raw_app_meta_data->>'role', 'homeowner')::user_role
```

### 2. New Secure API Route (`src/app/api/auth/signup/route.ts`)
- Uses `supabaseAdmin` client
- Sets role in `app_metadata`
- Only accessible server-side

### 3. Updated Auth Hook (`src/hooks/useAuth.ts`)
- Calls API route instead of direct signup
- No longer passes role in user_metadata

### 4. Migration Script (`supabase/migrations/002_update_handle_new_user_app_metadata.sql`)
- Updates the database trigger
- Can be applied to your Supabase project

---

## 🚀 How to Apply

### Option 1: Using Supabase CLI (Recommended)
```bash
# If you have Supabase CLI installed
supabase db push

# Or apply the migration directly
supabase db execute -f supabase/migrations/002_update_handle_new_user_app_metadata.sql
```

### Option 2: Supabase Dashboard (SQL Editor)
1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy the contents of `supabase/migrations/002_update_handle_new_user_app_metadata.sql`
4. Paste and run the SQL

### Option 3: Programmatic Migration
Create a page to run the migration (already exists: `src/app/migrate-db/page.tsx`):
```typescript
// You can add this to your existing migration page
const updateFunction = `
  DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
  DROP FUNCTION IF EXISTS public.handle_new_user();
  
  CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER AS $$
  BEGIN
      INSERT INTO public.user_profiles (id, email, first_name, last_name, role)
      VALUES (
          NEW.id,
          NEW.email,
          COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
          COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
          COALESCE(NEW.raw_app_meta_data->>'role', 'homeowner')::user_role
      );
      RETURN NEW;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;
  
  CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
`;
```

---

## 🔑 Environment Variables Required

Make sure you have the service role key set:

```env
# .env.local
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # Required for admin operations
```

**⚠️ WARNING:** Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client!
- Only use in server-side API routes
- Never include in client-side code
- The service role has full database access

---

## 🧪 Testing the Changes

### Test 1: Create a New User
```bash
# Should work - creates homeowner by default
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!",
    "firstName": "Test",
    "lastName": "User",
    "role": "homeowner"
  }'
```

### Test 2: Try to Create Admin (Should Validate)
```bash
# Should work - API validates role
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "Admin123!",
    "firstName": "Admin",
    "lastName": "User",
    "role": "admin"
  }'
```

### Test 3: Check Database
```sql
-- In Supabase SQL Editor
SELECT 
  u.id,
  u.email,
  u.raw_app_meta_data->>'role' as app_role,
  up.role as profile_role
FROM auth.users u
LEFT JOIN user_profiles up ON u.id = up.id;
```

---

## 📊 Metadata Types Comparison

| Type | Settable By | Use Case | Security |
|------|-------------|----------|----------|
| **user_metadata** | User & Service Role | Name, preferences, avatar | ⚠️ Low - User can modify |
| **app_metadata** | Service Role Only | Roles, permissions, internal flags | ✅ High - Server-only |

---

## 🔄 Migration Path for Existing Users

If you have existing users with roles in `user_metadata`, run this migration:

```sql
-- Copy roles from user_metadata to app_metadata for existing users
-- Run this ONCE after deploying the new function

-- This requires service role access
UPDATE auth.users
SET raw_app_meta_data = 
  COALESCE(raw_app_meta_data, '{}'::jsonb) || 
  jsonb_build_object('role', 
    COALESCE(raw_user_meta_data->>'role', 'homeowner')
  )
WHERE raw_app_meta_data->>'role' IS NULL;
```

---

## 📝 Best Practices Going Forward

1. **Always use app_metadata for:**
   - User roles
   - Permissions
   - Internal flags
   - Subscription status
   - Any security-sensitive data

2. **Use user_metadata for:**
   - User preferences (theme, language)
   - Display name
   - Avatar URL
   - Public profile information

3. **Never trust client-side data for:**
   - Role assignment
   - Permission checks
   - Security decisions

---

## 🆘 Troubleshooting

### Issue: "Service role key not found"
**Solution:** Add `SUPABASE_SERVICE_ROLE_KEY` to your `.env.local` file

### Issue: "Function already exists"
**Solution:** Run `DROP FUNCTION public.handle_new_user();` first

### Issue: "Role not being set correctly"
**Solution:** Check that the trigger is active:
```sql
SELECT * FROM pg_trigger 
WHERE tgname = 'on_auth_user_created';
```

### Issue: "Users can't sign up"
**Solution:** Check API route logs and ensure service role key is valid

---

## 📚 Resources

- [Supabase Auth Metadata Docs](https://supabase.com/docs/guides/auth/managing-user-data)
- [Database Triggers](https://supabase.com/docs/guides/database/postgres/triggers)
- [RLS Best Practices](https://supabase.com/docs/guides/database/postgres/row-level-security)

---

## ✅ Checklist

- [ ] Environment variable `SUPABASE_SERVICE_ROLE_KEY` is set
- [ ] Database migration has been applied
- [ ] Trigger `on_auth_user_created` exists and is active
- [ ] New signups use `/api/auth/signup` endpoint
- [ ] Existing users migrated (if applicable)
- [ ] Tested user creation with different roles
- [ ] Verified roles are in `app_metadata`, not `user_metadata`

---

**Date Updated:** $(date)
**Migration Version:** 002
**Security Level:** ✅ High

