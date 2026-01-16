-- Migration: Enable Supabase Realtime for payments table
-- This enables real-time subscriptions for payments table
-- so that payment status changes appear instantly across dashboards

-- Enable realtime for payments table
-- This allows clients to subscribe to INSERT, UPDATE events
ALTER PUBLICATION supabase_realtime ADD TABLE payments;

-- Note: RLS policies on the payments table will still apply
-- Users will only see payment updates for appointments they have access to

-- Add index on appointment_id for better realtime and query performance
CREATE INDEX IF NOT EXISTS idx_payments_appointment_id ON payments(appointment_id);

-- Add index on status for filtering by payment status
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

