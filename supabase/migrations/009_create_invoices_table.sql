-- Create invoice_status enum
CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'cancelled');

-- Create invoices table
CREATE TABLE invoices (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    homeowner_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
    invoice_number TEXT UNIQUE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status invoice_status DEFAULT 'draft',
    due_date DATE,
    paid_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_invoices_organization_id ON invoices(organization_id);
CREATE INDEX idx_invoices_payment_id ON invoices(payment_id);
CREATE INDEX idx_invoices_appointment_id ON invoices(appointment_id);
CREATE INDEX idx_invoices_homeowner_id ON invoices(homeowner_id);
CREATE INDEX idx_invoices_invoice_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_status ON invoices(status);

-- Enable RLS
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- RLS Policies for invoices

-- Admin can view all invoices in their organization
CREATE POLICY "Admin can view all invoices in their organization"
ON invoices FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = invoices.organization_id
    AND om.user_id = auth.uid()
    AND (om.role = 'admin' OR om.role = 'owner')
  )
);

-- Manager can view all invoices in their organization (if they have payment permissions)
CREATE POLICY "Manager can view invoices if permitted"
ON invoices FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members om
    INNER JOIN manager_permissions mp ON om.user_id = mp.manager_id
    WHERE om.organization_id = invoices.organization_id
    AND om.user_id = auth.uid()
    AND om.role = 'manager'
    AND mp.can_view_payments = true
  )
);

-- Homeowner can view their own invoices
CREATE POLICY "Homeowner can view their own invoices"
ON invoices FOR SELECT
TO authenticated
USING (
  homeowner_id = auth.uid()
);

-- Admin can insert invoices in their organization
CREATE POLICY "Admin can insert invoices in their organization"
ON invoices FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = invoices.organization_id
    AND om.user_id = auth.uid()
    AND (om.role = 'admin' OR om.role = 'owner')
  )
);

-- Admin and permitted managers can update invoices
CREATE POLICY "Admin can update invoices in their organization"
ON invoices FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = invoices.organization_id
    AND om.user_id = auth.uid()
    AND (om.role = 'admin' OR om.role = 'owner')
  )
);

CREATE POLICY "Manager can update invoices if permitted"
ON invoices FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members om
    INNER JOIN manager_permissions mp ON om.user_id = mp.manager_id
    WHERE om.organization_id = invoices.organization_id
    AND om.user_id = auth.uid()
    AND om.role = 'manager'
    AND mp.can_manage_payments = true
  )
);

-- Admin can delete invoices in their organization
CREATE POLICY "Admin can delete invoices in their organization"
ON invoices FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = invoices.organization_id
    AND om.user_id = auth.uid()
    AND (om.role = 'admin' OR om.role = 'owner')
  )
);
