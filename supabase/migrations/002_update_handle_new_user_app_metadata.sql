-- Migration: Update handle_new_user function to use app_metadata for roles
-- This makes role assignment secure (only service role can set roles)
-- PREREQUISITE: Run 001_create_user_role_enum.sql first

-- Ensure user_role enum exists (in case migration 001 wasn't run)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('homeowner', 'cleaner', 'admin');
        RAISE NOTICE 'Created user_role enum type';
    END IF;
END $$;

-- Drop the existing function and trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Recreate the function with app_metadata for role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, first_name, last_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
        COALESCE(NEW.raw_app_meta_data->>'role', 'homeowner')::public.user_role
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Add comment explaining the security model
COMMENT ON FUNCTION public.handle_new_user() IS 
'Automatically creates user profile on signup. 
Role is read from app_metadata (secure, only settable by service role).
Name fields are read from user_metadata (user-editable).';

-- Verify everything is set up correctly
SELECT 'Setup complete!' as status;
SELECT typname FROM pg_type WHERE typname = 'user_role';
SELECT proname FROM pg_proc WHERE proname = 'handle_new_user';
SELECT trigger_name FROM information_schema.triggers WHERE trigger_name = 'on_auth_user_created';

