-- Add flow_type enum on appointments. Replaces the binary `homeowner_initiated`
-- boolean with a three-value enum so the future cleaner-availability flow
-- becomes additive (new code reads the enum) rather than invasive (refactor
-- every if/else branch).
--
-- `homeowner_initiated` is kept as a transitional column for one release
-- cycle. A follow-up migration drops it once all code paths read flow_type.

CREATE TYPE appointment_flow_type AS ENUM (
  'homeowner_request',
  'admin_direct',
  'cleaner_availability'
);

ALTER TABLE appointments
  ADD COLUMN flow_type appointment_flow_type;

UPDATE appointments
SET flow_type = CASE
  WHEN homeowner_initiated IS TRUE THEN 'homeowner_request'::appointment_flow_type
  ELSE 'admin_direct'::appointment_flow_type
END;

ALTER TABLE appointments
  ALTER COLUMN flow_type SET NOT NULL,
  ALTER COLUMN flow_type SET DEFAULT 'admin_direct';

COMMENT ON COLUMN appointments.homeowner_initiated IS
  'DEPRECATED — use flow_type. Kept for one release cycle for backward-compat.';

CREATE INDEX IF NOT EXISTS idx_appointments_flow_type
  ON appointments (organization_id, flow_type);
