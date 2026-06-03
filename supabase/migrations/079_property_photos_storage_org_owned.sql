-- 079_property_photos_storage_org_owned.sql
--
-- Fix: uploading a photo for an ORG-OWNED property (owner_id IS NULL) silently fails, so the new
-- property shows the placeholder icon instead of the photo.
--
-- Root cause: the `property-photos` storage.objects RLS (originally migration 054) authorizes an
-- upload only when the target property's owner is the actor or an org member of the OWNER:
--     p.owner_id = auth.uid()
--     OR EXISTS (org_members om_owner JOIN om_actor ... WHERE om_owner.user_id = p.owner_id ...)
-- For an org-owned property owner_id IS NULL, so both branches are false and the client-direct
-- upload is denied (the modal swallows the error as non-fatal -> no photo). The properties-table
-- photo_url UPDATE already works for org-owned rows (migration 077's org-membership branch), so the
-- storage policy was the only blocker.
--
-- Fix: add an org-owned branch to each property-photos storage policy (INSERT/UPDATE/DELETE) so an
-- org owner/admin/manager in the property's OWN organization can manage photos for a property with
-- no homeowner, mirroring the 077 properties RLS. Idempotent (DROP ... IF EXISTS before CREATE).
--
-- Note: storage.objects policies live in the `storage` schema (not captured by the public-only
-- baseline dump), so these are re-created here; the path layout is `properties/<propertyId>/<uuid>`,
-- hence split_part(name,'/',2) is the property id.

BEGIN;

DROP POLICY IF EXISTS "Property owner or org admin/manager can upload property photo" ON storage.objects;
DROP POLICY IF EXISTS "Property owner or org admin/manager can update property photo" ON storage.objects;
DROP POLICY IF EXISTS "Property owner or org admin/manager can delete property photo" ON storage.objects;
-- legacy names from migration 039, in case they still exist on an environment
DROP POLICY IF EXISTS "Property owner or org member can upload property photo" ON storage.objects;
DROP POLICY IF EXISTS "Property owner or org member can delete property photo" ON storage.objects;

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
          OR (
            p.owner_id IS NULL
            AND EXISTS (
              SELECT 1
              FROM organization_members om_self
              WHERE om_self.user_id = auth.uid()
                AND om_self.organization_id = p.organization_id
                AND om_self.role IN ('owner', 'admin', 'manager')
            )
          )
        )
    )
  );

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
          OR (
            p.owner_id IS NULL
            AND EXISTS (
              SELECT 1
              FROM organization_members om_self
              WHERE om_self.user_id = auth.uid()
                AND om_self.organization_id = p.organization_id
                AND om_self.role IN ('owner', 'admin', 'manager')
            )
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
          OR (
            p.owner_id IS NULL
            AND EXISTS (
              SELECT 1
              FROM organization_members om_self
              WHERE om_self.user_id = auth.uid()
                AND om_self.organization_id = p.organization_id
                AND om_self.role IN ('owner', 'admin', 'manager')
            )
          )
        )
    )
  );

COMMIT;
