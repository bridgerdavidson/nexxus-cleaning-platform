-- Migration: Create property-photos storage bucket and add photo_url to properties
-- Enables property owners and org admins/managers to upload one photo per property

-- ============================================================================
-- PART 1: Create property-photos storage bucket
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'property-photos',
  'property-photos',
  true,
  10485760, -- 10 MB per file
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- PART 2: Storage RLS policies
-- Path convention: properties/{propertyId}/{uuid}.jpg
-- ============================================================================

-- Property owner or org admin/manager can upload (same org as owner)
CREATE POLICY "Property owner or org member can upload property photo"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'property-photos'
    AND EXISTS (
      SELECT 1
      FROM properties p
      JOIN organization_members om_owner ON om_owner.user_id = p.owner_id
      JOIN organization_members om_actor ON om_actor.organization_id = om_owner.organization_id
        AND om_actor.user_id = auth.uid()
      WHERE p.id = (split_part(name, '/', 2))::uuid
    )
  );

-- Public read
CREATE POLICY "Anyone can view property photos"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'property-photos');

-- Property owner or org member can delete
CREATE POLICY "Property owner or org member can delete property photo"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'property-photos'
    AND EXISTS (
      SELECT 1
      FROM properties p
      JOIN organization_members om_owner ON om_owner.user_id = p.owner_id
      JOIN organization_members om_actor ON om_actor.organization_id = om_owner.organization_id
        AND om_actor.user_id = auth.uid()
      WHERE p.id = (split_part(name, '/', 2))::uuid
    )
  );

-- ============================================================================
-- PART 3: Add photo_url to properties table
-- ============================================================================

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS photo_url text;

COMMENT ON COLUMN properties.photo_url IS 'Optional primary photo URL for the property (stored in property-photos bucket)';
