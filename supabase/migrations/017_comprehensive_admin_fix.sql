-- Comprehensive fix for admin access to appointments
-- This fixes the RLS policies to work with both organization_id direct matching
-- and the fallback through homeowner membership

-- Drop existing policies
DROP POLICY IF EXISTS "Admins and managers can view org appointments" ON appointments;
DROP POLICY IF EXISTS "Admins and managers can update org appointments" ON appointments;

-- Recreate the appointment view policy with proper logic
CREATE POLICY "Admins and managers can view org appointments" ON appointments
    FOR SELECT USING (
        -- Homeowners can view their own appointments
        auth.uid() = homeowner_id
        OR
        -- Cleaners can view their own appointments  
        auth.uid() = cleaner_id
        OR
        -- Admins/managers can view appointments in their organization
        -- Method 1: Direct organization_id match (preferred, more efficient)
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin', 'manager')
            AND om.organization_id = appointments.organization_id
            AND appointments.organization_id IS NOT NULL
        )
        OR
        -- Method 2: Through homeowner membership (fallback for appointments without organization_id)
        EXISTS (
            SELECT 1 FROM organization_members om_viewer
            WHERE om_viewer.user_id = auth.uid()
            AND om_viewer.role IN ('owner', 'admin', 'manager')
            AND EXISTS (
                SELECT 1 FROM organization_members om_homeowner
                WHERE om_homeowner.user_id = appointments.homeowner_id
                AND om_homeowner.organization_id = om_viewer.organization_id
            )
        )
    );

-- Recreate the appointment update policy
CREATE POLICY "Admins and managers can update org appointments" ON appointments
    FOR UPDATE USING (
        -- Homeowners can update their own appointments
        auth.uid() = homeowner_id
        OR
        -- Cleaners can update appointment status
        auth.uid() = cleaner_id
        OR
        -- Admins/managers can update appointments in their organization
        -- Method 1: Direct organization_id match
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin', 'manager')
            AND om.organization_id = appointments.organization_id
            AND appointments.organization_id IS NOT NULL
        )
        OR
        -- Method 2: Through homeowner membership (fallback)
        EXISTS (
            SELECT 1 FROM organization_members om_viewer
            WHERE om_viewer.user_id = auth.uid()
            AND om_viewer.role IN ('owner', 'admin', 'manager')
            AND EXISTS (
                SELECT 1 FROM organization_members om_homeowner
                WHERE om_homeowner.user_id = appointments.homeowner_id
                AND om_homeowner.organization_id = om_viewer.organization_id
            )
        )
    );
