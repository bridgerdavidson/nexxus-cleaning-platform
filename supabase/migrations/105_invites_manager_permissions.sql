-- 105_invites_manager_permissions.sql
--
-- Carry a manager's chosen fine-grained permissions on the invite so acceptance
-- persists exactly what the inviter selected (defaulting to the Standard manager
-- preset in the app), replacing the old accept-invite behavior of seeding every
-- flag true. NULL = "use the app default preset" for non-manager or legacy invites.

ALTER TABLE public.invites
  ADD COLUMN IF NOT EXISTS manager_permissions jsonb;

COMMENT ON COLUMN public.invites.manager_permissions IS
  'Chosen manager_permissions flags for a manager invite (jsonb map of flag->bool); NULL for non-manager invites.';
