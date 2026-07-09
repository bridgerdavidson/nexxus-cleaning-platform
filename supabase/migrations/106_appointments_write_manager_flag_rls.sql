-- 106_appointments_write_manager_flag_rls.sql
--
-- Close the last enforcement gap from the manager-permissions overhaul. The
-- redesigned Operator dashboard persists start/complete/cancel/reschedule via
-- DIRECT client writes to `appointments` (not the API routes that were guarded in
-- this feature), and the live appointments write RLS (created in 074, patched by
-- 078/083) admits any org owner/admin/MANAGER with no fine-grained flag, via
-- is_admin_or_manager_in_org() and, on UPDATE, user_shares_org_with_homeowner().
-- So a manager with can_edit_bookings = false could still change appointments by
-- calling Supabase directly. This migration gates the MANAGER sub-branch of the
-- appointments write policies on can_edit_bookings, leaving the homeowner-self,
-- cleaner-self, owner/admin, and platform-admin branches unchanged.
--
-- Two new SECURITY DEFINER helpers mirror the existing is_admin_or_manager_in_org
-- / user_shares_org_with_homeowner pattern (SECURITY DEFINER bypasses RLS and
-- avoids the organization_members recursion that 078/083 fixed), but split
-- owner/admin (unconditional) from manager (requires can_edit_bookings). The
-- original helpers are left intact for their other callers (appointments SELECT,
-- other tables); only the appointments WRITE policies switch to the new helpers.

CREATE OR REPLACE FUNCTION public.can_write_org_appointments(check_org_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  -- Owner/admin in the org write unconditionally; a manager needs can_edit_bookings.
  RETURN EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = check_org_id
      AND om.role IN ('owner', 'admin')
  ) OR EXISTS (
    SELECT 1 FROM public.organization_members om
    JOIN public.manager_permissions mp
      ON mp.manager_id = om.user_id AND mp.organization_id = om.organization_id
    WHERE om.user_id = auth.uid()
      AND om.organization_id = check_org_id
      AND om.role = 'manager'
      AND mp.can_edit_bookings = true
  );
END;
$$;
ALTER FUNCTION public.can_write_org_appointments(uuid) OWNER TO postgres;
COMMENT ON FUNCTION public.can_write_org_appointments(uuid) IS 'SECURITY DEFINER: owner/admin in org, or manager with can_edit_bookings. Gates appointments write RLS on the fine-grained booking flag.';

CREATE OR REPLACE FUNCTION public.can_write_appointments_for_homeowner(check_homeowner_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  -- Owner/admin sharing an org with the homeowner write unconditionally;
  -- a manager sharing an org needs can_edit_bookings.
  RETURN EXISTS (
    SELECT 1
    FROM public.organization_members om_actor
    JOIN public.organization_members om_home
      ON om_actor.organization_id = om_home.organization_id
    WHERE om_actor.user_id = auth.uid()
      AND om_home.user_id = check_homeowner_id
      AND om_actor.role IN ('owner', 'admin')
  ) OR EXISTS (
    SELECT 1
    FROM public.organization_members om_actor
    JOIN public.organization_members om_home
      ON om_actor.organization_id = om_home.organization_id
    JOIN public.manager_permissions mp
      ON mp.manager_id = om_actor.user_id AND mp.organization_id = om_actor.organization_id
    WHERE om_actor.user_id = auth.uid()
      AND om_home.user_id = check_homeowner_id
      AND om_actor.role = 'manager'
      AND mp.can_edit_bookings = true
  );
END;
$$;
ALTER FUNCTION public.can_write_appointments_for_homeowner(uuid) OWNER TO postgres;
COMMENT ON FUNCTION public.can_write_appointments_for_homeowner(uuid) IS 'SECURITY DEFINER: owner/admin sharing an org with the homeowner, or such a manager with can_edit_bookings. Gates the appointments UPDATE cross-membership branch on the booking flag.';

-- Rewrite the three appointments write policies to use the flag-gated helpers for
-- the manager branch. All non-manager branches are preserved verbatim from the
-- live definitions (074 + the 078/083 recursion patches): homeowner-self,
-- cleaner-self (UPDATE), and platform-admin.

DROP POLICY IF EXISTS "appointments_insert" ON public.appointments;
CREATE POLICY "appointments_insert" ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (
    ((select auth.uid()) = homeowner_id)
    OR ((organization_id IS NOT NULL) AND public.can_write_org_appointments(organization_id))
    OR public.is_platform_admin((select auth.uid()))
  );

DROP POLICY IF EXISTS "appointments_update" ON public.appointments;
CREATE POLICY "appointments_update" ON public.appointments
  FOR UPDATE TO authenticated
  USING (
    ((select auth.uid()) = homeowner_id)
    OR ((select auth.uid()) = cleaner_id)
    OR ((organization_id IS NOT NULL) AND public.can_write_org_appointments(organization_id))
    OR public.can_write_appointments_for_homeowner(homeowner_id)
  );

DROP POLICY IF EXISTS "appointments_delete" ON public.appointments;
CREATE POLICY "appointments_delete" ON public.appointments
  FOR DELETE TO authenticated
  USING (
    ((organization_id IS NOT NULL) AND public.can_write_org_appointments(organization_id))
    OR public.is_platform_admin((select auth.uid()))
  );
