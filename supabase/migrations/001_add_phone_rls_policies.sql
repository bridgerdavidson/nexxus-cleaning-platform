-- Migration: Add phone RLS policies and search optimization for customer management
-- This migration adds the necessary policies for admins/managers to access homeowner profiles

-- Add index for phone number search optimization
CREATE INDEX IF NOT EXISTS idx_user_profiles_phone ON user_profiles(phone);

-- Add index for email search optimization (if not exists)
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);

-- Add index for name search optimization
CREATE INDEX IF NOT EXISTS idx_user_profiles_first_name ON user_profiles(first_name);
CREATE INDEX IF NOT EXISTS idx_user_profiles_last_name ON user_profiles(last_name);

-- Drop existing policies if they exist (to allow re-running migration)
DROP POLICY IF EXISTS "Admins and managers can view org homeowners" ON user_profiles;
DROP POLICY IF EXISTS "Admins and managers can update org homeowners" ON user_profiles;
DROP POLICY IF EXISTS "Admins and managers can delete org homeowners" ON user_profiles;
DROP POLICY IF EXISTS "Admins and managers can insert homeowners" ON user_profiles;

-- RLS policy for admins/managers to view homeowner profiles in their organization
CREATE POLICY "Admins and managers can view org homeowners" ON user_profiles
    FOR SELECT USING (
        -- Allow users to always see their own profile
        auth.uid() = id
        OR
        -- Allow admins/managers to see homeowners in their organization
        (
            role = 'homeowner' AND
            EXISTS (
                SELECT 1 FROM organization_members om_viewer
                WHERE om_viewer.user_id = auth.uid()
                AND om_viewer.role IN ('owner', 'admin', 'manager')
                AND om_viewer.organization_id IN (
                    SELECT om_target.organization_id 
                    FROM organization_members om_target
                    WHERE om_target.user_id = user_profiles.id
                )
            )
        )
    );

-- RLS policy for admins/managers to update homeowner profiles in their organization
CREATE POLICY "Admins and managers can update org homeowners" ON user_profiles
    FOR UPDATE USING (
        -- Allow users to update their own profile
        auth.uid() = id
        OR
        -- Allow admins/managers to update homeowners in their organization
        (
            role = 'homeowner' AND
            EXISTS (
                SELECT 1 FROM organization_members om_viewer
                WHERE om_viewer.user_id = auth.uid()
                AND om_viewer.role IN ('owner', 'admin', 'manager')
                AND om_viewer.organization_id IN (
                    SELECT om_target.organization_id 
                    FROM organization_members om_target
                    WHERE om_target.user_id = user_profiles.id
                )
            )
        )
    );

-- RLS policy for admins/managers to delete homeowner profiles in their organization
CREATE POLICY "Admins and managers can delete org homeowners" ON user_profiles
    FOR DELETE USING (
        role = 'homeowner' AND
        EXISTS (
            SELECT 1 FROM organization_members om_viewer
            WHERE om_viewer.user_id = auth.uid()
            AND om_viewer.role IN ('owner', 'admin', 'manager')
            AND om_viewer.organization_id IN (
                SELECT om_target.organization_id 
                FROM organization_members om_target
                WHERE om_target.user_id = user_profiles.id
            )
        )
    );

-- RLS policy for admins/managers to insert new homeowner profiles
CREATE POLICY "Admins and managers can insert homeowners" ON user_profiles
    FOR INSERT WITH CHECK (
        -- Allow users to insert their own profile
        auth.uid() = id
        OR
        -- Allow admins/managers to create homeowner profiles
        (
            role = 'homeowner' AND
            EXISTS (
                SELECT 1 FROM organization_members om
                WHERE om.user_id = auth.uid()
                AND om.role IN ('owner', 'admin', 'manager')
            )
        )
    );

