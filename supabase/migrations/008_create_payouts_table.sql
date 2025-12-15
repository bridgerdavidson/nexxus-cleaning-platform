-- Create payout_status enum
CREATE TYPE payout_status AS ENUM ('pending', 'approved', 'paid', 'failed');

-- Create payouts table
CREATE TABLE payouts (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    cleaner_id UUID REFERENCES cleaner_profiles(id) ON DELETE CASCADE NOT NULL,
    appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status payout_status DEFAULT 'pending',
    stripe_transfer_id TEXT,
    notes TEXT,
    approved_at TIMESTAMP WITH TIME ZONE,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_payouts_organization_id ON payouts(organization_id);
CREATE INDEX idx_payouts_cleaner_id ON payouts(cleaner_id);
CREATE INDEX idx_payouts_appointment_id ON payouts(appointment_id);
CREATE INDEX idx_payouts_status ON payouts(status);

-- Enable RLS
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for payouts

-- Admin can view all payouts in their organization
CREATE POLICY "Admin can view all payouts in their organization"
ON payouts FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members om
    INNER JOIN user_profiles up ON om.user_id = up.id
    WHERE om.organization_id = payouts.organization_id
    AND om.user_id = auth.uid()
    AND (om.role = 'admin' OR om.role = 'owner')
  )
);

-- Manager can view all payouts in their organization (if they have payment permissions)
CREATE POLICY "Manager can view payouts if permitted"
ON payouts FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members om
    INNER JOIN manager_permissions mp ON om.user_id = mp.manager_id
    WHERE om.organization_id = payouts.organization_id
    AND om.user_id = auth.uid()
    AND om.role = 'manager'
    AND mp.can_view_payments = true
  )
);

-- Cleaner can view their own payouts
CREATE POLICY "Cleaner can view their own payouts"
ON payouts FOR SELECT
TO authenticated
USING (
  cleaner_id = auth.uid()
);

-- Admin can insert payouts in their organization
CREATE POLICY "Admin can insert payouts in their organization"
ON payouts FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = payouts.organization_id
    AND om.user_id = auth.uid()
    AND (om.role = 'admin' OR om.role = 'owner')
  )
);

-- Admin and permitted managers can update payouts
CREATE POLICY "Admin can update payouts in their organization"
ON payouts FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = payouts.organization_id
    AND om.user_id = auth.uid()
    AND (om.role = 'admin' OR om.role = 'owner')
  )
);

CREATE POLICY "Manager can update payouts if permitted"
ON payouts FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members om
    INNER JOIN manager_permissions mp ON om.user_id = mp.manager_id
    WHERE om.organization_id = payouts.organization_id
    AND om.user_id = auth.uid()
    AND om.role = 'manager'
    AND mp.can_manage_payments = true
  )
);

-- Admin can delete payouts in their organization
CREATE POLICY "Admin can delete payouts in their organization"
ON payouts FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = payouts.organization_id
    AND om.user_id = auth.uid()
    AND (om.role = 'admin' OR om.role = 'owner')
  )
);
