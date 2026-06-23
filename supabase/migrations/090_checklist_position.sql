-- 090_checklist_position.sql
-- Make checklists (service tiers) drag-reorderable, like checklist_line_items.
-- Nullable so the convention matches line items (NULL sorts last); backfilled
-- deterministically by name within each service so existing data has a stable order.

ALTER TABLE checklists ADD COLUMN IF NOT EXISTS position integer;

WITH ordered AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY service_type_id ORDER BY name ASC, created_at ASC) - 1 AS pos
  FROM checklists
)
UPDATE checklists c
SET position = ordered.pos
FROM ordered
WHERE c.id = ordered.id
  AND c.position IS NULL;

COMMENT ON COLUMN checklists.position IS
  '0-indexed display order of this checklist (tier) within its service; NULL sorts last (matches checklist_line_items.position).';
