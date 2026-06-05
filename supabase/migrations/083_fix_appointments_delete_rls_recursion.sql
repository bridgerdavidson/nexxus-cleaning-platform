-- 083_fix_appointments_delete_rls_recursion.sql
--
-- Fix: "infinite recursion detected in policy for relation \"appointments\"" (SQLSTATE 42P17,
-- surfaced as a PostgREST 500) when DELETING an appointment from the client (anon key, RLS
-- enforced). It blocks EVERY admin/manager appointment delete, not just one.
--
-- Root cause: the same policy-cycle class that 078 fixed for INSERT, still present on DELETE.
--   * appointments_delete USING had an inline `EXISTS (SELECT 1 FROM organization_members om
--     WHERE om.organization_id = appointments.organization_id AND om.user_id = auth.uid()
--     AND om.role IN ('owner','admin','manager'))` — a direct, RLS-enforced subquery on
--     organization_members.
--   * Evaluating that subquery applies organization_members' own RLS (org_members_select), whose
--     expression transitively re-enters the appointments policy, which Postgres rejects as
--     infinite recursion.
--   appointments_select / appointments_update never hit this because they use the SECURITY DEFINER
--   helper is_admin_or_manager_in_org() (which bypasses RLS), not an inline subquery. DELETE was
--   the lone command still inlining it.
--
-- Fix: rewrite appointments_delete to use the recursion-safe checks the other commands already use
-- — the SECURITY DEFINER helper is_admin_or_manager_in_org() (org owner/admin/manager; identical
-- role set to the old inline check), plus the JWT app_metadata.role claim and the platform-admin
-- helper, so a global admin/manager (whose org-membership row may not be set) can delete exactly
-- what they can already SELECT/UPDATE. No policy referenced here re-enters appointments' RLS.
-- Homeowners/cleaners still cannot delete (no self path, matching the prior policy).
--
-- Idempotent (DROP POLICY IF EXISTS before CREATE). Additive, single transaction.

BEGIN;

DROP POLICY IF EXISTS appointments_delete ON public.appointments;

CREATE POLICY appointments_delete ON public.appointments
  FOR DELETE
  USING (
    ((organization_id IS NOT NULL) AND public.is_admin_or_manager_in_org(organization_id))
    OR ((((select auth.jwt()) -> 'app_metadata') ->> 'role') = ANY (ARRAY['admin', 'manager']))
    OR public.is_platform_admin((select auth.uid()))
  );

COMMIT;
