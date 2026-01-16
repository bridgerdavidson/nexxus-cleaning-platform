-- Cleanup: Remove duplicate and conflicting appointment RLS policies
-- Keep only the function-based policies which check organization_members (source of truth)
-- Remove JWT-based policies that may not be reliable

-- Step 1: Drop all duplicate/conflicting policies
-- Keep only: Homeowners, Cleaners, and the function-based Admin/Manager policies

-- Drop JWT-based admin policies (unreliable - depends on app_metadata being set correctly)
DROP POLICY IF EXISTS "Admins can view all appointments" ON appointments;
DROP POLICY IF EXISTS "Admins can update any appointment" ON appointments;

-- Drop JWT-based manager policies (unreliable - depends on app_metadata being set correctly)
DROP POLICY IF EXISTS "Managers can view all appointments" ON appointments;
DROP POLICY IF EXISTS "Managers can update any appointment" ON appointments;
DROP POLICY IF EXISTS "Managers can update appointments" ON appointments;

-- Drop duplicate insert policies (we'll keep the base ones)
DROP POLICY IF EXISTS "Admins can insert appointments" ON appointments;
DROP POLICY IF EXISTS "Managers can insert appointments" ON appointments;

-- Step 2: Verify the function-based policies exist (from migration 019)
-- These should already exist, but if not, they'll be created below
DO $$
BEGIN
    -- Check if the function-based SELECT policy exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'appointments' 
        AND policyname = 'Admins and managers can view org appointments'
    ) THEN
        -- Create the SELECT policy if it doesn't exist
        CREATE POLICY "Admins and managers can view org appointments" ON appointments
            FOR SELECT USING (
                auth.uid() = homeowner_id
                OR
                auth.uid() = cleaner_id
                OR
                (
                    appointments.organization_id IS NOT NULL
                    AND public.is_admin_or_manager_in_org(appointments.organization_id)
                )
                OR
                public.user_shares_org_with_homeowner(appointments.homeowner_id)
            );
    END IF;

    -- Check if the function-based UPDATE policy exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'appointments' 
        AND policyname = 'Admins and managers can update org appointments'
    ) THEN
        -- Create the UPDATE policy if it doesn't exist
        CREATE POLICY "Admins and managers can update org appointments" ON appointments
            FOR UPDATE USING (
                auth.uid() = homeowner_id
                OR
                auth.uid() = cleaner_id
                OR
                (
                    appointments.organization_id IS NOT NULL
                    AND public.is_admin_or_manager_in_org(appointments.organization_id)
                )
                OR
                public.user_shares_org_with_homeowner(appointments.homeowner_id)
            );
    END IF;
END $$;

-- Step 3: Ensure the helper functions exist and are correct
-- (This is a safety check - migration 019 should have already created them)
DO $$
BEGIN
    -- Check if is_admin_or_manager_in_org exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
        AND p.proname = 'is_admin_or_manager_in_org'
    ) THEN
        RAISE EXCEPTION 'Function is_admin_or_manager_in_org does not exist. Please run migration 019 first.';
    END IF;

    -- Check if user_shares_org_with_homeowner exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
        AND p.proname = 'user_shares_org_with_homeowner'
    ) THEN
        RAISE EXCEPTION 'Function user_shares_org_with_homeowner does not exist. Please run migration 019 first.';
    END IF;
END $$;

-- Step 4: List remaining policies for verification
-- (This is just a comment - actual verification should be done manually)
COMMENT ON TABLE appointments IS 
    'Appointments table. RLS policies: Homeowners, Cleaners, and function-based Admin/Manager policies.';




