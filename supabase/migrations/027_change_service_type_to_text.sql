-- Migration: Change service_type column from ENUM to TEXT
-- This allows users to create custom service types instead of being limited to predefined enum values

-- ============================================================================
-- PART 1: Add updated_at column to service_types if it doesn't exist
-- ============================================================================

ALTER TABLE service_types 
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- ============================================================================
-- PART 2: Change service_type column from ENUM to TEXT
-- ============================================================================

-- First, create a temporary column to store the values
ALTER TABLE service_types ADD COLUMN service_type_temp TEXT;

-- Copy existing enum values to the temp column (cast to text)
UPDATE service_types SET service_type_temp = service_type::TEXT;

-- Drop the old enum column
ALTER TABLE service_types DROP COLUMN service_type;

-- Rename temp column to service_type
ALTER TABLE service_types RENAME COLUMN service_type_temp TO service_type;

-- Make the column NOT NULL
ALTER TABLE service_types ALTER COLUMN service_type SET NOT NULL;

-- ============================================================================
-- PART 3: Drop the service_type enum type if no longer used
-- ============================================================================

-- Note: We check if the enum is used elsewhere before dropping
-- The recurring_appointment_series table might reference it, so we need to be careful
-- For now, we'll keep the enum type in case it's used elsewhere
-- If you want to drop it completely, uncomment the following line:
-- DROP TYPE IF EXISTS service_type;

-- ============================================================================
-- PART 4: Create trigger for updated_at
-- ============================================================================

-- Create or replace trigger function (may already exist from other tables)
CREATE OR REPLACE FUNCTION update_service_types_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS update_service_types_updated_at ON service_types;

-- Create the trigger
CREATE TRIGGER update_service_types_updated_at
    BEFORE UPDATE ON service_types
    FOR EACH ROW
    EXECUTE FUNCTION update_service_types_updated_at();
