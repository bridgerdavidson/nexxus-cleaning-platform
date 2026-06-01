-- 074_rls_initplan_and_consolidate.sql
--
-- PERFORMANCE: fix `auth_rls_initplan` + `multiple_permissive_policies` on the
-- three hottest dashboard tables (appointments, user_profiles, properties).
--
-- WHY: In production the deep nested-embed dashboard queries were hitting the
-- statement timeout under concurrent load (-> 500 -> the stats hooks fell back
-- to a slow multi-query waterfall -> more load -> cascade). Root cause was RLS,
-- not data volume: every policy re-evaluated auth.uid()/auth.jwt() PER ROW
-- (auth_rls_initplan), and each table had many permissive policies that Postgres
-- OR-evaluates separately PER ROW (multiple_permissive_policies). With ~9 tables
-- embedded per appointment row, the per-row cost multiplied past the timeout.
--
-- WHAT: For each (table, command) we collapse all permissive policies into ONE
-- policy whose predicate is the exact OR of the originals, with every
-- auth.uid()/auth.jwt() wrapped in `(select ...)` so it hoists to a
-- once-per-statement InitPlan instead of running per row. Role is narrowed to
-- `authenticated` (every predicate already requires a non-null uid, so `anon` --
-- which matched nothing before -- still matches nothing). Helper functions
-- (is_admin_or_manager_in_org / user_shares_org_with_homeowner /
-- can_admin_update_user_profile / users_share_organization / is_platform_admin)
-- are intentionally left untouched: they are STABLE SECURITY DEFINER and that
-- SECURITY DEFINER is load-bearing (it bypasses organization_members RLS to
-- avoid recursion), which also makes them non-inlinable -- so we do NOT rewrite
-- them here.
--
-- SEMANTICS: access is preserved exactly. The only simplifications are removing
-- duplicate terms and folding `role='admin'` into the broader `role IN
-- ('admin','manager')` term that already existed (admin is a strict subset).
-- A2 (stopgap): raise the authenticated statement_timeout so a slow query
-- completes slowly rather than 500-ing into the legacy fallback waterfalls.

-- =====================================================================
-- APPOINTMENTS
-- =====================================================================
DROP POLICY IF EXISTS "Org admins and managers can delete appointments" ON public.appointments;
DROP POLICY IF EXISTS "Admins can insert appointments" ON public.appointments;
DROP POLICY IF EXISTS "Homeowners can create appointments" ON public.appointments;
DROP POLICY IF EXISTS "Managers can insert appointments" ON public.appointments;
DROP POLICY IF EXISTS "Admins and managers can view org appointments" ON public.appointments;
DROP POLICY IF EXISTS "Admins can view all appointments" ON public.appointments;
DROP POLICY IF EXISTS "Cleaners can view their appointments" ON public.appointments;
DROP POLICY IF EXISTS "Homeowners can view their appointments" ON public.appointments;
DROP POLICY IF EXISTS "Managers can view all appointments" ON public.appointments;
DROP POLICY IF EXISTS "platform admin can read appointments" ON public.appointments;
DROP POLICY IF EXISTS "Admins and managers can update org appointments" ON public.appointments;
DROP POLICY IF EXISTS "Admins can update any appointment" ON public.appointments;
DROP POLICY IF EXISTS "Cleaners can update appointment status" ON public.appointments;
DROP POLICY IF EXISTS "Homeowners can update their appointments" ON public.appointments;
DROP POLICY IF EXISTS "Managers can update any appointment" ON public.appointments;
DROP POLICY IF EXISTS "Managers can update appointments" ON public.appointments;

CREATE POLICY "appointments_select" ON public.appointments
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = homeowner_id
    OR (select auth.uid()) = cleaner_id
    OR (organization_id IS NOT NULL AND public.is_admin_or_manager_in_org(organization_id))
    OR public.user_shares_org_with_homeowner(homeowner_id)
    OR (((select auth.jwt()) -> 'app_metadata' ->> 'role') = ANY (ARRAY['admin', 'manager']))
    OR public.is_platform_admin((select auth.uid()))
  );

CREATE POLICY "appointments_insert" ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = homeowner_id
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = (select auth.uid())
        AND up.role = ANY (ARRAY['admin'::public.user_role, 'manager'::public.user_role])
    )
  );

CREATE POLICY "appointments_update" ON public.appointments
  FOR UPDATE TO authenticated
  USING (
    (select auth.uid()) = homeowner_id
    OR (select auth.uid()) = cleaner_id
    OR (organization_id IS NOT NULL AND public.is_admin_or_manager_in_org(organization_id))
    OR public.user_shares_org_with_homeowner(homeowner_id)
    OR (((select auth.jwt()) -> 'app_metadata' ->> 'role') = ANY (ARRAY['admin', 'manager']))
  );

CREATE POLICY "appointments_delete" ON public.appointments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = appointments.organization_id
        AND om.user_id = (select auth.uid())
        AND om.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
    )
  );

-- =====================================================================
-- USER_PROFILES
-- =====================================================================
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Admins can view all user profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Cleaners can view homeowner profiles for their appointments" ON public.user_profiles;
DROP POLICY IF EXISTS "Managers can view all user profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can view profiles of conversation participants" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can view profiles of message contacts" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can view profiles of organization members" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "platform admin can read user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Admins and managers can update org user profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.user_profiles;

CREATE POLICY "user_profiles_select" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = id
    OR (((select auth.jwt()) -> 'app_metadata' ->> 'role') = ANY (ARRAY['admin', 'manager']))
    OR EXISTS (
      SELECT 1 FROM public.appointments
      WHERE appointments.homeowner_id = user_profiles.id
        AND appointments.cleaner_id = (select auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.conversations
      WHERE (conversations.participant_1_id = (select auth.uid()) AND conversations.participant_2_id = user_profiles.id)
         OR (conversations.participant_2_id = (select auth.uid()) AND conversations.participant_1_id = user_profiles.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.messages
      WHERE (messages.sender_id = user_profiles.id AND messages.recipient_id = (select auth.uid()))
         OR (messages.recipient_id = user_profiles.id AND messages.sender_id = (select auth.uid()))
    )
    OR public.users_share_organization((select auth.uid()), id)
    OR public.is_platform_admin((select auth.uid()))
  );

CREATE POLICY "user_profiles_insert" ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK ( (select auth.uid()) = id );

CREATE POLICY "user_profiles_update" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (
    (select auth.uid()) = id
    OR public.can_admin_update_user_profile((select auth.uid()), id)
  );

-- =====================================================================
-- PROPERTIES
-- =====================================================================
DROP POLICY IF EXISTS "Homeowners can manage their own properties" ON public.properties;
DROP POLICY IF EXISTS "Admins and managers can delete org properties" ON public.properties;
DROP POLICY IF EXISTS "Admins can delete properties" ON public.properties;
DROP POLICY IF EXISTS "Admins and managers can insert org properties" ON public.properties;
DROP POLICY IF EXISTS "Admins can insert properties" ON public.properties;
DROP POLICY IF EXISTS "Admins and managers can view org properties" ON public.properties;
DROP POLICY IF EXISTS "Admins can view all properties" ON public.properties;
DROP POLICY IF EXISTS "Cleaners can view properties for their appointments" ON public.properties;
DROP POLICY IF EXISTS "Homeowners can view their own properties" ON public.properties;
DROP POLICY IF EXISTS "Managers can view all properties" ON public.properties;
DROP POLICY IF EXISTS "platform admin can read properties" ON public.properties;
DROP POLICY IF EXISTS "Admins and managers can update org properties" ON public.properties;
DROP POLICY IF EXISTS "Admins can update properties" ON public.properties;
DROP POLICY IF EXISTS "Property owner or org admin/manager can update property photo_u" ON public.properties;

CREATE POLICY "properties_select" ON public.properties
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = owner_id
    OR EXISTS (
      SELECT 1 FROM public.organization_members om_viewer
      WHERE om_viewer.user_id = (select auth.uid())
        AND om_viewer.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
        AND EXISTS (
          SELECT 1 FROM public.organization_members om_target
          WHERE om_target.user_id = properties.owner_id
            AND om_target.role = 'homeowner'::public.org_role
            AND om_target.organization_id = om_viewer.organization_id
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.appointments
      WHERE appointments.property_id = properties.id
        AND appointments.cleaner_id = (select auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = (select auth.uid())
        AND up.role = ANY (ARRAY['admin'::public.user_role, 'manager'::public.user_role])
    )
    OR public.is_platform_admin((select auth.uid()))
  );

CREATE POLICY "properties_insert" ON public.properties
  FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = owner_id
    OR EXISTS (
      SELECT 1 FROM public.organization_members om_viewer
      WHERE om_viewer.user_id = (select auth.uid())
        AND om_viewer.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
        AND EXISTS (
          SELECT 1 FROM public.organization_members om_target
          WHERE om_target.user_id = properties.owner_id
            AND om_target.role = 'homeowner'::public.org_role
            AND om_target.organization_id = om_viewer.organization_id
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = (select auth.uid())
        AND up.role = 'admin'::public.user_role
    )
  );

CREATE POLICY "properties_update" ON public.properties
  FOR UPDATE TO authenticated
  USING (
    (select auth.uid()) = owner_id
    OR EXISTS (
      SELECT 1 FROM public.organization_members om_viewer
      WHERE om_viewer.user_id = (select auth.uid())
        AND om_viewer.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
        AND EXISTS (
          SELECT 1 FROM public.organization_members om_target
          WHERE om_target.user_id = properties.owner_id
            AND om_target.role = 'homeowner'::public.org_role
            AND om_target.organization_id = om_viewer.organization_id
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = (select auth.uid())
        AND up.role = 'admin'::public.user_role
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_members om_owner
      JOIN public.organization_members om_actor
        ON om_actor.organization_id = om_owner.organization_id
      WHERE om_owner.user_id = properties.owner_id
        AND om_actor.user_id = (select auth.uid())
        AND om_actor.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
    )
  );

CREATE POLICY "properties_delete" ON public.properties
  FOR DELETE TO authenticated
  USING (
    (select auth.uid()) = owner_id
    OR EXISTS (
      SELECT 1 FROM public.organization_members om_viewer
      WHERE om_viewer.user_id = (select auth.uid())
        AND om_viewer.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
        AND EXISTS (
          SELECT 1 FROM public.organization_members om_target
          WHERE om_target.user_id = properties.owner_id
            AND om_target.role = 'homeowner'::public.org_role
            AND om_target.organization_id = om_viewer.organization_id
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = (select auth.uid())
        AND up.role = 'admin'::public.user_role
    )
  );

-- =====================================================================
-- A2 stopgap: raise authenticated statement_timeout (takes effect on new
-- connections). Real fix is the RLS work above; this just prevents a slow
-- query from 500-ing into the legacy fallback waterfalls.
-- =====================================================================
ALTER ROLE authenticated SET statement_timeout = '15s';
