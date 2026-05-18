-- Backfill auth.users.raw_app_meta_data.role from public.user_profiles.role
-- so the AuthContext fallback path (which reads app_metadata.role || user_metadata.role
-- || 'homeowner') stops downgrading invited users to homeowner whenever a
-- transient user_profiles SELECT fails. Invited users are created via
-- auth.admin.inviteUserByEmail with no metadata, and accept-invite previously
-- only wrote to user_profiles — leaving auth metadata permanently empty.
--
-- Idempotent: only updates rows where app_metadata.role differs from the
-- canonical user_profiles.role.

UPDATE auth.users u
SET raw_app_meta_data = jsonb_set(
  COALESCE(u.raw_app_meta_data, '{}'::jsonb),
  '{role}',
  to_jsonb(up.role::text)
)
FROM public.user_profiles up
WHERE up.id = u.id
  AND up.role IS NOT NULL
  AND (u.raw_app_meta_data->>'role') IS DISTINCT FROM up.role;
