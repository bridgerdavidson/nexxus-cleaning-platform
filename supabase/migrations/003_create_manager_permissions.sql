-- Create manager_permissions table
CREATE TABLE IF NOT EXISTS public.manager_permissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    manager_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    can_view_customers BOOLEAN DEFAULT false,
    can_edit_customers BOOLEAN DEFAULT false,
    can_view_bookings BOOLEAN DEFAULT false,
    can_edit_bookings BOOLEAN DEFAULT false,
    can_manage_cleaners BOOLEAN DEFAULT false,
    can_view_properties BOOLEAN DEFAULT false,
    can_edit_properties BOOLEAN DEFAULT false,
    can_view_analytics BOOLEAN DEFAULT false,
    can_view_payments BOOLEAN DEFAULT false,
    can_manage_payments BOOLEAN DEFAULT false,
    can_view_messages BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (manager_id, organization_id)
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_manager_permissions_manager_id ON public.manager_permissions(manager_id);
CREATE INDEX IF NOT EXISTS idx_manager_permissions_organization_id ON public.manager_permissions(organization_id);

-- Enable RLS
ALTER TABLE public.manager_permissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Managers can view their own permissions
CREATE POLICY "Managers can view their own permissions" ON public.manager_permissions
    FOR SELECT USING (auth.uid() = manager_id);

-- Admins can view all manager permissions in their organization
CREATE POLICY "Admins can view manager permissions in their organization" ON public.manager_permissions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.organization_members
            WHERE organization_members.user_id = auth.uid()
            AND organization_members.organization_id = manager_permissions.organization_id
            AND organization_members.role IN ('owner', 'admin')
        )
    );

-- Admins can insert manager permissions in their organization
CREATE POLICY "Admins can insert manager permissions in their organization" ON public.manager_permissions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.organization_members
            WHERE organization_members.user_id = auth.uid()
            AND organization_members.organization_id = manager_permissions.organization_id
            AND organization_members.role IN ('owner', 'admin')
        )
    );

-- Admins can update manager permissions in their organization
CREATE POLICY "Admins can update manager permissions in their organization" ON public.manager_permissions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.organization_members
            WHERE organization_members.user_id = auth.uid()
            AND organization_members.organization_id = manager_permissions.organization_id
            AND organization_members.role IN ('owner', 'admin')
        )
    );

-- Admins can delete manager permissions in their organization
CREATE POLICY "Admins can delete manager permissions in their organization" ON public.manager_permissions
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.organization_members
            WHERE organization_members.user_id = auth.uid()
            AND organization_members.organization_id = manager_permissions.organization_id
            AND organization_members.role IN ('owner', 'admin')
        )
    );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_manager_permissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_manager_permissions_updated_at
    BEFORE UPDATE ON public.manager_permissions
    FOR EACH ROW
    EXECUTE FUNCTION update_manager_permissions_updated_at();

