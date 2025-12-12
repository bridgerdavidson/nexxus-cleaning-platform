-- Add policy to allow managers to view their own permissions
-- This policy must come before the admin policy to ensure managers can access their permissions
CREATE POLICY "Managers can view their own permissions" ON public.manager_permissions
    FOR SELECT USING (auth.uid() = manager_id);

