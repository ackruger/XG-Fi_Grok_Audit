/*
# Add notes column to assets table

## Overview
Adds a free-text `notes` column to the `assets` table so users can write 
notes/descriptions when creating or editing an asset.

## Modified Tables
- `assets`
  - New column: `notes` (text, default empty string)

## Notes
- This is a simple text field on the asset record itself, separate from the
  `asset_notes` table which stores multiple timestamped notes per asset.
- No security changes needed; existing RLS policies on `assets` already cover this column.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assets' AND column_name = 'notes'
  ) THEN
    ALTER TABLE assets ADD COLUMN notes text DEFAULT '';
  END IF;
END $$;
