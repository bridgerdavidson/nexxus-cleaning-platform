-- Setup-checklist "Add your logo and brand color" step is VISIT-driven: opening
-- the branding settings section checks it off (some orgs deliberately keep the
-- default look). First visit only; later visits never move the timestamp.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS branding_visited_at timestamptz;
