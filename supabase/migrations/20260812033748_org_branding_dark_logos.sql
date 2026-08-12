-- Dark-mode logo variants for white-label org branding.
-- Optional per-asset: dark slots fall back to the light asset at render time.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS logo_icon_dark_url text,
  ADD COLUMN IF NOT EXISTS logo_full_dark_url text;
