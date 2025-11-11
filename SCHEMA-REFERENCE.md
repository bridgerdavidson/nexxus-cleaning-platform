# Database Schema Reference

This document shows the **actual** column names in your database vs what you might expect in code.

## **Critical Column Name Mappings**

### **⚠️ Common Mismatches**

| Table | ❌ Wrong Name (Code) | ✅ Correct Name (DB) |
|-------|---------------------|---------------------|
| `appointments` | `special_instructions` | `special_requests` |
| `service_types` | `estimated_duration` | `duration_minutes` |
| `cleaner_profiles` | `user_id` | `id` (FK to user_profiles) |
| `properties` | N/A | `name` (required) |

---

## **Table Schemas**

### **1. user_profiles**
```sql
id UUID PRIMARY KEY (FK to auth.users)
email TEXT NOT NULL
first_name TEXT
last_name TEXT
phone TEXT
role user_role NOT NULL DEFAULT 'homeowner'
avatar_url TEXT
created_at TIMESTAMPTZ DEFAULT NOW()
updated_at TIMESTAMPTZ DEFAULT NOW()
```

**TypeScript Interface:**
```typescript
interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role: 'homeowner' | 'cleaner' | 'admin';
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}
```

---

### **2. cleaner_profiles**
```sql
id UUID PRIMARY KEY (FK to user_profiles)  -- ⚠️ NO user_id column!
bio TEXT
experience_years INTEGER
hourly_rate DECIMAL(10,2)
rating DECIMAL(3,2) DEFAULT 0.00
total_jobs INTEGER DEFAULT 0
is_available BOOLEAN DEFAULT true
background_check_verified BOOLEAN DEFAULT false
insurance_verified BOOLEAN DEFAULT false
created_at TIMESTAMPTZ DEFAULT NOW()
updated_at TIMESTAMPTZ DEFAULT NOW()
```

**Important:** `cleaner_profiles.id` IS the user's ID (references `user_profiles.id` directly).

---

### **3. appointments**
```sql
id UUID PRIMARY KEY
homeowner_id UUID NOT NULL (FK to user_profiles)
cleaner_id UUID (FK to cleaner_profiles)
property_id UUID NOT NULL (FK to properties)
service_type_id UUID NOT NULL (FK to service_types)
scheduled_date DATE NOT NULL
scheduled_time TIME NOT NULL
duration_minutes INTEGER NOT NULL
status appointment_status DEFAULT 'pending'
total_price DECIMAL(10,2) NOT NULL
special_requests TEXT      -- ⚠️ NOT special_instructions!
notes TEXT
created_at TIMESTAMPTZ DEFAULT NOW()
updated_at TIMESTAMPTZ DEFAULT NOW()
```

---

### **4. properties**
```sql
id UUID PRIMARY KEY
owner_id UUID NOT NULL (FK to user_profiles)
name TEXT NOT NULL
address TEXT NOT NULL
city TEXT NOT NULL
state TEXT NOT NULL
zip_code TEXT NOT NULL
bedrooms INTEGER
bathrooms INTEGER
square_feet INTEGER
special_instructions TEXT
access_instructions TEXT
created_at TIMESTAMPTZ DEFAULT NOW()
updated_at TIMESTAMPTZ DEFAULT NOW()
```

---

### **5. service_types**
```sql
id UUID PRIMARY KEY
name TEXT NOT NULL
description TEXT
base_price DECIMAL(10,2) NOT NULL
duration_minutes INTEGER NOT NULL  -- ⚠️ NOT estimated_duration!
service_type service_type NOT NULL
is_active BOOLEAN DEFAULT true
created_at TIMESTAMPTZ DEFAULT NOW()
```

---

### **6. payments**
```sql
id UUID PRIMARY KEY
appointment_id UUID NOT NULL (FK to appointments)
amount DECIMAL(10,2) NOT NULL
status payment_status DEFAULT 'pending'
stripe_payment_intent_id TEXT
paid_at TIMESTAMPTZ
created_at TIMESTAMPTZ DEFAULT NOW()
```

---

### **7. messages**
```sql
id UUID PRIMARY KEY
sender_id UUID NOT NULL (FK to user_profiles)
recipient_id UUID NOT NULL (FK to user_profiles)
appointment_id UUID (FK to appointments)
subject TEXT
content TEXT NOT NULL
is_read BOOLEAN DEFAULT false
created_at TIMESTAMPTZ DEFAULT NOW()
```

---

## **Quick Reference: Query Patterns**

### **Get Cleaner's Appointments**
```typescript
// ❌ WRONG
.eq('user_id', userId)  // cleaner_profiles has no user_id!

// ✅ CORRECT
.eq('id', userId)       // cleaner_profiles.id IS the user ID
```

### **Query Appointments**
```typescript
// ❌ WRONG
.select('special_instructions, estimated_duration')

// ✅ CORRECT
.select('special_requests, duration_minutes')
```

### **Foreign Key References**
```typescript
// Appointments → Cleaner Profile → User Profile
appointments.cleaner_id → cleaner_profiles.id → user_profiles.id
                          (same UUID)           (same UUID)
```

---

## **Schema Verification Checklist**

- [ ] Run `003_verify_schema.sql` migration
- [ ] Check all column names match this document
- [ ] Verify TypeScript interfaces match database
- [ ] Test all queries work without 400/42703 errors
- [ ] Generate fresh types with Supabase CLI

---

## **Update This Document**

Whenever you add/modify tables:
1. Update `supabase/schema.sql`
2. Run the migration in Supabase
3. Update this `SCHEMA-REFERENCE.md`
4. Regenerate TypeScript types
5. Update any affected hooks/components

---

**Last Updated:** 2025-01-10
**Schema Version:** 003

