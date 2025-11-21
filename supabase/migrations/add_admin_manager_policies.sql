-- Add RLS policies to allow admins and managers to view all user profiles
-- This is necessary for admin/manager dashboards to display cleaner information

-- Drop existing policies if they exist (for re-running)
DROP POLICY IF EXISTS "Admins can view all user profiles" ON user_profiles;
DROP POLICY IF EXISTS "Managers can view all user profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can view all cleaner profiles" ON cleaner_profiles;
DROP POLICY IF EXISTS "Managers can view all cleaner profiles" ON cleaner_profiles;
DROP POLICY IF EXISTS "Admins can view all appointments" ON appointments;
DROP POLICY IF EXISTS "Managers can view all appointments" ON appointments;
DROP POLICY IF EXISTS "Admins can update any appointment" ON appointments;
DROP POLICY IF EXISTS "Managers can update any appointment" ON appointments;
DROP POLICY IF EXISTS "Admins can view all payments" ON payments;
DROP POLICY IF EXISTS "Managers can view all payments" ON payments;
DROP POLICY IF EXISTS "Admins can view all messages" ON messages;
DROP POLICY IF EXISTS "Managers can view all messages" ON messages;

-- User profiles policies for admins and managers
CREATE POLICY "Admins can view all user profiles" ON user_profiles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

CREATE POLICY "Managers can view all user profiles" ON user_profiles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role IN ('admin', 'manager')
        )
    );

-- Cleaner profiles policies for admins and managers
CREATE POLICY "Admins can view all cleaner profiles" ON cleaner_profiles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

CREATE POLICY "Managers can view all cleaner profiles" ON cleaner_profiles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role IN ('admin', 'manager')
        )
    );

-- Appointments policies for admins and managers
CREATE POLICY "Admins can view all appointments" ON appointments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

CREATE POLICY "Managers can view all appointments" ON appointments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role IN ('admin', 'manager')
        )
    );

CREATE POLICY "Admins can update any appointment" ON appointments
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

CREATE POLICY "Managers can update any appointment" ON appointments
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role IN ('admin', 'manager')
        )
    );

-- Payments policies for admins and managers
CREATE POLICY "Admins can view all payments" ON payments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

CREATE POLICY "Managers can view all payments" ON payments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role IN ('admin', 'manager')
        )
    );

-- Messages policies for admins and managers
CREATE POLICY "Admins can view all messages" ON messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

CREATE POLICY "Managers can view all messages" ON messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_profiles up 
            WHERE up.id = auth.uid() 
            AND up.role IN ('admin', 'manager')
        )
    );

