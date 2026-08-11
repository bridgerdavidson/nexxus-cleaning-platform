-- Drop organizations.logo_url.
--
-- The column predates the white-label branding system (migration 121:
-- brand_color, logo_icon_url, logo_full_url, brand_updated_at) and was never
-- rendered anywhere. PR #236 removed the last app-side references (the
-- Organization settings section and the AuthContext org selects), so nothing
-- reads or writes it anymore. No views, policies, indexes, or functions
-- depend on it.
--
-- Must ship after #236 is deployed: older builds select logo_url in
-- AuthContext and would fail their org loads once the column is gone.

ALTER TABLE public.organizations DROP COLUMN IF EXISTS logo_url;
