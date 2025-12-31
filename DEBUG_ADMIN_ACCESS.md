# Debugging Admin Access Issues

## Steps to Debug

1. **Run the diagnostic script** (migration 016) to see what policies currently exist:
   ```sql
   -- Run: 016_diagnostic_check_rls_policies.sql
   ```

2. **Check if organization_members policy exists**:
   - The policy "Users can view members of their organization" should exist (from migration 006)
   - If it doesn't exist, admin policies won't work because they all depend on querying organization_members

3. **Apply the comprehensive fix** (migration 017):
   ```sql
   -- Run: 017_comprehensive_admin_fix.sql
   ```

4. **Verify the admin user is in organization_members**:
   ```sql
   SELECT * FROM organization_members 
   WHERE user_id = '<admin-user-id>' 
   AND role IN ('admin', 'owner', 'manager');
   ```

5. **Check if appointments have organization_id set**:
   ```sql
   SELECT id, organization_id, homeowner_id 
   FROM appointments 
   LIMIT 10;
   ```

6. **Test a simple query as the admin user**:
   ```sql
   -- This should return rows if RLS is working
   SELECT COUNT(*) FROM appointments;
   ```

## Common Issues

1. **organization_members policy missing**: If migration 006 wasn't run, admin policies won't work
2. **Appointments without organization_id**: The policy has a fallback for this case
3. **Admin user not in organization_members**: The admin must be in the organization_members table
4. **Homeowners not in organization_members**: If appointments use the fallback logic, homeowners must be in organization_members

