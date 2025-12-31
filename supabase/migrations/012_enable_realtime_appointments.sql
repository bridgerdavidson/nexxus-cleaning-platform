-- Migration: Enable Supabase Realtime for appointments table
-- This enables real-time subscriptions for appointments table
-- so that appointment changes appear instantly across admin/manager and cleaner dashboards

-- Enable realtime for appointments table
-- This allows clients to subscribe to INSERT, UPDATE, DELETE events
ALTER PUBLICATION supabase_realtime ADD TABLE appointments;

-- Note: Ensure RLS policies allow SELECT for the subscribing user
-- The existing policies should work:
-- - Admin/Manager can view appointments in their organization
-- - Cleaners can view appointments assigned to them
-- - Realtime will respect these RLS policies

-- Add indexes for better realtime filter performance
-- Index on organization_id for admin/manager subscriptions
CREATE INDEX IF NOT EXISTS idx_appointments_organization_id ON appointments(organization_id);

-- Index on cleaner_id for cleaner subscriptions
CREATE INDEX IF NOT EXISTS idx_appointments_cleaner_id ON appointments(cleaner_id);

-- Composite index for common queries (organization + date)
CREATE INDEX IF NOT EXISTS idx_appointments_org_date ON appointments(organization_id, scheduled_date);

-- Composite index for cleaner queries (cleaner + date)
CREATE INDEX IF NOT EXISTS idx_appointments_cleaner_date ON appointments(cleaner_id, scheduled_date);

