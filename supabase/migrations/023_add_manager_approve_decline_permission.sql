-- Add can_approve_decline_bookings permission to manager_permissions table
ALTER TABLE public.manager_permissions
ADD COLUMN IF NOT EXISTS can_approve_decline_bookings BOOLEAN DEFAULT false;

-- Set default to false for existing records
UPDATE public.manager_permissions
SET can_approve_decline_bookings = false
WHERE can_approve_decline_bookings IS NULL;

-- Add comment to document the permission
COMMENT ON COLUMN public.manager_permissions.can_approve_decline_bookings IS 'Allows manager to approve or decline pending appointment requests';

