-- ═════════════════════════════════════════════════════════════════════════════
-- 070_platform_admin_impersonation_more_tables — widen "View as" reads
-- ─────────────────────────────────────────────────────────────────────────────
-- 069 granted platform admins SELECT on the core org tables, but the dashboards
-- embed a few more (e.g. useAdminData joins user_profiles for customer/cleaner
-- names, checklists, cleaner_availability_feedback, and appointment_requested_slots).
-- Without these, an impersonated dashboard renders with blank names / missing
-- checklist + request details. Same additive, SELECT-only, is_platform_admin()
-- predicate as 069 (writes untouched -> read-only). Done as a new migration
-- because 069 has already shipped to dev.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  policy_name text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_profiles', 'checklists', 'cleaner_availability_feedback',
    'appointment_requested_slots'
  ]
  LOOP
    policy_name := 'platform admin can read ' || t;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()))',
      policy_name, t
    );
  END LOOP;
END $$;
