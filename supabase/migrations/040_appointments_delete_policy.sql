-- Migration: Allow org admins and managers to delete appointments
-- The appointments table has RLS enabled but no DELETE policy, so deletes from
-- the admin dashboard affected 0 rows and the client reported success incorrectly.
-- This policy lets organization members with role owner, admin, or manager
-- delete appointments belonging to their organization.

CREATE POLICY "Org admins and managers can delete appointments"
  ON appointments
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = appointments.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager')
    )
  );
