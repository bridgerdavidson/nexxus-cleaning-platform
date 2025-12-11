-- Migration: Add RLS policies for admins/managers to manage properties (FIXED VERSION)
-- This migration adds the necessary policies for admins/managers to access and manage properties in their organization

-- Drop existing policies if they exist (to allow re-running migration)
DROP POLICY IF EXISTS "Admins and managers can view org properties" ON properties;
DROP POLICY IF EXISTS "Admins and managers can insert org properties" ON properties;
DROP POLICY IF EXISTS "Admins and managers can update org properties" ON properties;
DROP POLICY IF EXISTS "Admins and managers can delete org properties" ON properties;

-- RLS policy for admins/managers to view properties in their organization
CREATE POLICY "Admins and managers can view org properties" ON properties
    FOR SELECT USING (
        -- Allow homeowners to always see their own properties
        auth.uid() = owner_id
        OR
        -- Allow admins/managers to see properties owned by homeowners in their organization
        EXISTS (
            SELECT 1 FROM organization_members om_viewer
            WHERE om_viewer.user_id = auth.uid()
            AND om_viewer.role IN ('owner', 'admin', 'manager')
            AND EXISTS (
                SELECT 1 FROM organization_members om_target
                WHERE om_target.user_id = properties.owner_id
                AND om_target.role = 'homeowner'
                AND om_target.organization_id = om_viewer.organization_id
            )
        )
    );

-- RLS policy for admins/managers to insert properties in their organization
-- IMPORTANT: In WITH CHECK, column references are to the NEW row being inserted
CREATE POLICY "Admins and managers can insert org properties" ON properties
    FOR INSERT WITH CHECK (
        -- Allow homeowners to create their own properties
        auth.uid() = owner_id
        OR
        -- Allow admins/managers to create properties for homeowners in their organization
        -- Note: In WITH CHECK, owner_id refers to the NEW row's owner_id
        EXISTS (
            SELECT 1 FROM organization_members om_viewer
            WHERE om_viewer.user_id = auth.uid()
            AND om_viewer.role IN ('owner', 'admin', 'manager')
            AND EXISTS (
                SELECT 1 FROM organization_members om_target
                WHERE om_target.user_id = owner_id  -- This refers to NEW.owner_id in INSERT
                AND om_target.role = 'homeowner'
                AND om_target.organization_id = om_viewer.organization_id
            )
        )
    );

-- RLS policy for admins/managers to update properties in their organization
CREATE POLICY "Admins and managers can update org properties" ON properties
    FOR UPDATE USING (
        -- Allow homeowners to update their own properties
        auth.uid() = owner_id
        OR
        -- Allow admins/managers to update properties owned by homeowners in their organization
        EXISTS (
            SELECT 1 FROM organization_members om_viewer
            WHERE om_viewer.user_id = auth.uid()
            AND om_viewer.role IN ('owner', 'admin', 'manager')
            AND EXISTS (
                SELECT 1 FROM organization_members om_target
                WHERE om_target.user_id = properties.owner_id
                AND om_target.role = 'homeowner'
                AND om_target.organization_id = om_viewer.organization_id
            )
        )
    );

-- RLS policy for admins/managers to delete properties in their organization
CREATE POLICY "Admins and managers can delete org properties" ON properties
    FOR DELETE USING (
        -- Allow homeowners to delete their own properties
        auth.uid() = owner_id
        OR
        -- Allow admins/managers to delete properties owned by homeowners in their organization
        EXISTS (
            SELECT 1 FROM organization_members om_viewer
            WHERE om_viewer.user_id = auth.uid()
            AND om_viewer.role IN ('owner', 'admin', 'manager')
            AND EXISTS (
                SELECT 1 FROM organization_members om_target
                WHERE om_target.user_id = properties.owner_id
                AND om_target.role = 'homeowner'
                AND om_target.organization_id = om_viewer.organization_id
            )
        )
    );

