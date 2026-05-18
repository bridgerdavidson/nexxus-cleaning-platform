-- Migration: Add trigger to create default checklist with starter items for new service types
-- Also backfills existing service types that don't have checklists

-- ============================================================================
-- PART 1: Create trigger function to auto-create default checklist
-- ============================================================================

CREATE OR REPLACE FUNCTION create_default_checklist_for_service()
RETURNS TRIGGER AS $$
DECLARE
  new_checklist_id UUID;
BEGIN
  -- Create default checklist for the new service type
  INSERT INTO checklists (name, service_type_id)
  VALUES ('Default Checklist', NEW.id)
  RETURNING id INTO new_checklist_id;
  
  -- Insert starter items in order
  INSERT INTO checklist_line_items (task, checklist_id) VALUES
    ('Put on gloves and prepare cleaning supplies', new_checklist_id),
    ('Pick up and dispose of trash', new_checklist_id),
    ('Tidy visible clutter (do not organize personal items)', new_checklist_id),
    ('Dust all reachable surfaces (top to bottom)', new_checklist_id),
    ('Wipe light switches and door handles', new_checklist_id),
    ('Spot clean walls and doors (as needed)', new_checklist_id),
    ('Vacuum carpets and rugs', new_checklist_id),
    ('Sweep and mop hard floors', new_checklist_id),
    ('Final visual check of room', new_checklist_id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- PART 2: Create trigger on service_types table
-- ============================================================================

CREATE TRIGGER create_default_checklist_after_service_insert
  AFTER INSERT ON service_types
  FOR EACH ROW
  EXECUTE FUNCTION create_default_checklist_for_service();

-- ============================================================================
-- PART 3: Backfill existing service types that don't have any checklists
-- ============================================================================

DO $$
DECLARE
  service_record RECORD;
  new_checklist_id UUID;
BEGIN
  -- Find all service types that don't have any checklists
  FOR service_record IN 
    SELECT st.id 
    FROM service_types st
    LEFT JOIN checklists c ON c.service_type_id = st.id
    WHERE c.id IS NULL
  LOOP
    -- Create default checklist for this service type
    INSERT INTO checklists (name, service_type_id)
    VALUES ('Default Checklist', service_record.id)
    RETURNING id INTO new_checklist_id;
    
    -- Insert starter items
    INSERT INTO checklist_line_items (task, checklist_id) VALUES
      ('Put on gloves and prepare cleaning supplies', new_checklist_id),
      ('Pick up and dispose of trash', new_checklist_id),
      ('Tidy visible clutter (do not organize personal items)', new_checklist_id),
      ('Dust all reachable surfaces (top to bottom)', new_checklist_id),
      ('Wipe light switches and door handles', new_checklist_id),
      ('Spot clean walls and doors (as needed)', new_checklist_id),
      ('Vacuum carpets and rugs', new_checklist_id),
      ('Sweep and mop hard floors', new_checklist_id),
      ('Final visual check of room', new_checklist_id);
  END LOOP;
END $$;
