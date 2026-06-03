-- 078_fix_appointments_insert_rls_recursion.sql
--
-- Fix: "infinite recursion detected in policy for relation \"appointments\"" when inserting an
-- appointment from the client (anon key, RLS enforced). Surfaced by the org self-pay booking
-- (homeowner_id IS NULL), but it affects ANY client-side appointment insert where the actor is not
-- the homeowner (e.g. an admin/manager booking on someone's behalf).
--
-- Root cause: a policy cycle between two tables.
--   * appointments_insert WITH CHECK had `EXISTS (SELECT 1 FROM user_profiles up WHERE up.id =
--     auth.uid() AND up.role IN ('admin','manager'))` — a direct, RLS-enforced subquery on
--     user_profiles.
--   * user_profiles_select in turn has a branch `EXISTS (SELECT 1 FROM appointments WHERE
--     appointments.homeowner_id = user_profiles.id AND appointments.cleaner_id = auth.uid())`.
--   Evaluating the appointments INSERT policy therefore re-enters the appointments policy
--   (appointments_insert -> user_profiles_select -> appointments), which Postgres rejects as
--   infinite recursion. The self-pay path always hits it because `auth.uid() = homeowner_id` is
--   false when homeowner_id is NULL, so the user_profiles branch is always evaluated.
--
-- Fix: stop subquerying user_profiles from the insert policy. Mirror the recursion-safe checks that
-- appointments_select / appointments_update already use — the SECURITY DEFINER helper
-- is_admin_or_manager_in_org() (bypasses RLS) plus the JWT app_metadata.role claim — so the policy
-- no longer references any table whose own policy references appointments. This is at least as
-- permissive as before: org owners/admins/managers and global admins/managers can insert, the
-- homeowner can insert their own, and platform admins are covered.
--
-- Idempotent (DROP POLICY IF EXISTS before CREATE). Additive, single transaction.

BEGIN;

DROP POLICY IF EXISTS appointments_insert ON public.appointments;

CREATE POLICY appointments_insert ON public.appointments
  FOR INSERT
  WITH CHECK (
    ((select auth.uid()) = homeowner_id)
    OR ((organization_id IS NOT NULL) AND public.is_admin_or_manager_in_org(organization_id))
    OR ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = ANY (ARRAY['admin', 'manager']))
    OR public.is_platform_admin((select auth.uid()))
  );

COMMIT;
