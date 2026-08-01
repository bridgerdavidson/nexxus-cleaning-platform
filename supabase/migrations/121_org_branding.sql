-- 121_org_branding.sql
--
-- White-label Phase 0 (docs/white-label-branding.md): per-org brand color and logos.
--
-- Two logo slots, not one: the operator rail shows a square-ish icon when collapsed and a
-- full lockup when expanded. Deriving both from a single upload is what breaks for tenants
-- whose logo is a wordmark, a stacked lockup, or a circular badge (decision 1).
-- Both are nullable: no logo falls back to an initials monogram, no color falls back to the
-- Nexxus brand.

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS brand_color text,
  ADD COLUMN IF NOT EXISTS logo_icon_url text,
  ADD COLUMN IF NOT EXISTS logo_full_url text,
  ADD COLUMN IF NOT EXISTS brand_updated_at timestamptz;

-- Reject anything that is not a 6-digit hex so a bad write can never reach the palette
-- module (which falls back silently and would hide the bug).
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_brand_color_hex;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_brand_color_hex
  CHECK (brand_color IS NULL OR brand_color ~* '^#[0-9a-f]{6}$');

-- Public bucket: logos are also embedded in transactional email, where a signed URL would
-- expire before the recipient opens the message.
-- PNG/WebP only, enforced server-side: SVG in public storage is an XSS vector when navigated
-- to directly (docs/white-label-branding.md), and client-side validation alone would not stop
-- a direct-upload of arbitrary content served from our storage origin.
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES ('org-branding', 'org-branding', true, ARRAY['image/png', 'image/webp'], 2097152)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      allowed_mime_types = ARRAY['image/png', 'image/webp'],
      file_size_limit = 2097152;

-- Path layout is `<orgId>/<icon|full>-<uuid>.<ext>`, so split_part(name,'/',1) is the org id.
-- Mirrors the property-photos policies (migrations 054/077/079).
DROP POLICY IF EXISTS "Org owner or admin can upload org branding" ON storage.objects;
CREATE POLICY "Org owner or admin can upload org branding"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'org-branding'
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = split_part(storage.objects.name, '/', 1)
        AND om.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Org owner or admin can update org branding" ON storage.objects;
CREATE POLICY "Org owner or admin can update org branding"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'org-branding'
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = split_part(storage.objects.name, '/', 1)
        AND om.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Org owner or admin can delete org branding" ON storage.objects;
CREATE POLICY "Org owner or admin can delete org branding"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'org-branding'
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = split_part(storage.objects.name, '/', 1)
        AND om.role IN ('owner', 'admin')
    )
  );

-- Deliberately NO SELECT policy: public reads ride on storage.buckets.public = true, which
-- serves individual objects via /storage/v1/object/public/ without consulting RLS. A SELECT
-- policy would additionally grant the anonymous LIST API (enumerating every org's uploads),
-- which nothing needs. Matches the property-photos precedent (no SELECT policy there either).

COMMIT;
