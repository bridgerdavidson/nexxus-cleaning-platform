-- Migration: Tighten property-photos storage RLS to match canEditProperty()
--
-- The original policy in 039 allowed ANY org member (including cleaners) to
-- upload/delete property photos. The server route at
-- src/app/api/properties/[propertyId]/upload-photo/route.ts enforced a
-- stricter check: only the property owner OR an org admin/manager could edit.
--
-- With client-direct uploads we lean on storage RLS for the authorization
-- check, so the RLS must match the historical app-level check.

DROP POLICY IF EXISTS "Property owner or org member can upload property photo" ON storage.objects;
DROP POLICY IF EXISTS "Property owner or org member can delete property photo" ON storage.objects;

-- Property owner OR org admin/manager (in same org as owner) can upload
CREATE POLICY "Property owner or org admin/manager can upload property photo"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'property-photos'
    AND EXISTS (
      SELECT 1
      FROM properties p
      WHERE p.id = (split_part(storage.objects.name, '/', 2))::uuid
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM organization_members om_owner
            JOIN organization_members om_actor
              ON om_actor.organization_id = om_owner.organization_id
            WHERE om_owner.user_id = p.owner_id
              AND om_actor.user_id = auth.uid()
              AND om_actor.role IN ('owner', 'admin', 'manager')
          )
        )
    )
  );

-- Same check on UPDATE (Supabase Storage uses UPDATE under the hood for upsert flows)
CREATE POLICY "Property owner or org admin/manager can update property photo"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'property-photos'
    AND EXISTS (
      SELECT 1
      FROM properties p
      WHERE p.id = (split_part(storage.objects.name, '/', 2))::uuid
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM organization_members om_owner
            JOIN organization_members om_actor
              ON om_actor.organization_id = om_owner.organization_id
            WHERE om_owner.user_id = p.owner_id
              AND om_actor.user_id = auth.uid()
              AND om_actor.role IN ('owner', 'admin', 'manager')
          )
        )
    )
  );

CREATE POLICY "Property owner or org admin/manager can delete property photo"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'property-photos'
    AND EXISTS (
      SELECT 1
      FROM properties p
      WHERE p.id = (split_part(storage.objects.name, '/', 2))::uuid
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM organization_members om_owner
            JOIN organization_members om_actor
              ON om_actor.organization_id = om_owner.organization_id
            WHERE om_owner.user_id = p.owner_id
              AND om_actor.user_id = auth.uid()
              AND om_actor.role IN ('owner', 'admin', 'manager')
          )
        )
    )
  );

-- Also tighten the properties table RLS so client-direct UPDATE of photo_url
-- enforces the same rule. Existing policies (if any) on properties.UPDATE
-- might already cover this; this policy is additive and OR-ed with others.
DROP POLICY IF EXISTS "Property owner or org admin/manager can update property photo_url" ON properties;
CREATE POLICY "Property owner or org admin/manager can update property photo_url"
  ON properties
  FOR UPDATE
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM organization_members om_owner
      JOIN organization_members om_actor
        ON om_actor.organization_id = om_owner.organization_id
      WHERE om_owner.user_id = properties.owner_id
        AND om_actor.user_id = auth.uid()
        AND om_actor.role IN ('owner', 'admin', 'manager')
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM organization_members om_owner
      JOIN organization_members om_actor
        ON om_actor.organization_id = om_owner.organization_id
      WHERE om_owner.user_id = properties.owner_id
        AND om_actor.user_id = auth.uid()
        AND om_actor.role IN ('owner', 'admin', 'manager')
    )
  );
