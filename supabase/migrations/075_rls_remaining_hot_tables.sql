-- 075_rls_remaining_hot_tables.sql
--
-- PERFORMANCE: same treatment as 074 (wrap auth.uid()/auth.jwt() in (select ...)
-- + collapse multiple permissive policies into one per command) for the
-- remaining hot multi-tenant tables: organization_members, cleaner_profiles,
-- messages, recurring_appointment_series, payments, payouts, invoices.
-- See 074 for the full rationale. Semantics are preserved exactly: each
-- consolidated predicate is the OR of the originals; helper functions
-- (is_admin_or_manager_in_org, can_admin_update_cleaner_profile,
-- can_message_user, get_user_organization_ids, is_platform_admin) are left
-- untouched (STABLE SECURITY DEFINER).
--
-- NOTE (unchanged, flagged for a later security review): cleaner_profiles keeps
-- its pre-existing `USING (true)` public SELECT ("Anyone can view cleaner
-- profiles"). It is intentionally NOT narrowed here so anonymous reads keep
-- working; tightening it is out of scope for this performance pass.

-- =====================================================================
-- ORGANIZATION_MEMBERS  (no self-reference; uses SECURITY DEFINER helpers)
-- =====================================================================
DROP POLICY IF EXISTS "Admins can delete organization members" ON public.organization_members;
DROP POLICY IF EXISTS "delete_org_members_self" ON public.organization_members;
DROP POLICY IF EXISTS "Admins can insert organization members" ON public.organization_members;
DROP POLICY IF EXISTS "insert_org_members" ON public.organization_members;
DROP POLICY IF EXISTS "Admins can view all organization members" ON public.organization_members;
DROP POLICY IF EXISTS "Managers can view organization members" ON public.organization_members;
DROP POLICY IF EXISTS "Users can view members of their organization" ON public.organization_members;
DROP POLICY IF EXISTS "Users can view their own memberships" ON public.organization_members;
DROP POLICY IF EXISTS "platform admin can read organization_members" ON public.organization_members;
DROP POLICY IF EXISTS "select_org_members_self" ON public.organization_members;
DROP POLICY IF EXISTS "Admins can update organization members" ON public.organization_members;
DROP POLICY IF EXISTS "update_org_members_self" ON public.organization_members;

CREATE POLICY "org_members_select" ON public.organization_members
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = user_id
    OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = (select auth.uid()) AND up.role = ANY (ARRAY['admin'::public.user_role, 'manager'::public.user_role]))
    OR (organization_id = ANY (public.get_user_organization_ids((select auth.uid()))))
    OR public.is_platform_admin((select auth.uid()))
  );

CREATE POLICY "org_members_insert" ON public.organization_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = (select auth.uid()) AND up.role = 'admin'::public.user_role)
    OR ((select auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = organization_members.organization_id AND o.created_by = (select auth.uid())))
  );

CREATE POLICY "org_members_update" ON public.organization_members
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = (select auth.uid()) AND up.role = 'admin'::public.user_role)
    OR user_id = (select auth.uid())
  );

CREATE POLICY "org_members_delete" ON public.organization_members
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = (select auth.uid()) AND up.role = 'admin'::public.user_role)
    OR user_id = (select auth.uid())
  );

-- =====================================================================
-- CLEANER_PROFILES
-- =====================================================================
DROP POLICY IF EXISTS "Cleaners can insert their own profile" ON public.cleaner_profiles;
DROP POLICY IF EXISTS "Admins can view all cleaner profiles" ON public.cleaner_profiles;
DROP POLICY IF EXISTS "Anyone can view cleaner profiles" ON public.cleaner_profiles;
DROP POLICY IF EXISTS "Cleaners can view their own profile" ON public.cleaner_profiles;
DROP POLICY IF EXISTS "Managers can view all cleaner profiles" ON public.cleaner_profiles;
DROP POLICY IF EXISTS "platform admin can read cleaner_profiles" ON public.cleaner_profiles;
DROP POLICY IF EXISTS "Admins and managers can update org cleaner profiles" ON public.cleaner_profiles;
DROP POLICY IF EXISTS "Cleaners can update their own profile" ON public.cleaner_profiles;
DROP POLICY IF EXISTS "Managers can update cleaner profiles" ON public.cleaner_profiles;

-- Preserves the pre-existing public read (see NOTE at top of file).
CREATE POLICY "cleaner_profiles_select" ON public.cleaner_profiles
  FOR SELECT TO public
  USING (true);

CREATE POLICY "cleaner_profiles_insert" ON public.cleaner_profiles
  FOR INSERT TO authenticated
  WITH CHECK ( (select auth.uid()) = id );

CREATE POLICY "cleaner_profiles_update" ON public.cleaner_profiles
  FOR UPDATE TO authenticated
  USING (
    (select auth.uid()) = id
    OR public.can_admin_update_cleaner_profile((select auth.uid()), id)
    OR (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'manager')
  );

-- =====================================================================
-- MESSAGES
-- =====================================================================
DROP POLICY IF EXISTS "Managers can send messages" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
DROP POLICY IF EXISTS "Admins can view all messages" ON public.messages;
DROP POLICY IF EXISTS "Managers can view all messages" ON public.messages;
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
DROP POLICY IF EXISTS "Users can view their messages" ON public.messages;
DROP POLICY IF EXISTS "platform admin can read messages" ON public.messages;
DROP POLICY IF EXISTS "Users can update their received messages" ON public.messages;

CREATE POLICY "messages_select" ON public.messages
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = sender_id
    OR (select auth.uid()) = recipient_id
    OR (((select auth.jwt()) -> 'app_metadata' ->> 'role') = ANY (ARRAY['admin', 'manager']))
    OR EXISTS (SELECT 1 FROM public.conversations WHERE conversations.id = messages.conversation_id AND (conversations.participant_1_id = (select auth.uid()) OR conversations.participant_2_id = (select auth.uid())))
    OR public.is_platform_admin((select auth.uid()))
  );

CREATE POLICY "messages_insert" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    ((select auth.uid()) = sender_id AND public.can_message_user(recipient_id))
    OR ((((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'manager') AND (select auth.uid()) = sender_id)
  );

CREATE POLICY "messages_update" ON public.messages
  FOR UPDATE TO authenticated
  USING ( (select auth.uid()) = recipient_id )
  WITH CHECK ( (select auth.uid()) = recipient_id );

-- =====================================================================
-- PAYMENTS  (read-only via RLS; writes go through service role)
-- =====================================================================
DROP POLICY IF EXISTS "Admins can view all payments" ON public.payments;
DROP POLICY IF EXISTS "Managers can view all payments" ON public.payments;
DROP POLICY IF EXISTS "Users can view payments for their appointments" ON public.payments;
DROP POLICY IF EXISTS "platform admin can read payments" ON public.payments;

CREATE POLICY "payments_select" ON public.payments
  FOR SELECT TO authenticated
  USING (
    (((select auth.jwt()) -> 'app_metadata' ->> 'role') = ANY (ARRAY['admin', 'manager']))
    OR EXISTS (SELECT 1 FROM public.appointments WHERE appointments.id = payments.appointment_id AND (appointments.homeowner_id = (select auth.uid()) OR appointments.cleaner_id = (select auth.uid())))
    OR public.is_platform_admin((select auth.uid()))
  );

-- =====================================================================
-- PAYOUTS
-- =====================================================================
DROP POLICY IF EXISTS "Admin can delete payouts in their organization" ON public.payouts;
DROP POLICY IF EXISTS "Admin can insert payouts in their organization" ON public.payouts;
DROP POLICY IF EXISTS "Admin can view all payouts in their organization" ON public.payouts;
DROP POLICY IF EXISTS "Cleaner can view their own payouts" ON public.payouts;
DROP POLICY IF EXISTS "Manager can view payouts if permitted" ON public.payouts;
DROP POLICY IF EXISTS "platform admin can read payouts" ON public.payouts;
DROP POLICY IF EXISTS "Admin can update payouts in their organization" ON public.payouts;
DROP POLICY IF EXISTS "Manager can update payouts if permitted" ON public.payouts;

CREATE POLICY "payouts_select" ON public.payouts
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.organization_members om JOIN public.user_profiles up ON om.user_id = up.id WHERE om.organization_id = payouts.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
    OR cleaner_id = (select auth.uid())
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON om.user_id = mp.manager_id WHERE om.organization_id = payouts.organization_id AND om.user_id = (select auth.uid()) AND om.role = 'manager'::public.org_role AND mp.can_view_payments = true)
    OR public.is_platform_admin((select auth.uid()))
  );

CREATE POLICY "payouts_insert" ON public.payouts
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = payouts.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
  );

CREATE POLICY "payouts_update" ON public.payouts
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = payouts.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON om.user_id = mp.manager_id WHERE om.organization_id = payouts.organization_id AND om.user_id = (select auth.uid()) AND om.role = 'manager'::public.org_role AND mp.can_manage_payments = true)
  );

CREATE POLICY "payouts_delete" ON public.payouts
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = payouts.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
  );

-- =====================================================================
-- INVOICES
-- =====================================================================
DROP POLICY IF EXISTS "Admin can delete invoices in their organization" ON public.invoices;
DROP POLICY IF EXISTS "Admin can insert invoices in their organization" ON public.invoices;
DROP POLICY IF EXISTS "Admin can view all invoices in their organization" ON public.invoices;
DROP POLICY IF EXISTS "Homeowner can view their own invoices" ON public.invoices;
DROP POLICY IF EXISTS "Manager can view invoices if permitted" ON public.invoices;
DROP POLICY IF EXISTS "platform admin can read invoices" ON public.invoices;
DROP POLICY IF EXISTS "Admin can update invoices in their organization" ON public.invoices;
DROP POLICY IF EXISTS "Manager can update invoices if permitted" ON public.invoices;

CREATE POLICY "invoices_select" ON public.invoices
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = invoices.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
    OR homeowner_id = (select auth.uid())
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON om.user_id = mp.manager_id WHERE om.organization_id = invoices.organization_id AND om.user_id = (select auth.uid()) AND om.role = 'manager'::public.org_role AND mp.can_view_payments = true)
    OR public.is_platform_admin((select auth.uid()))
  );

CREATE POLICY "invoices_insert" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = invoices.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
  );

CREATE POLICY "invoices_update" ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = invoices.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON om.user_id = mp.manager_id WHERE om.organization_id = invoices.organization_id AND om.user_id = (select auth.uid()) AND om.role = 'manager'::public.org_role AND mp.can_manage_payments = true)
  );

-- =====================================================================
-- RECURRING_APPOINTMENT_SERIES
-- =====================================================================
DROP POLICY IF EXISTS "Admin can delete series in their organization" ON public.recurring_appointment_series;
DROP POLICY IF EXISTS "Manager can delete series if permitted" ON public.recurring_appointment_series;
DROP POLICY IF EXISTS "Admin can insert series in their organization" ON public.recurring_appointment_series;
DROP POLICY IF EXISTS "Manager can insert series if permitted" ON public.recurring_appointment_series;
DROP POLICY IF EXISTS "Admin can view all series in their organization" ON public.recurring_appointment_series;
DROP POLICY IF EXISTS "Cleaner can view their assigned series" ON public.recurring_appointment_series;
DROP POLICY IF EXISTS "Homeowner can view their own series" ON public.recurring_appointment_series;
DROP POLICY IF EXISTS "Manager can view series if permitted" ON public.recurring_appointment_series;
DROP POLICY IF EXISTS "Admin can update series in their organization" ON public.recurring_appointment_series;
DROP POLICY IF EXISTS "Manager can update series if permitted" ON public.recurring_appointment_series;

CREATE POLICY "recurring_series_select" ON public.recurring_appointment_series
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = recurring_appointment_series.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
    OR cleaner_id = (select auth.uid())
    OR homeowner_id = (select auth.uid())
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON om.user_id = mp.manager_id WHERE om.organization_id = recurring_appointment_series.organization_id AND om.user_id = (select auth.uid()) AND om.role = 'manager'::public.org_role AND mp.can_view_bookings = true)
  );

CREATE POLICY "recurring_series_insert" ON public.recurring_appointment_series
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = recurring_appointment_series.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON om.user_id = mp.manager_id WHERE om.organization_id = recurring_appointment_series.organization_id AND om.user_id = (select auth.uid()) AND om.role = 'manager'::public.org_role AND mp.can_edit_bookings = true)
  );

CREATE POLICY "recurring_series_update" ON public.recurring_appointment_series
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = recurring_appointment_series.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON om.user_id = mp.manager_id WHERE om.organization_id = recurring_appointment_series.organization_id AND om.user_id = (select auth.uid()) AND om.role = 'manager'::public.org_role AND mp.can_edit_bookings = true)
  );

CREATE POLICY "recurring_series_delete" ON public.recurring_appointment_series
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = recurring_appointment_series.organization_id AND om.user_id = (select auth.uid()) AND (om.role = 'admin'::public.org_role OR om.role = 'owner'::public.org_role))
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON om.user_id = mp.manager_id WHERE om.organization_id = recurring_appointment_series.organization_id AND om.user_id = (select auth.uid()) AND om.role = 'manager'::public.org_role AND mp.can_edit_bookings = true)
  );
