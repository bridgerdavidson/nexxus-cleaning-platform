-- Migration: Add services permissions to manager_permissions table
-- This allows admins to control which managers can view and manage service types

-- ============================================================================
-- Add new permission columns for services
-- ============================================================================

ALTER TABLE manager_permissions 
    ADD COLUMN IF NOT EXISTS can_view_services BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS can_manage_services BOOLEAN DEFAULT false;

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON COLUMN manager_permissions.can_view_services IS 'Whether the manager can view service types in the organization';
COMMENT ON COLUMN manager_permissions.can_manage_services IS 'Whether the manager can create, update, and delete service types in the organization';
