-- Migration: Checklist pricing adders + appointment checklist linkage + override support

-- 1) Checklist pricing adder
ALTER TABLE checklists
  ADD COLUMN IF NOT EXISTS price_adder NUMERIC(10,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'checklists_price_adder_non_negative'
  ) THEN
    ALTER TABLE checklists
      ADD CONSTRAINT checklists_price_adder_non_negative
      CHECK (price_adder >= 0);
  END IF;
END $$;

-- 2) Appointment + recurring series checklist linkage and override fields
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS checklist_id UUID REFERENCES checklists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS price_override_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS price_override_total NUMERIC(10,2);

ALTER TABLE recurring_appointment_series
  ADD COLUMN IF NOT EXISTS checklist_id UUID REFERENCES checklists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS price_override_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS price_override_total NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_appointments_checklist_id ON appointments(checklist_id);
CREATE INDEX IF NOT EXISTS idx_recurring_series_checklist_id ON recurring_appointment_series(checklist_id);

-- 3) Backfill checklist references (top checklist by name/created_at)
UPDATE appointments a
SET checklist_id = (
  SELECT id
  FROM checklists
  WHERE service_type_id = a.service_type_id
  ORDER BY name ASC, created_at ASC
  LIMIT 1
)
WHERE a.checklist_id IS NULL;

UPDATE recurring_appointment_series ras
SET checklist_id = (
  SELECT id
  FROM checklists
  WHERE service_type_id = ras.service_type_id
  ORDER BY name ASC, created_at ASC
  LIMIT 1
)
WHERE ras.checklist_id IS NULL;

-- 4) Normalize override state and recalculate non-overridden totals
UPDATE appointments
SET price_override_enabled = TRUE
WHERE price_override_total IS NOT NULL;

UPDATE recurring_appointment_series
SET price_override_enabled = TRUE
WHERE price_override_total IS NOT NULL;

UPDATE appointments a
SET total_price = st.base_price + c.price_adder
FROM service_types st, checklists c
WHERE a.service_type_id = st.id
  AND c.id = a.checklist_id
  AND COALESCE(a.price_override_enabled, FALSE) = FALSE;

UPDATE recurring_appointment_series ras
SET total_price = st.base_price + c.price_adder
FROM service_types st, checklists c
WHERE ras.service_type_id = st.id
  AND c.id = ras.checklist_id
  AND COALESCE(ras.price_override_enabled, FALSE) = FALSE;

-- 5) Recalculation function and trigger when checklist adder changes
CREATE OR REPLACE FUNCTION recalculate_totals_for_checklist(p_checklist_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE appointments a
  SET total_price = st.base_price + c.price_adder
  FROM service_types st, checklists c
  WHERE a.service_type_id = st.id
    AND c.id = a.checklist_id
    AND c.id = p_checklist_id
    AND COALESCE(a.price_override_enabled, FALSE) = FALSE;

  UPDATE recurring_appointment_series ras
  SET total_price = st.base_price + c.price_adder
  FROM service_types st, checklists c
  WHERE ras.service_type_id = st.id
    AND c.id = ras.checklist_id
    AND c.id = p_checklist_id
    AND COALESCE(ras.price_override_enabled, FALSE) = FALSE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION handle_checklist_price_adder_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.price_adder IS DISTINCT FROM OLD.price_adder THEN
    PERFORM recalculate_totals_for_checklist(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_checklist_price_adder_recalc ON checklists;

CREATE TRIGGER trigger_checklist_price_adder_recalc
AFTER UPDATE ON checklists
FOR EACH ROW
EXECUTE FUNCTION handle_checklist_price_adder_change();
