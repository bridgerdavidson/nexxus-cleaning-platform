-- Migration 095: Active-job photo gate + checklist item completions
-- Adds:
--   organizations.require_job_photos      boolean, default true
--   appointments.photos_skipped           boolean, default false
--   appointments.photo_skip_reason        text, nullable
--   checklist_item_completions            table with RLS

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS require_job_photos boolean NOT NULL DEFAULT true;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS photos_skipped boolean NOT NULL DEFAULT false;
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS photo_skip_reason text;

CREATE TABLE IF NOT EXISTS checklist_item_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  checklist_line_item_id uuid NOT NULL REFERENCES checklist_line_items(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, checklist_line_item_id)
);
CREATE INDEX IF NOT EXISTS idx_cic_appointment ON checklist_item_completions(appointment_id);

ALTER TABLE checklist_item_completions ENABLE ROW LEVEL SECURITY;

-- Assigned cleaner: full control of their own appointment's rows.
DROP POLICY IF EXISTS cic_cleaner_rw ON checklist_item_completions;
CREATE POLICY cic_cleaner_rw ON checklist_item_completions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM appointments a
                 WHERE a.id = checklist_item_completions.appointment_id
                   AND a.cleaner_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM appointments a
                 WHERE a.id = checklist_item_completions.appointment_id
                   AND a.cleaner_id = (select auth.uid())));

-- Org staff (owner/admin/manager): read for their org.
DROP POLICY IF EXISTS cic_org_read ON checklist_item_completions;
CREATE POLICY cic_org_read ON checklist_item_completions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.organization_members m
                 WHERE m.organization_id = checklist_item_completions.organization_id
                   AND m.user_id = (select auth.uid())
                   AND m.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])));
