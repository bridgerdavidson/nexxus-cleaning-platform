-- Migration: Create user_role enum type if it doesn't exist
-- This must be run before the handle_new_user function

-- Check if the type exists, if not create it
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('homeowner', 'cleaner', 'admin');
        RAISE NOTICE 'Created user_role enum type';
    ELSE
        RAISE NOTICE 'user_role enum type already exists';
    END IF;
END $$;

-- Verify the type was created
SELECT typname, typtype 
FROM pg_type 
WHERE typname = 'user_role';

