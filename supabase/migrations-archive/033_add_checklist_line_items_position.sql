-- Migration: Add position column to checklist_line_items for drag-and-drop reordering
-- This allows users to customize the order of checklist items

-- ============================================================================
-- PART 1: Add position column
-- ============================================================================

ALTER TABLE checklist_line_items ADD COLUMN position INTEGER;

-- ============================================================================
-- PART 2: Backfill position from created_at order
-- Set position based on created_at order within each checklist (0-indexed)
-- ============================================================================

WITH ordered_items AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (PARTITION BY checklist_id ORDER BY created_at) - 1 AS calculated_position
  FROM checklist_line_items
)
UPDATE checklist_line_items
SET position = ordered_items.calculated_position
FROM ordered_items
WHERE checklist_line_items.id = ordered_items.id;

-- ============================================================================
-- PART 3: Create index for performance
-- ============================================================================

CREATE INDEX idx_checklist_line_items_position ON checklist_line_items(checklist_id, position);

-- ============================================================================
-- PART 4: Add comment for documentation
-- ============================================================================

COMMENT ON COLUMN checklist_line_items.position IS 'Sort order within the checklist (0-indexed). NULL values sort last, then by created_at.';
