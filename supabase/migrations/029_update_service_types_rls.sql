-- Migration: Update RLS policies for service_types table
-- Makes services organization-scoped and adds CRUD policies for admins/managers

-- ============================================================================
-- PART 1: Drop existing policies
-- ============================================================================

DROP POLICY IF EXISTS "Anyone can view service types" ON service_types;
DROP POLICY IF EXISTS "Users can view service types in their organization" ON service_types;
DROP POLICY IF EXISTS "Admins and managers can create service types" ON service_types;
DROP POLICY IF EXISTS "Admins and managers can update service types" ON service_types;
DROP POLICY IF EXISTS "Admins and managers can delete service types" ON service_types;

-- ============================================================================
-- PART 2: Create organization-scoped SELECT policy
-- Users can only view services in organizations they belong to
-- ============================================================================

CREATE POLICY "Users can view service types in their organization" ON service_types
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id 
            FROM organization_members 
            WHERE user_id = auth.uid()
        )
    );

-- ============================================================================
-- PART 3: Create INSERT policy for admins/managers
-- ============================================================================

CREATE POLICY "Admins and managers can create service types" ON service_types
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1
            FROM organization_members om
            WHERE om.user_id = auth.uid()
            AND om.organization_id = service_types.organization_id
            AND om.role IN ('owner', 'admin', 'manager')
        )
    );

-- ============================================================================
-- PART 4: Create UPDATE policy for admins/managers
-- ============================================================================

CREATE POLICY "Admins and managers can update service types" ON service_types
    FOR UPDATE USING (
        EXISTS (
            SELECT 1
            FROM organization_members om
            WHERE om.user_id = auth.uid()
            AND om.organization_id = service_types.organization_id
            AND om.role IN ('owner', 'admin', 'manager')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM organization_members om
            WHERE om.user_id = auth.uid()
            AND om.organization_id = service_types.organization_id
            AND om.role IN ('owner', 'admin', 'manager')
        )
    );

-- ============================================================================
-- PART 5: Create DELETE policy for admins/managers
-- ============================================================================

CREATE POLICY "Admins and managers can delete service types" ON service_types
    FOR DELETE USING (
        EXISTS (
            SELECT 1
            FROM organization_members om
            WHERE om.user_id = auth.uid()
            AND om.organization_id = service_types.organization_id
            AND om.role IN ('owner', 'admin', 'manager')
        )
    );

-- ============================================================================
-- PART 6: Create indexes for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_service_types_organization_id ON service_types(organization_id);
CREATE INDEX IF NOT EXISTS idx_service_types_is_active ON service_types(is_active);
CREATE INDEX IF NOT EXISTS idx_service_types_org_active ON service_types(organization_id, is_active) WHERE is_active = true;
