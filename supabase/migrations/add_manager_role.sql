-- Add 'manager' role to the user_role enum type
-- This allows users to have the manager role in addition to homeowner, cleaner, and admin

-- Check if manager role doesn't exist and add it
DO $$ 
BEGIN
    -- Add manager to user_role enum if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_enum 
        WHERE enumlabel = 'manager' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
    ) THEN
        ALTER TYPE user_role ADD VALUE 'manager';
    END IF;
END $$;

