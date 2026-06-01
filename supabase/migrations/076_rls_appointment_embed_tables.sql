-- 076_rls_appointment_embed_tables.sql
--
-- PERFORMANCE (Phase B): the production appointments-dashboard timeout came from
-- the deep PostgREST embed resolving ~9 tables per appointment row. 074/075 fixed
-- the top-level tables; this migration finishes the job for the remaining tables
-- pulled into that embed (and the action-items embed), which still had bare
-- auth.uid() re-evaluated per row (auth_rls_initplan) and, for several, a second
-- permissive SELECT policy (multiple_permissive_policies):
--   service_types, checklists, checklist_line_items, cleaner_availability_feedback,
--   cleaner_suggested_times, cleaner_suggested_windows, appointment_requested_slots,
--   appointment_routing_log, conversations.
--
-- Same proven transform as 074/075: one policy per (table, command) = exact OR of
-- the originals, auth.uid()/auth.jwt() wrapped in (select ...), role narrowed to
-- authenticated (every predicate already required a non-null uid; true anon
-- matched nothing before and matches nothing now). Helper functions untouched.
--
-- FOLLOW-UP (not in this pass; low-traffic / not on initial-load path): the
-- remaining advisor-flagged tables -- organizations, manager_permissions, reviews,
-- job_photos, invites, message_attachments, notification_events,
-- homeowner_payment_links, and the payment-detail tables (refunds, disputes,
-- payment_events, application_fees, webhook_events, ...) -- can get the same
-- treatment in a later migration to fully clear the performance advisor.

-- =====================================================================
-- SERVICE_TYPES
-- =====================================================================
DROP POLICY IF EXISTS "Admins and managers can delete service types" ON public.service_types;
DROP POLICY IF EXISTS "Admins and managers can create service types" ON public.service_types;
DROP POLICY IF EXISTS "Users can view service types in their organization" ON public.service_types;
DROP POLICY IF EXISTS "platform admin can read service_types" ON public.service_types;
DROP POLICY IF EXISTS "Admins and managers can update service types" ON public.service_types;

CREATE POLICY "service_types_select" ON public.service_types
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT om.organization_id FROM public.organization_members om WHERE om.user_id = (select auth.uid()))
    OR public.is_platform_admin((select auth.uid()))
  );
CREATE POLICY "service_types_insert" ON public.service_types
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = (select auth.uid()) AND om.organization_id = service_types.organization_id AND om.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role]))
  );
CREATE POLICY "service_types_update" ON public.service_types
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = (select auth.uid()) AND om.organization_id = service_types.organization_id AND om.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role]))
  );
CREATE POLICY "service_types_delete" ON public.service_types
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = (select auth.uid()) AND om.organization_id = service_types.organization_id AND om.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role]))
  );

-- =====================================================================
-- CHECKLISTS
-- =====================================================================
DROP POLICY IF EXISTS "Admins and managers can delete checklists" ON public.checklists;
DROP POLICY IF EXISTS "Admins and managers can create checklists" ON public.checklists;
DROP POLICY IF EXISTS "Users can view checklists in their organization" ON public.checklists;
DROP POLICY IF EXISTS "platform admin can read checklists" ON public.checklists;
DROP POLICY IF EXISTS "Admins and managers can update checklists" ON public.checklists;

CREATE POLICY "checklists_select" ON public.checklists
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.service_types st JOIN public.organization_members om ON om.organization_id = st.organization_id WHERE st.id = checklists.service_type_id AND om.user_id = (select auth.uid()))
    OR public.is_platform_admin((select auth.uid()))
  );
CREATE POLICY "checklists_insert" ON public.checklists
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.service_types st JOIN public.organization_members om ON om.organization_id = st.organization_id WHERE st.id = checklists.service_type_id AND om.user_id = (select auth.uid()) AND om.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role]))
  );
CREATE POLICY "checklists_update" ON public.checklists
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.service_types st JOIN public.organization_members om ON om.organization_id = st.organization_id WHERE st.id = checklists.service_type_id AND om.user_id = (select auth.uid()) AND om.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role]))
  );
CREATE POLICY "checklists_delete" ON public.checklists
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.service_types st JOIN public.organization_members om ON om.organization_id = st.organization_id WHERE st.id = checklists.service_type_id AND om.user_id = (select auth.uid()) AND om.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role]))
  );

-- =====================================================================
-- CHECKLIST_LINE_ITEMS
-- =====================================================================
DROP POLICY IF EXISTS "Admins and managers can delete checklist line items" ON public.checklist_line_items;
DROP POLICY IF EXISTS "Admins and managers can create checklist line items" ON public.checklist_line_items;
DROP POLICY IF EXISTS "Users can view checklist line items in their organization" ON public.checklist_line_items;
DROP POLICY IF EXISTS "Admins and managers can update checklist line items" ON public.checklist_line_items;

CREATE POLICY "checklist_line_items_select" ON public.checklist_line_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.checklists c JOIN public.service_types st ON st.id = c.service_type_id JOIN public.organization_members om ON om.organization_id = st.organization_id WHERE c.id = checklist_line_items.checklist_id AND om.user_id = (select auth.uid()))
  );
CREATE POLICY "checklist_line_items_insert" ON public.checklist_line_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.checklists c JOIN public.service_types st ON st.id = c.service_type_id JOIN public.organization_members om ON om.organization_id = st.organization_id WHERE c.id = checklist_line_items.checklist_id AND om.user_id = (select auth.uid()) AND om.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role]))
  );
CREATE POLICY "checklist_line_items_update" ON public.checklist_line_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.checklists c JOIN public.service_types st ON st.id = c.service_type_id JOIN public.organization_members om ON om.organization_id = st.organization_id WHERE c.id = checklist_line_items.checklist_id AND om.user_id = (select auth.uid()) AND om.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role]))
  );
CREATE POLICY "checklist_line_items_delete" ON public.checklist_line_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.checklists c JOIN public.service_types st ON st.id = c.service_type_id JOIN public.organization_members om ON om.organization_id = st.organization_id WHERE c.id = checklist_line_items.checklist_id AND om.user_id = (select auth.uid()) AND om.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role]))
  );

-- =====================================================================
-- CLEANER_AVAILABILITY_FEEDBACK
-- =====================================================================
DROP POLICY IF EXISTS "Cleaners can insert their own feedback" ON public.cleaner_availability_feedback;
DROP POLICY IF EXISTS "Cleaners can view their own feedback" ON public.cleaner_availability_feedback;
DROP POLICY IF EXISTS "platform admin can read cleaner_availability_feedback" ON public.cleaner_availability_feedback;

CREATE POLICY "cleaner_availability_feedback_select" ON public.cleaner_availability_feedback
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = cleaner_id
    OR public.is_platform_admin((select auth.uid()))
  );
CREATE POLICY "cleaner_availability_feedback_insert" ON public.cleaner_availability_feedback
  FOR INSERT TO authenticated
  WITH CHECK ( (select auth.uid()) = cleaner_id );

-- =====================================================================
-- CLEANER_SUGGESTED_TIMES
-- =====================================================================
DROP POLICY IF EXISTS "Users can insert suggested times for their feedback" ON public.cleaner_suggested_times;
DROP POLICY IF EXISTS "Users can view suggested times for their feedback" ON public.cleaner_suggested_times;

CREATE POLICY "cleaner_suggested_times_select" ON public.cleaner_suggested_times
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.cleaner_availability_feedback f WHERE f.id = cleaner_suggested_times.feedback_id AND f.cleaner_id = (select auth.uid()))
  );
CREATE POLICY "cleaner_suggested_times_insert" ON public.cleaner_suggested_times
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.cleaner_availability_feedback f WHERE f.id = cleaner_suggested_times.feedback_id AND f.cleaner_id = (select auth.uid()))
  );

-- =====================================================================
-- CLEANER_SUGGESTED_WINDOWS
-- =====================================================================
DROP POLICY IF EXISTS "Users can insert suggested windows for their feedback" ON public.cleaner_suggested_windows;
DROP POLICY IF EXISTS "Users can view suggested windows for their feedback" ON public.cleaner_suggested_windows;

CREATE POLICY "cleaner_suggested_windows_select" ON public.cleaner_suggested_windows
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.cleaner_availability_feedback f WHERE f.id = cleaner_suggested_windows.feedback_id AND f.cleaner_id = (select auth.uid()))
  );
CREATE POLICY "cleaner_suggested_windows_insert" ON public.cleaner_suggested_windows
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.cleaner_availability_feedback f WHERE f.id = cleaner_suggested_windows.feedback_id AND f.cleaner_id = (select auth.uid()))
  );

-- =====================================================================
-- APPOINTMENT_REQUESTED_SLOTS
--   The original "admins manage requested slots in their org" (FOR ALL) is
--   decomposed: its SELECT contribution is subsumed by the view predicate (which
--   already includes the is_admin_or_manager_in_org term), and its write
--   contribution becomes the insert/update/delete policies below.
-- =====================================================================
DROP POLICY IF EXISTS "admins manage requested slots in their org" ON public.appointment_requested_slots;
DROP POLICY IF EXISTS "platform admin can read appointment_requested_slots" ON public.appointment_requested_slots;
DROP POLICY IF EXISTS "view requested slots if can see parent appointment" ON public.appointment_requested_slots;

CREATE POLICY "appointment_requested_slots_select" ON public.appointment_requested_slots
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_requested_slots.appointment_id AND (a.homeowner_id = (select auth.uid()) OR a.cleaner_id = (select auth.uid()) OR (a.organization_id IS NOT NULL AND public.is_admin_or_manager_in_org(a.organization_id))))
    OR public.is_platform_admin((select auth.uid()))
  );
CREATE POLICY "appointment_requested_slots_insert" ON public.appointment_requested_slots
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_requested_slots.appointment_id AND a.organization_id IS NOT NULL AND public.is_admin_or_manager_in_org(a.organization_id))
  );
CREATE POLICY "appointment_requested_slots_update" ON public.appointment_requested_slots
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_requested_slots.appointment_id AND a.organization_id IS NOT NULL AND public.is_admin_or_manager_in_org(a.organization_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_requested_slots.appointment_id AND a.organization_id IS NOT NULL AND public.is_admin_or_manager_in_org(a.organization_id))
  );
CREATE POLICY "appointment_requested_slots_delete" ON public.appointment_requested_slots
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_requested_slots.appointment_id AND a.organization_id IS NOT NULL AND public.is_admin_or_manager_in_org(a.organization_id))
  );

-- =====================================================================
-- APPOINTMENT_ROUTING_LOG  (read-only via RLS)
-- =====================================================================
DROP POLICY IF EXISTS "view routing log if can see parent appointment" ON public.appointment_routing_log;

CREATE POLICY "appointment_routing_log_select" ON public.appointment_routing_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_routing_log.appointment_id AND (a.homeowner_id = (select auth.uid()) OR a.cleaner_id = (select auth.uid()) OR appointment_routing_log.cleaner_id = (select auth.uid()) OR (a.organization_id IS NOT NULL AND public.is_admin_or_manager_in_org(a.organization_id))))
  );

-- =====================================================================
-- CONVERSATIONS
-- =====================================================================
DROP POLICY IF EXISTS "Users can delete their own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can view their own conversations" ON public.conversations;
DROP POLICY IF EXISTS "platform admin can read conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can update their own conversations" ON public.conversations;

CREATE POLICY "conversations_select" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = participant_1_id
    OR (select auth.uid()) = participant_2_id
    OR public.is_platform_admin((select auth.uid()))
  );
CREATE POLICY "conversations_insert" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = participant_1_id OR (select auth.uid()) = participant_2_id
  );
CREATE POLICY "conversations_update" ON public.conversations
  FOR UPDATE TO authenticated
  USING (
    (select auth.uid()) = participant_1_id OR (select auth.uid()) = participant_2_id
  );
CREATE POLICY "conversations_delete" ON public.conversations
  FOR DELETE TO authenticated
  USING (
    (select auth.uid()) = participant_1_id OR (select auth.uid()) = participant_2_id
  );
