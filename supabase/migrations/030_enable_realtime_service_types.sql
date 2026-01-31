-- Migration: Enable realtime for service_types table
-- This allows Supabase to send change events when services are created, updated, or deleted

-- Enable realtime for service_types table
ALTER PUBLICATION supabase_realtime ADD TABLE service_types;

-- Create index for realtime filters (if not already exists)
-- This helps performance when filtering by organization_id in realtime subscriptions
CREATE INDEX IF NOT EXISTS idx_service_types_org_realtime ON service_types(organization_id);
