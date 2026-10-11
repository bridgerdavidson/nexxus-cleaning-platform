-- Task 13 (PR F): homeowner-blocked message needs a route around the block (ruling R18).
-- organizations has no phone column; the one at user_profiles.phone is a named individual's
-- personal number and is not surfaced to that person's customers without asking. This is a
-- separate, explicitly public field the owner opts into filling in.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS contact_phone text;

COMMENT ON COLUMN public.organizations.contact_phone IS
  'Public contact number shown to homeowners when online booking is unavailable. Optional.';
