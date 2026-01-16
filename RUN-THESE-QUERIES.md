# Run These Queries to Compare Dev vs Prod

Since the SQL editor might only show the last query result, run these **one at a time**:

## In DEV Database:

### Query 1: Appointments Policies
```sql
SELECT 'appointments' as table_name, policyname, cmd
FROM pg_policies
WHERE tablename = 'appointments'
ORDER BY policyname;
```

### Query 2: User Profiles Policies
```sql
SELECT 'user_profiles' as table_name, policyname, cmd
FROM pg_policies
WHERE tablename = 'user_profiles'
ORDER BY policyname;
```

### Query 3: Properties Policies
```sql
SELECT 'properties' as table_name, policyname, cmd
FROM pg_policies
WHERE tablename = 'properties'
ORDER BY policyname;
```

### Query 4: Functions (you already have this)
```sql
SELECT p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
    AND p.proname IN (
        'is_admin_or_manager_in_org',
        'user_shares_org_with_homeowner',
        'get_user_organization_ids',
        'users_share_organization'
    )
ORDER BY p.proname;
```

## Then run the SAME 4 queries in PROD

Compare the results - any policies that exist in DEV but not PROD need to be added to PROD.




