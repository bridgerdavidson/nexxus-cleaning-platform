-- Add series_id column to appointments table to match dev
-- This column is used for recurring appointment series
-- This matches migration 011_add_recurring_appointment_series.sql PART B

-- Add series_id column if it doesn't exist
-- Note: If recurring_appointment_series table doesn't exist, this will fail
-- In that case, you may need to run migration 011 first, or make the column nullable without FK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'appointments' 
        AND column_name = 'series_id'
    ) THEN
        -- Check if recurring_appointment_series table exists
        IF EXISTS (
            SELECT 1 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'recurring_appointment_series'
        ) THEN
            -- Table exists, add column with foreign key
            ALTER TABLE public.appointments
            ADD COLUMN series_id UUID REFERENCES public.recurring_appointment_series(id) ON DELETE SET NULL;
        ELSE
            -- Table doesn't exist, add column as nullable UUID (no FK constraint)
            ALTER TABLE public.appointments
            ADD COLUMN series_id UUID;
        END IF;
        
        -- Create index for better query performance
        CREATE INDEX IF NOT EXISTS idx_appointments_series_id ON public.appointments(series_id);
    END IF;
END $$;

