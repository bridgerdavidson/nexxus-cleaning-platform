-- Debug: Service update returns 0 rows (PGRST116 / 406)
-- Run in Supabase SQL Editor. Replace USER_ID_HERE and SERVICE_ID_HERE (and SERVICE_ORG_ID_HERE in C)
-- with values from the app "Debug: why did this fail?" panel (Copy debug info).

-- =============================================================================
-- A) organization_members for this user
-- RLS UPDATE on service_types requires: user_id = auth.uid() AND role IN ('owner','admin','manager')
-- =============================================================================
SELECT id, organization_id, user_id, role, created_at
FROM organization_members
WHERE user_id = 'USER_ID_HERE';

-- =============================================================================
-- B) The service_types row you are updating
-- =============================================================================
SELECT id, organization_id, name, is_active
FROM service_types
WHERE id = 'SERVICE_ID_HERE';

-- =============================================================================
-- C) Does this user have owner/admin/manager for the service's organization?
-- Use the organization_id from (B) as SERVICE_ORG_ID_HERE. If this returns no rows
-- or role is not owner/admin/manager, RLS blocks the update. Role is case-sensitive.
-- =============================================================================
SELECT om.organization_id, om.role,
  (om.role IN ('owner', 'admin', 'manager')) AS can_update_services
FROM organization_members om
WHERE om.user_id = 'USER_ID_HERE'
  AND om.organization_id = 'SERVICE_ORG_ID_HERE';
