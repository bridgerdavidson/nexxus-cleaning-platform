-- Migration: Add checklists and checklist_line_items tables
-- Each service type can have many checklists, each checklist can have many line items

-- ============================================================================
-- PART 1: Create checklists table
-- ============================================================================

CREATE TABLE checklists (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'checklist',
    service_type_id UUID NOT NULL REFERENCES service_types(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- PART 2: Create checklist_line_items table
-- ============================================================================

CREATE TABLE checklist_line_items (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    task TEXT NOT NULL,
    checklist_id UUID NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- PART 3: Enable RLS on both tables
-- ============================================================================

ALTER TABLE checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_line_items ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PART 4: RLS policies for checklists
-- Access is organization-scoped via the parent service_types table
-- ============================================================================

-- SELECT: Users can view checklists for services in their organization
CREATE POLICY "Users can view checklists in their organization" ON checklists
    FOR SELECT USING (
        EXISTS (
            SELECT 1
            FROM service_types st
            JOIN organization_members om ON om.organization_id = st.organization_id
            WHERE st.id = checklists.service_type_id
            AND om.user_id = auth.uid()
        )
    );

-- INSERT: Admins, managers, and owners can create checklists
CREATE POLICY "Admins and managers can create checklists" ON checklists
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1
            FROM service_types st
            JOIN organization_members om ON om.organization_id = st.organization_id
            WHERE st.id = checklists.service_type_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin', 'manager')
        )
    );

-- UPDATE: Admins, managers, and owners can update checklists
CREATE POLICY "Admins and managers can update checklists" ON checklists
    FOR UPDATE USING (
        EXISTS (
            SELECT 1
            FROM service_types st
            JOIN organization_members om ON om.organization_id = st.organization_id
            WHERE st.id = checklists.service_type_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin', 'manager')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM service_types st
            JOIN organization_members om ON om.organization_id = st.organization_id
            WHERE st.id = checklists.service_type_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin', 'manager')
        )
    );

-- DELETE: Admins, managers, and owners can delete checklists
CREATE POLICY "Admins and managers can delete checklists" ON checklists
    FOR DELETE USING (
        EXISTS (
            SELECT 1
            FROM service_types st
            JOIN organization_members om ON om.organization_id = st.organization_id
            WHERE st.id = checklists.service_type_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin', 'manager')
        )
    );

-- ============================================================================
-- PART 5: RLS policies for checklist_line_items
-- Access is organization-scoped via checklists -> service_types
-- ============================================================================

-- SELECT: Users can view line items for checklists in their organization
CREATE POLICY "Users can view checklist line items in their organization" ON checklist_line_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1
            FROM checklists c
            JOIN service_types st ON st.id = c.service_type_id
            JOIN organization_members om ON om.organization_id = st.organization_id
            WHERE c.id = checklist_line_items.checklist_id
            AND om.user_id = auth.uid()
        )
    );

-- INSERT: Admins, managers, and owners can create line items
CREATE POLICY "Admins and managers can create checklist line items" ON checklist_line_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1
            FROM checklists c
            JOIN service_types st ON st.id = c.service_type_id
            JOIN organization_members om ON om.organization_id = st.organization_id
            WHERE c.id = checklist_line_items.checklist_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin', 'manager')
        )
    );

-- UPDATE: Admins, managers, and owners can update line items
CREATE POLICY "Admins and managers can update checklist line items" ON checklist_line_items
    FOR UPDATE USING (
        EXISTS (
            SELECT 1
            FROM checklists c
            JOIN service_types st ON st.id = c.service_type_id
            JOIN organization_members om ON om.organization_id = st.organization_id
            WHERE c.id = checklist_line_items.checklist_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin', 'manager')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM checklists c
            JOIN service_types st ON st.id = c.service_type_id
            JOIN organization_members om ON om.organization_id = st.organization_id
            WHERE c.id = checklist_line_items.checklist_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin', 'manager')
        )
    );

-- DELETE: Admins, managers, and owners can delete line items
CREATE POLICY "Admins and managers can delete checklist line items" ON checklist_line_items
    FOR DELETE USING (
        EXISTS (
            SELECT 1
            FROM checklists c
            JOIN service_types st ON st.id = c.service_type_id
            JOIN organization_members om ON om.organization_id = st.organization_id
            WHERE c.id = checklist_line_items.checklist_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin', 'manager')
        )
    );

-- ============================================================================
-- PART 6: Create indexes for performance
-- ============================================================================

CREATE INDEX idx_checklists_service_type_id ON checklists(service_type_id);
CREATE INDEX idx_checklist_line_items_checklist_id ON checklist_line_items(checklist_id);

-- ============================================================================
-- PART 7: Create updated_at trigger for checklists
-- ============================================================================

CREATE OR REPLACE FUNCTION update_checklists_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_checklists_updated_at
    BEFORE UPDATE ON checklists
    FOR EACH ROW
    EXECUTE FUNCTION update_checklists_updated_at();
