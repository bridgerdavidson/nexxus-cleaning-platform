# Sync Production Database from Dev

Since dev works but prod doesn't, we need to compare and sync the policies/functions.

## Step 1: Export Dev Policies

Run `export-dev-policies.sql` in your **DEV** database and save the results. This will show us:
- All RLS policies on appointments, user_profiles, and properties
- All helper function definitions
- Which migrations have been applied

## Step 2: Export Prod Policies

Run `export-dev-policies.sql` in your **PROD** database and save those results too.

## Step 3: Compare

Compare the results to see:
- Which policies exist in dev but not prod
- Which policies have different definitions
- Which functions exist in dev but not prod (or have different definitions)

## Step 4: Quick Alternative - Check Applied Migrations

If your Supabase setup tracks applied migrations, check:

**In Dev:**
```sql
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY executed_at DESC;
```

**In Prod:**
```sql
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY executed_at DESC;
```

Compare the lists - if dev has more migrations, apply the missing ones to prod.

## Step 5: Apply Missing Migrations

If dev has migrations that prod doesn't have, apply them to prod. The migrations are in `supabase/migrations/` directory.

## Alternative: Use Supabase CLI to Diff

If you have Supabase CLI set up:

```bash
# Generate a diff between dev and prod
supabase db diff --linked --schema public

# Or if you have local vs remote
supabase db diff --db-url "prod_connection_string" --schema public
```

This will show you the SQL differences between the databases.




