-- Add RLS policies for organization_members table
-- This allows admins and managers to view and manage organization members

-- Drop existing policies if any
DROP POLICY IF EXISTS "Admins can view all organization members" ON organization_members;
DROP POLICY IF EXISTS "Managers can view organization members" ON organization_members;
DROP POLICY IF EXISTS "Admins can insert organization members" ON organization_members;
DROP POLICY IF EXISTS "Admins can update organization members" ON organization_members;
DROP POLICY IF EXISTS "Admins can delete organization members" ON organization_members;
DROP POLICY IF EXISTS "Users can view their own memberships" ON organization_members;

-- Users can view their own memberships
CREATE POLICY "Users can view their own memberships" ON organization_members
    FOR SELECT USING (auth.uid() = user_id);

-- Admins can view all organization members
CREATE POLICY "Admins can view all organization members" ON organization_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

-- Managers can view organization members
CREATE POLICY "Managers can view organization members" ON organization_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role IN ('admin', 'manager')
        )
    );

-- Admins can insert organization members
CREATE POLICY "Admins can insert organization members" ON organization_members
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

-- Admins can update organization members
CREATE POLICY "Admins can update organization members" ON organization_members
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

-- Admins can delete organization members
CREATE POLICY "Admins can delete organization members" ON organization_members
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

-- Optional: Add policies for organizations table if needed
DROP POLICY IF EXISTS "Admins can view all organizations" ON organizations;
DROP POLICY IF EXISTS "Users can view their organizations" ON organizations;

-- Users can view organizations they belong to
CREATE POLICY "Users can view their organizations" ON organizations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = organizations.id
            AND om.user_id = auth.uid()
        )
    );

-- Admins can view all organizations
CREATE POLICY "Admins can view all organizations" ON organizations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

-- Add policies for properties table (missing from previous migrations)
DROP POLICY IF EXISTS "Admins can view all properties" ON properties;
DROP POLICY IF EXISTS "Managers can view all properties" ON properties;
DROP POLICY IF EXISTS "Admins can insert properties" ON properties;
DROP POLICY IF EXISTS "Admins can update properties" ON properties;
DROP POLICY IF EXISTS "Admins can delete properties" ON properties;

-- Admins can view all properties
CREATE POLICY "Admins can view all properties" ON properties
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

-- Managers can view all properties
CREATE POLICY "Managers can view all properties" ON properties
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role IN ('admin', 'manager')
        )
    );

-- Admins can insert properties
CREATE POLICY "Admins can insert properties" ON properties
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

-- Admins can update properties
CREATE POLICY "Admins can update properties" ON properties
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

-- Admins can delete properties
CREATE POLICY "Admins can delete properties" ON properties
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

-- Add INSERT policy for appointments (missing from previous migrations)
DROP POLICY IF EXISTS "Admins can insert appointments" ON appointments;
DROP POLICY IF EXISTS "Managers can insert appointments" ON appointments;

-- Admins can insert appointments
CREATE POLICY "Admins can insert appointments" ON appointments
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

-- Managers can insert appointments
CREATE POLICY "Managers can insert appointments" ON appointments
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role IN ('admin', 'manager')
        )
    );

