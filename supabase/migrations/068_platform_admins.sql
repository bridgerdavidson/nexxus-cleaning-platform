-- ═════════════════════════════════════════════════════════════════════════════
-- 068_platform_admins — platform-owner (Nexxus staff) identity
-- ─────────────────────────────────────────────────────────────────────────────
-- A platform admin sits ABOVE all tenants: they provision new organizations and
-- oversee every tenant from the /owner back-office. This is deliberately NOT a
-- flag on user_profiles — org admins/managers can already UPDATE user_profiles
-- rows in their org, so a flag there would be a privilege-escalation path. Keep
-- platform identity in a table only the service role can touch (same posture as
-- webhook_events: RLS on, no policies).
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS enabled with NO policies: only the service role (which bypasses RLS) can
-- read/write. Authenticated clients get nothing — platform-admin status is
-- resolved server-side via requirePlatformAdmin / /api/platform/whoami.
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- is_platform_admin(uid) — SECURITY DEFINER predicate (bypasses RLS) for reuse
-- in RLS policies (see 069 impersonation) and anywhere a SQL-level check is
-- handier than a service-role round trip. Mirrors is_admin_or_manager_in_org.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_platform_admin(uid uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = uid
    );
  $$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed the founding platform admin idempotently by email. Inserts zero rows if
-- the auth user doesn't exist yet in this environment (no error). If it wasn't
-- present at migrate time, run the same INSERT once manually — see BASELINE.md.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.platform_admins (user_id)
SELECT id FROM auth.users WHERE email = 'mvbdavidson@gmail.com'
ON CONFLICT (user_id) DO NOTHING;
