# Development Workflow: Keeping Schema in Sync

## **🎯 The Problem We're Solving**

Your database schema can get out of sync with your code, causing errors like:
- ❌ `column "special_instructions" does not exist`
- ❌ `column "user_id" does not exist`
- ❌ Type mismatches in TypeScript

---

## **✅ The Solution: Schema-First Workflow**

### **Rule #1: Database is the Source of Truth**
Always check the database first, not the code.

### **Rule #2: Migrations Over Manual Changes**
Never manually create columns in the Supabase dashboard. Use migration files.

### **Rule #3: Generate Types, Don't Write Them**
Use Supabase CLI to generate TypeScript types from your database.

---

## **📋 Step-by-Step Workflow**

### **When Adding a New Feature:**

#### **1. Write the Migration**
```bash
# Create a new migration file
touch supabase/migrations/004_add_feature_name.sql
```

Example migration:
```sql
-- Add new column to appointments
ALTER TABLE appointments 
ADD COLUMN customer_notes TEXT;

-- Verify it was added
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'appointments' AND column_name = 'customer_notes';
```

#### **2. Run the Migration**
In Supabase SQL Editor, copy and paste the migration content, then run it.

#### **3. Verify the Schema**
```sql
-- Check the column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'appointments';
```

#### **4. Generate TypeScript Types**
```bash
# Option A: Using Supabase CLI
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.types.ts

# Option B: Run the verification migration
# Run supabase/migrations/003_verify_schema.sql in Supabase
```

#### **5. Update Your Code**
Now update your TypeScript interfaces, hooks, and components to use the new column.

```typescript
// Import generated types
import { Database } from '@/types/database.types';

// Use them
type Appointment = Database['public']['Tables']['appointments']['Row'];
```

---

## **🔍 Before You Query: Verify Column Names**

### **Quick Check in Supabase:**
```sql
-- See what columns actually exist
\d appointments

-- Or use this query
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'appointments';
```

### **Common Column Name Patterns:**

| ✅ Database Convention | ❌ Code Often Assumes |
|---------------------|---------------------|
| `snake_case` | `camelCase` |
| `first_name` | `firstName` |
| `special_requests` | `specialRequests` |
| `duration_minutes` | `durationMinutes` |

**Supabase uses `snake_case` everywhere!**

---

## **🛠️ Tools to Keep in Sync**

### **1. Schema Verification Script**
Run this regularly:
```bash
# In Supabase SQL Editor
-- Run: supabase/migrations/003_verify_schema.sql
```

This will:
- Add any missing columns
- Show your current schema
- Report any issues

### **2. Type Generation Command**
Add to `package.json`:
```json
{
  "scripts": {
    "db:types": "supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.types.ts",
    "db:check": "npm run db:types && git diff src/types/database.types.ts"
  }
}
```

Then run:
```bash
npm run db:check
```

If you see differences, your schema changed!

### **3. Pre-commit Hook** (Optional)
Check types before committing:
```bash
# .git/hooks/pre-commit
#!/bin/bash
npm run db:types
git add src/types/database.types.ts
```

---

## **🚨 Debugging Schema Issues**

### **Error: "column does not exist"**

1. **Check actual column name:**
   ```sql
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'your_table';
   ```

2. **Update your query:**
   ```typescript
   // Change from:
   .select('special_instructions')
   
   // To:
   .select('special_requests')
   ```

3. **Update TypeScript interface:**
   ```typescript
   interface Appointment {
     special_requests?: string;  // Not special_instructions
   }
   ```

### **Error: "relation does not exist"**

Table might not be created yet. Run your migrations!

### **Error: Type mismatch**

Regenerate types: `npm run db:types`

---

## **📚 Reference Documents**

| Document | Purpose |
|----------|---------|
| `SCHEMA-REFERENCE.md` | Shows exact column names for all tables |
| `supabase/schema.sql` | Initial schema definition |
| `supabase/migrations/` | All schema changes over time |
| `scripts/generate-types.md` | How to generate TypeScript types |

---

## **✅ Daily Checklist**

Before starting development:
- [ ] Check `SCHEMA-REFERENCE.md` for column names
- [ ] Run latest migrations if any
- [ ] Verify types are up to date

When you get a database error:
- [ ] Check actual column name in Supabase
- [ ] Update code to match database
- [ ] Update TypeScript interface
- [ ] Document in `SCHEMA-REFERENCE.md` if it's a common issue

---

## **🎓 Best Practices**

### **DO:**
✅ Use `snake_case` for database columns  
✅ Run migrations for all schema changes  
✅ Generate types from database  
✅ Check `SCHEMA-REFERENCE.md` before querying  
✅ Keep migrations in version control  

### **DON'T:**
❌ Manually create columns in Supabase UI  
❌ Assume column names match code conventions  
❌ Hand-write TypeScript database types  
❌ Skip running migrations  
❌ Forget to document schema changes  

---

**Questions?** Check `SCHEMA-REFERENCE.md` first, then ask!

