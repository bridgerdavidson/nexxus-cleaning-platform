-- Migration: Fix RLS policies for admins/managers to view appointments
-- Reverts to the original working logic that checks through homeowner membership
-- This ensures compatibility with existing data

-- Drop the existing policy
DROP POLICY IF EXISTS "Admins and managers can view org appointments" ON appointments;
DROP POLICY IF EXISTS "Admins and managers can update org appointments" ON appointments;

-- Recreate the original working RLS policy for admins/managers to view appointments
-- This uses the homeowner membership approach which was working before
CREATE POLICY "Admins and managers can view org appointments" ON appointments
    FOR SELECT USING (
        -- Allow homeowners to view their own appointments (existing policy)
        auth.uid() = homeowner_id
        OR
        -- Allow cleaners to view their own appointments (existing policy)
        auth.uid() = cleaner_id
        OR
        -- Allow admins/managers to view appointments in their organization
        -- Appointments are linked through homeowners who are in organization_members
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

-- Recreate the original working RLS policy for admins/managers to update appointments
CREATE POLICY "Admins and managers can update org appointments" ON appointments
    FOR UPDATE USING (
        -- Allow homeowners to update their own appointments (existing policy)
        auth.uid() = homeowner_id
        OR
        -- Allow cleaners to update appointment status (existing policy)
        auth.uid() = cleaner_id
        OR
        -- Allow admins/managers to update appointments in their organization
        -- Appointments are linked through homeowners who are in organization_members
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

