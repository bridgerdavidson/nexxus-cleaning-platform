-- Schema Verification and Sync Script
-- Run this to ensure your database matches the expected schema

-- ============================================
-- APPOINTMENTS TABLE
-- ============================================

-- Add any missing columns (safe - won't error if they exist)
DO $$ 
BEGIN
    -- Add duration_minutes if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'appointments' AND column_name = 'duration_minutes'
    ) THEN
        ALTER TABLE appointments ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 120;
        RAISE NOTICE '✓ Added duration_minutes column';
    END IF;

    -- Add special_requests if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'appointments' AND column_name = 'special_requests'
    ) THEN
        ALTER TABLE appointments ADD COLUMN special_requests TEXT;
        RAISE NOTICE '✓ Added special_requests column';
    END IF;

    -- Add notes if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'appointments' AND column_name = 'notes'
    ) THEN
        ALTER TABLE appointments ADD COLUMN notes TEXT;
        RAISE NOTICE '✓ Added notes column';
    END IF;
END $$;

-- ============================================
-- PROPERTIES TABLE
-- ============================================

DO $$ 
BEGIN
    -- Ensure properties has the correct columns
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'properties' AND column_name = 'name'
    ) THEN
        ALTER TABLE properties ADD COLUMN name TEXT NOT NULL DEFAULT 'My Property';
        RAISE NOTICE '✓ Added name column to properties';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'properties' AND column_name = 'square_feet'
    ) THEN
        ALTER TABLE properties ADD COLUMN square_feet INTEGER;
        RAISE NOTICE '✓ Added square_feet column to properties';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'properties' AND column_name = 'special_instructions'
    ) THEN
        ALTER TABLE properties ADD COLUMN special_instructions TEXT;
        RAISE NOTICE '✓ Added special_instructions column to properties';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'properties' AND column_name = 'access_instructions'
    ) THEN
        ALTER TABLE properties ADD COLUMN access_instructions TEXT;
        RAISE NOTICE '✓ Added access_instructions column to properties';
    END IF;
END $$;

-- ============================================
-- SERVICE_TYPES TABLE
-- ============================================

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'service_types' AND column_name = 'duration_minutes'
    ) THEN
        ALTER TABLE service_types ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 120;
        RAISE NOTICE '✓ Added duration_minutes column to service_types';
    END IF;
END $$;

-- ============================================
-- VERIFICATION REPORT
-- ============================================

-- Show appointments table structure
SELECT '=== APPOINTMENTS TABLE STRUCTURE ===' as report;
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'appointments'
ORDER BY ordinal_position;

-- Show properties table structure
SELECT '=== PROPERTIES TABLE STRUCTURE ===' as report;
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'properties'
ORDER BY ordinal_position;

-- Show service_types table structure
SELECT '=== SERVICE_TYPES TABLE STRUCTURE ===' as report;
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'service_types'
ORDER BY ordinal_position;

SELECT '✅ Schema verification complete!' as status;

