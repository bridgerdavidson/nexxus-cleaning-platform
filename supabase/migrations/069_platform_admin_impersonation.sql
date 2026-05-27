-- ═════════════════════════════════════════════════════════════════════════════
-- 069_platform_admin_impersonation — "View as this company" (read-only) + audit
-- ─────────────────────────────────────────────────────────────────────────────
-- A platform admin can drop INTO a tenant's dashboard to help/debug. The tenant
-- dashboards read data CLIENT-SIDE under RLS, and a platform admin is not a
-- member of the org — so we grant a global, ADDITIVE, SELECT-ONLY read on the
-- core org-scoped tables, gated by is_platform_admin() (068). Writes are NOT
-- granted: impersonation is read-only in v1, so the existing per-org write
-- policies still fully constrain everyone (incl. platform admins). auth.uid()
-- stays the platform admin throughout, so attribution/audit is honest.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  policy_name text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'appointments', 'payments', 'payouts', 'properties', 'service_types',
    'cleaner_profiles', 'invoices', 'messages', 'conversations',
    'organization_members', 'organizations', 'manager_permissions', 'invites',
    'job_photos', 'reviews'
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

-- ─────────────────────────────────────────────────────────────────────────────
-- platform_audit_log — append-only trail of platform-admin actions
-- (impersonation_start / impersonation_end / provision_tenant). RLS on, no
-- policies: service-role only (same posture as platform_admins / webhook_events).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  action        text NOT NULL,
  target_org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz
);
CREATE INDEX IF NOT EXISTS platform_audit_log_actor_idx ON public.platform_audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS platform_audit_log_org_idx ON public.platform_audit_log (target_org_id);

ALTER TABLE public.platform_audit_log ENABLE ROW LEVEL SECURITY;
