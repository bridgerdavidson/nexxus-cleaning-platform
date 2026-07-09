-- 104_manager_flags_rls_services_properties.sql
--
-- Enforce the manager fine-grained flags that only ever lived in the UI: the LIVE
-- write policies (service_types from 076, properties from 074) let ANY org
-- owner/admin/manager write regardless of manager_permissions. Split the manager
-- branch out and gate it on the flag (can_manage_services / can_edit_properties),
-- mirroring the org+flag shape used for invoices/payouts in 075. Owner/admin and the
-- self-owner / user_profiles-admin branches are preserved verbatim.

-- ================= SERVICE_TYPES (writes) =================
DROP POLICY IF EXISTS "service_types_insert" ON public.service_types;
DROP POLICY IF EXISTS "service_types_update" ON public.service_types;
DROP POLICY IF EXISTS "service_types_delete" ON public.service_types;

CREATE POLICY "service_types_insert" ON public.service_types
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = (select auth.uid()) AND om.organization_id = service_types.organization_id AND (om.role = 'owner'::public.org_role OR om.role = 'admin'::public.org_role))
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON mp.manager_id = om.user_id AND mp.organization_id = om.organization_id WHERE om.user_id = (select auth.uid()) AND om.organization_id = service_types.organization_id AND om.role = 'manager'::public.org_role AND mp.can_manage_services = true)
  );
CREATE POLICY "service_types_update" ON public.service_types
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = (select auth.uid()) AND om.organization_id = service_types.organization_id AND (om.role = 'owner'::public.org_role OR om.role = 'admin'::public.org_role))
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON mp.manager_id = om.user_id AND mp.organization_id = om.organization_id WHERE om.user_id = (select auth.uid()) AND om.organization_id = service_types.organization_id AND om.role = 'manager'::public.org_role AND mp.can_manage_services = true)
  );
CREATE POLICY "service_types_delete" ON public.service_types
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = (select auth.uid()) AND om.organization_id = service_types.organization_id AND (om.role = 'owner'::public.org_role OR om.role = 'admin'::public.org_role))
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON mp.manager_id = om.user_id AND mp.organization_id = om.organization_id WHERE om.user_id = (select auth.uid()) AND om.organization_id = service_types.organization_id AND om.role = 'manager'::public.org_role AND mp.can_manage_services = true)
  );

-- ================= PROPERTIES (writes) =================
DROP POLICY IF EXISTS "properties_insert" ON public.properties;
DROP POLICY IF EXISTS "properties_update" ON public.properties;
DROP POLICY IF EXISTS "properties_delete" ON public.properties;

CREATE POLICY "properties_insert" ON public.properties
  FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = owner_id
    OR EXISTS (SELECT 1 FROM public.organization_members om_viewer WHERE om_viewer.user_id = (select auth.uid()) AND om_viewer.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role]) AND EXISTS (SELECT 1 FROM public.organization_members om_target WHERE om_target.user_id = properties.owner_id AND om_target.role = 'homeowner'::public.org_role AND om_target.organization_id = om_viewer.organization_id))
    OR EXISTS (SELECT 1 FROM public.organization_members om_viewer JOIN public.manager_permissions mp ON mp.manager_id = om_viewer.user_id AND mp.organization_id = om_viewer.organization_id WHERE om_viewer.user_id = (select auth.uid()) AND om_viewer.role = 'manager'::public.org_role AND mp.can_edit_properties = true AND EXISTS (SELECT 1 FROM public.organization_members om_target WHERE om_target.user_id = properties.owner_id AND om_target.role = 'homeowner'::public.org_role AND om_target.organization_id = om_viewer.organization_id))
    OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = (select auth.uid()) AND up.role = 'admin'::public.user_role)
    OR (
      properties.owner_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om_self
        WHERE om_self.user_id = (select auth.uid())
          AND om_self.organization_id = properties.organization_id
          AND (om_self.role = 'owner'::public.org_role OR om_self.role = 'admin'::public.org_role)
      )
    )
    OR (
      properties.owner_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om_self
        JOIN public.manager_permissions mp_self
          ON mp_self.manager_id = om_self.user_id AND mp_self.organization_id = om_self.organization_id
        WHERE om_self.user_id = (select auth.uid())
          AND om_self.organization_id = properties.organization_id
          AND om_self.role = 'manager'::public.org_role
          AND mp_self.can_edit_properties = true
      )
    )
  );
CREATE POLICY "properties_update" ON public.properties
  FOR UPDATE TO authenticated
  USING (
    (select auth.uid()) = owner_id
    OR EXISTS (SELECT 1 FROM public.organization_members om_viewer WHERE om_viewer.user_id = (select auth.uid()) AND om_viewer.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role]) AND EXISTS (SELECT 1 FROM public.organization_members om_target WHERE om_target.user_id = properties.owner_id AND om_target.role = 'homeowner'::public.org_role AND om_target.organization_id = om_viewer.organization_id))
    OR EXISTS (SELECT 1 FROM public.organization_members om_viewer JOIN public.manager_permissions mp ON mp.manager_id = om_viewer.user_id AND mp.organization_id = om_viewer.organization_id WHERE om_viewer.user_id = (select auth.uid()) AND om_viewer.role = 'manager'::public.org_role AND mp.can_edit_properties = true AND EXISTS (SELECT 1 FROM public.organization_members om_target WHERE om_target.user_id = properties.owner_id AND om_target.role = 'homeowner'::public.org_role AND om_target.organization_id = om_viewer.organization_id))
    OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = (select auth.uid()) AND up.role = 'admin'::public.user_role)
    OR EXISTS (SELECT 1 FROM public.organization_members om_owner JOIN public.organization_members om_actor ON om_actor.organization_id = om_owner.organization_id WHERE om_owner.user_id = properties.owner_id AND om_actor.user_id = (select auth.uid()) AND om_actor.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role]))
    OR EXISTS (SELECT 1 FROM public.organization_members om_owner JOIN public.organization_members om_actor ON om_actor.organization_id = om_owner.organization_id JOIN public.manager_permissions mp ON mp.manager_id = om_actor.user_id AND mp.organization_id = om_actor.organization_id WHERE om_owner.user_id = properties.owner_id AND om_actor.user_id = (select auth.uid()) AND om_actor.role = 'manager'::public.org_role AND mp.can_edit_properties = true)
    OR (
      properties.owner_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om_self
        WHERE om_self.user_id = (select auth.uid())
          AND om_self.organization_id = properties.organization_id
          AND (om_self.role = 'owner'::public.org_role OR om_self.role = 'admin'::public.org_role)
      )
    )
    OR (
      properties.owner_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om_self
        JOIN public.manager_permissions mp_self
          ON mp_self.manager_id = om_self.user_id AND mp_self.organization_id = om_self.organization_id
        WHERE om_self.user_id = (select auth.uid())
          AND om_self.organization_id = properties.organization_id
          AND om_self.role = 'manager'::public.org_role
          AND mp_self.can_edit_properties = true
      )
    )
  );
CREATE POLICY "properties_delete" ON public.properties
  FOR DELETE TO authenticated
  USING (
    (select auth.uid()) = owner_id
    OR EXISTS (SELECT 1 FROM public.organization_members om_viewer WHERE om_viewer.user_id = (select auth.uid()) AND om_viewer.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role]) AND EXISTS (SELECT 1 FROM public.organization_members om_target WHERE om_target.user_id = properties.owner_id AND om_target.role = 'homeowner'::public.org_role AND om_target.organization_id = om_viewer.organization_id))
    OR EXISTS (SELECT 1 FROM public.organization_members om_viewer JOIN public.manager_permissions mp ON mp.manager_id = om_viewer.user_id AND mp.organization_id = om_viewer.organization_id WHERE om_viewer.user_id = (select auth.uid()) AND om_viewer.role = 'manager'::public.org_role AND mp.can_edit_properties = true AND EXISTS (SELECT 1 FROM public.organization_members om_target WHERE om_target.user_id = properties.owner_id AND om_target.role = 'homeowner'::public.org_role AND om_target.organization_id = om_viewer.organization_id))
    OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = (select auth.uid()) AND up.role = 'admin'::public.user_role)
    OR (
      properties.owner_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om_self
        WHERE om_self.user_id = (select auth.uid())
          AND om_self.organization_id = properties.organization_id
          AND (om_self.role = 'owner'::public.org_role OR om_self.role = 'admin'::public.org_role)
      )
    )
    OR (
      properties.owner_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members om_self
        JOIN public.manager_permissions mp_self
          ON mp_self.manager_id = om_self.user_id AND mp_self.organization_id = om_self.organization_id
        WHERE om_self.user_id = (select auth.uid())
          AND om_self.organization_id = properties.organization_id
          AND om_self.role = 'manager'::public.org_role
          AND mp_self.can_edit_properties = true
      )
    )
  );
