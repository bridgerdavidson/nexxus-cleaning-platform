# ✅ Schema Verification Checklist

Use this checklist when writing **any** Supabase queries or TypeScript interfaces.

---

## 📋 Before Writing Queries

- [ ] I have reviewed `DB-SCHEMA-REFERENCE.md` for the latest schema
- [ ] I'm using the correct table and column names (snake_case)
- [ ] I'm handling nullable fields correctly

---

## 🔍 Common Column Names (MUST USE THESE!)

| ❌ WRONG | ✅ CORRECT | Table |
|---------|-----------|-------|
| `estimated_duration` | `duration_minutes` | `service_types` |
| `appointments.special_instructions` | `appointments.special_requests` | `appointments` |
| `cleaner_profiles.user_id` | `cleaner_profiles.id` | `cleaner_profiles` |
| `appointment_status = 'approved'` | `appointment_status = 'confirmed'` | `appointments` |
| `payment_status = 'completed'` | `payment_status = 'paid'` | `payments` |

---

## 🎯 Key Foreign Key Relationships

### ✅ CORRECT Ways to Query

```typescript
// ✅ Query cleaner profile (id IS the user_id)
await supabase
  .from('cleaner_profiles')
  .select('*')
  .eq('id', userId); // NOT .eq('user_id', userId)

// ✅ Query appointments by cleaner
await supabase
  .from('appointments')
  .select('*')
  .eq('cleaner_id', userId); // cleaner_id references cleaner_profiles(id)

// ✅ Select with proper column names
await supabase
  .from('appointments')
  .select(`
    id,
    special_requests,  // NOT special_instructions
    notes,
    service_type:service_types(
      name,
      duration_minutes  // NOT estimated_duration
    )
  `);
```

### ❌ INCORRECT Ways (Will Fail!)

```typescript
// ❌ Wrong: cleaner_profiles has no user_id column
await supabase
  .from('cleaner_profiles')
  .select('*')
  .eq('user_id', userId); // ERROR: column does not exist

// ❌ Wrong: column name doesn't exist
await supabase
  .from('appointments')
  .select('special_instructions'); // ERROR: column does not exist

// ❌ Wrong: column name doesn't exist
await supabase
  .from('service_types')
  .select('estimated_duration'); // ERROR: column does not exist
```

---

## 📊 Table Relationships Quick Reference

```
user_profiles (id)
    ├── cleaner_profiles (id) [1:1 - id IS the foreign key]
    ├── properties (owner_id) [1:many]
    ├── appointments (homeowner_id) [1:many]
    └── messages (sender_id, recipient_id) [1:many]

cleaner_profiles (id)
    └── appointments (cleaner_id) [1:many]

properties (id)
    └── appointments (property_id) [1:many]

service_types (id)
    └── appointments (service_type_id) [1:many]

appointments (id)
    ├── payments (appointment_id) [1:1]
    ├── reviews (appointment_id) [1:many]
    └── messages (appointment_id) [1:many]
```

---

## 🔒 ENUM Values Reference

### `user_role`
```typescript
'homeowner' | 'cleaner' | 'admin'
```

### `appointment_status`
```typescript
'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
```
**Note:** Use `'confirmed'` NOT `'approved'`

### `service_type`
```typescript
'regular' | 'deep' | 'move_out' | 'custom'
```

### `payment_status`
```typescript
'pending' | 'paid' | 'failed' | 'refunded'
```
**Note:** Use `'paid'` NOT `'completed'`

---

## 🛠️ TypeScript Interface Naming

When creating new interfaces in `src/types/index.ts`:

✅ **DO:**
- Use exact database column names (snake_case)
- Mark nullable fields with `| null` (NOT `?` unless truly optional)
- Document references in comments
- Check `DB-SCHEMA-REFERENCE.md` first

❌ **DON'T:**
- Use camelCase for database fields
- Mix snake_case and camelCase
- Assume column names without checking
- Create types that don't match the schema

---

## 🚨 Before Deploying

- [ ] All queries use correct column names
- [ ] All TypeScript interfaces match database schema
- [ ] Foreign key relationships are correct
- [ ] ENUM values match database exactly
- [ ] Nullable fields are handled properly
- [ ] No references to non-existent columns

---

## 📝 Quick Verification Command

Run this in **Supabase SQL Editor** to verify any table schema:

```sql
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'YOUR_TABLE_NAME'
ORDER BY ordinal_position;
```

---

## 📚 See Also

- **`DB-SCHEMA-REFERENCE.md`** - Complete schema documentation
- **`supabase/schema.sql`** - Schema definition
- **`src/types/index.ts`** - TypeScript type definitions

---

**Last Updated:** November 11, 2025

