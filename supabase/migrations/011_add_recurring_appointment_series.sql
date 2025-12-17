-- Migration: Add recurring appointment series table and series_id to appointments
-- This implements the series + occurrences pattern for recurring appointments

-- ============================================================================
-- PART A: Create recurring_appointment_series table
-- ============================================================================

CREATE TABLE public.recurring_appointment_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Organization context (multi-tenancy)
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Participants
  homeowner_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  cleaner_id UUID REFERENCES public.cleaner_profiles(id) ON DELETE SET NULL,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  service_type_id UUID NOT NULL REFERENCES public.service_types(id) ON DELETE RESTRICT,
  
  -- Base appointment info
  start_date DATE NOT NULL,
  start_time TIME NOT NULL,
  duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
  total_price DECIMAL(10,2) NOT NULL,
  special_requests TEXT,
  
  -- Recurrence pattern
  recurrence_type TEXT NOT NULL CHECK (recurrence_type IN ('daily', 'weekly', 'monthly')),
  interval INT NOT NULL DEFAULT 1 CHECK (interval > 0),
  days_of_week INT[] NULL, -- for weekly patterns; 0=Sunday..6=Saturday
  
  -- End conditions
  end_date DATE NULL,
  max_occurrences INT NULL CHECK (max_occurrences IS NULL OR max_occurrences > 0),
  
  -- Housekeeping
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for recurring_appointment_series
CREATE INDEX idx_recurring_series_organization_id ON public.recurring_appointment_series(organization_id);
CREATE INDEX idx_recurring_series_homeowner_id ON public.recurring_appointment_series(homeowner_id);
CREATE INDEX idx_recurring_series_cleaner_id ON public.recurring_appointment_series(cleaner_id);
CREATE INDEX idx_recurring_series_property_id ON public.recurring_appointment_series(property_id);
CREATE INDEX idx_recurring_series_is_active ON public.recurring_appointment_series(is_active);

-- Add updated_at trigger
CREATE TRIGGER update_recurring_appointment_series_updated_at 
  BEFORE UPDATE ON public.recurring_appointment_series
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PART B: Add series_id column to appointments table
-- ============================================================================

ALTER TABLE public.appointments
  ADD COLUMN series_id UUID REFERENCES public.recurring_appointment_series(id) ON DELETE SET NULL;

-- Create index for series_id
CREATE INDEX idx_appointments_series_id ON public.appointments(series_id);

-- ============================================================================
-- PART C: Enable RLS and create policies for recurring_appointment_series
-- ============================================================================

ALTER TABLE public.recurring_appointment_series ENABLE ROW LEVEL SECURITY;

-- Admin/Owner can view all series in their organization
CREATE POLICY "Admin can view all series in their organization"
ON public.recurring_appointment_series FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = recurring_appointment_series.organization_id
    AND om.user_id = auth.uid()
    AND (om.role = 'admin' OR om.role = 'owner')
  )
);

-- Manager can view series if they have booking permissions
CREATE POLICY "Manager can view series if permitted"
ON public.recurring_appointment_series FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members om
    INNER JOIN public.manager_permissions mp ON om.user_id = mp.manager_id
    WHERE om.organization_id = recurring_appointment_series.organization_id
    AND om.user_id = auth.uid()
    AND om.role = 'manager'
    AND mp.can_view_bookings = true
  )
);

-- Homeowner can view their own series
CREATE POLICY "Homeowner can view their own series"
ON public.recurring_appointment_series FOR SELECT
TO authenticated
USING (
  homeowner_id = auth.uid()
);

-- Cleaner can view series assigned to them
CREATE POLICY "Cleaner can view their assigned series"
ON public.recurring_appointment_series FOR SELECT
TO authenticated
USING (
  cleaner_id = auth.uid()
);

-- Admin/Owner can insert series in their organization
CREATE POLICY "Admin can insert series in their organization"
ON public.recurring_appointment_series FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = recurring_appointment_series.organization_id
    AND om.user_id = auth.uid()
    AND (om.role = 'admin' OR om.role = 'owner')
  )
);

-- Manager can insert series if they have edit booking permissions
CREATE POLICY "Manager can insert series if permitted"
ON public.recurring_appointment_series FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members om
    INNER JOIN public.manager_permissions mp ON om.user_id = mp.manager_id
    WHERE om.organization_id = recurring_appointment_series.organization_id
    AND om.user_id = auth.uid()
    AND om.role = 'manager'
    AND mp.can_edit_bookings = true
  )
);

-- Admin/Owner can update series in their organization
CREATE POLICY "Admin can update series in their organization"
ON public.recurring_appointment_series FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = recurring_appointment_series.organization_id
    AND om.user_id = auth.uid()
    AND (om.role = 'admin' OR om.role = 'owner')
  )
);

-- Manager can update series if permitted
CREATE POLICY "Manager can update series if permitted"
ON public.recurring_appointment_series FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members om
    INNER JOIN public.manager_permissions mp ON om.user_id = mp.manager_id
    WHERE om.organization_id = recurring_appointment_series.organization_id
    AND om.user_id = auth.uid()
    AND om.role = 'manager'
    AND mp.can_edit_bookings = true
  )
);

-- Admin/Owner can delete series in their organization
CREATE POLICY "Admin can delete series in their organization"
ON public.recurring_appointment_series FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = recurring_appointment_series.organization_id
    AND om.user_id = auth.uid()
    AND (om.role = 'admin' OR om.role = 'owner')
  )
);

-- Manager can delete series if permitted
CREATE POLICY "Manager can delete series if permitted"
ON public.recurring_appointment_series FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members om
    INNER JOIN public.manager_permissions mp ON om.user_id = mp.manager_id
    WHERE om.organization_id = recurring_appointment_series.organization_id
    AND om.user_id = auth.uid()
    AND om.role = 'manager'
    AND mp.can_edit_bookings = true
  )
);

