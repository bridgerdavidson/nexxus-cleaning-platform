# Generate TypeScript Types from Database

## **Option 1: Supabase CLI (Recommended)**

If you have Supabase CLI installed:

```bash
# Generate types automatically from your database
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.types.ts
```

**To get your project ID:**
1. Go to Supabase Dashboard
2. Settings → General
3. Copy "Reference ID"

---

## **Option 2: Manual Type Generation SQL**

Run this in Supabase SQL Editor to see what types you need:

```sql
-- Generate a type definition report
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name IN (
    'user_profiles',
    'cleaner_profiles', 
    'properties',
    'appointments',
    'service_types',
    'payments',
    'messages',
    'reviews'
)
ORDER BY table_name, ordinal_position;
```

Then manually update your TypeScript interfaces to match.

---

## **Option 3: Use Supabase Studio**

1. Go to Supabase Dashboard
2. Database → Tables
3. Click on each table to see its structure
4. Update your TypeScript interfaces accordingly

---

## **Best Practice: Keep Types in Sync**

### **1. Single Source of Truth**
Use Supabase as the single source of truth. Generate types from DB, don't manually maintain them.

### **2. After Every Migration**
After running a migration, regenerate types:
```bash
npm run generate-types
```

### **3. Add to package.json**
```json
{
  "scripts": {
    "generate-types": "supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.types.ts"
  }
}
```

### **4. Use Generated Types**
Instead of manually creating interfaces, import from generated types:

```typescript
import { Database } from '@/types/database.types';

type Appointment = Database['public']['Tables']['appointments']['Row'];
type AppointmentInsert = Database['public']['Tables']['appointments']['Insert'];
type AppointmentUpdate = Database['public']['Tables']['appointments']['Update'];
```

---

## **Common Mismatches to Watch For:**

| Code Usually Says | Database Usually Has |
|------------------|---------------------|
| `special_instructions` | `special_requests` |
| `estimated_duration` | `duration_minutes` |
| `user_id` (in cleaner_profiles) | `id` (references user_profiles) |
| `firstName` | `first_name` |

---

## **Quick Check Command**

Add this to your workflow to catch mismatches early:

```bash
# Check if types are out of sync
npm run generate-types && git diff src/types/database.types.ts
```

If there are differences, your schema changed!

