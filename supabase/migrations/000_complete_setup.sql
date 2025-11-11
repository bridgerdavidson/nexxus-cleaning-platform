-- Complete Setup Script for Nexxus Cleaning Platform
-- Run this ONCE in Supabase SQL Editor to set up everything

-- ============================================
-- STEP 1: Create ENUM Types
-- ============================================

DO $$ 
BEGIN
    -- Create user_role enum
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('homeowner', 'cleaner', 'admin');
        RAISE NOTICE '✓ Created user_role enum';
    ELSE
        RAISE NOTICE '✓ user_role enum already exists';
    END IF;

    -- Create appointment_status enum
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status') THEN
        CREATE TYPE appointment_status AS ENUM ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled');
        RAISE NOTICE '✓ Created appointment_status enum';
    ELSE
        RAISE NOTICE '✓ appointment_status enum already exists';
    END IF;

    -- Create service_type enum
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_type') THEN
        CREATE TYPE service_type AS ENUM ('regular', 'deep', 'move_out', 'custom');
        RAISE NOTICE '✓ Created service_type enum';
    ELSE
        RAISE NOTICE '✓ service_type enum already exists';
    END IF;

    -- Create payment_status enum
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
        RAISE NOTICE '✓ Created payment_status enum';
    ELSE
        RAISE NOTICE '✓ payment_status enum already exists';
    END IF;
END $$;

-- ============================================
-- STEP 2: Create/Update user_profiles Table
-- ============================================

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    role user_role NOT NULL DEFAULT 'homeowner',
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- If the table exists but role column is TEXT, alter it to user_role
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_profiles' 
        AND column_name = 'role' 
        AND data_type = 'text'
    ) THEN
        -- Alter the column type from TEXT to user_role
        ALTER TABLE user_profiles 
        ALTER COLUMN role TYPE user_role USING role::user_role;
        RAISE NOTICE '✓ Converted role column from TEXT to user_role enum';
    ELSE
        RAISE NOTICE '✓ role column is already user_role type';
    END IF;
END $$;

-- ============================================
-- STEP 3: Drop and Recreate Trigger Function
-- ============================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, first_name, last_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
        COALESCE(NEW.raw_app_meta_data->>'role', 'homeowner')::user_role
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        role = EXCLUDED.role,
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.handle_new_user() IS 
'Automatically creates user profile on signup. 
Role is read from app_metadata (secure, only settable by service role).
Name fields are read from user_metadata (user-editable).';

-- Create the trigger
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- STEP 4: Enable Row Level Security
-- ============================================

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON user_profiles;

-- Create RLS policies
CREATE POLICY "Users can view their own profile" ON user_profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- ============================================
-- STEP 5: Verification
-- ============================================

-- Show what was created
SELECT 'Setup Complete! ✓' as status;

-- Verify enum types
SELECT '=== ENUM TYPES ===' as section;
SELECT typname, typtype 
FROM pg_type 
WHERE typname IN ('user_role', 'appointment_status', 'service_type', 'payment_status')
ORDER BY typname;

-- Verify table structure
SELECT '=== USER_PROFILES TABLE ===' as section;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'user_profiles'
ORDER BY ordinal_position;

-- Verify function
SELECT '=== TRIGGER FUNCTION ===' as section;
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname = 'handle_new_user';

-- Verify trigger
SELECT '=== TRIGGER ===' as section;
SELECT trigger_name, event_object_table, action_statement 
FROM information_schema.triggers 
WHERE trigger_name = 'on_auth_user_created';

-- Verify RLS policies
SELECT '=== RLS POLICIES ===' as section;
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'user_profiles';

