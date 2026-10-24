/*
# Import provenance tracking and source status preservation

## Purpose
Three preflight fixes before the first test import:
1. Store source STATUS from CSV separately in import records, not in the asset notes field
2. Track which asset types and attribute definitions were created by each import batch
3. Support rollback reporting of orphaned configuration items

## Modified Tables

### asset_import_records
  - Added `source_status` (text, nullable) — preserves the original STATUS column value
    from the source CSV. Previously this was being written into assets.notes, which should
    remain reserved for user-entered notes.

### asset_types
  - Added `created_by_import_batch_id` (uuid, nullable, FK → asset_import_batches ON DELETE SET NULL)
    — null means the type was created manually or pre-existed. Non-null links it to the
    import batch that first created it, enabling provenance tracking and orphan detection
    during rollback.

### asset_attribute_definitions
  - Added `created_by_import_batch_id` (uuid, nullable, FK → asset_import_batches ON DELETE SET NULL)
    — same provenance tracking as asset_types.

## Indexes
  - Partial indexes on both provenance columns (WHERE NOT NULL) for efficient orphan queries.

## Security
  - No policy changes. Existing RLS policies on asset_types and asset_attribute_definitions
    already cover these new columns.
*/

-- Fix 1: source_status on import records
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'asset_import_records'
      AND column_name = 'source_status'
  ) THEN
    ALTER TABLE asset_import_records ADD COLUMN source_status text;
  END IF;
END $$;

-- Fix 2: provenance tracking on asset_types
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'asset_types'
      AND column_name = 'created_by_import_batch_id'
  ) THEN
    ALTER TABLE asset_types
      ADD COLUMN created_by_import_batch_id uuid
      REFERENCES asset_import_batches(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_asset_types_import_batch
  ON asset_types(created_by_import_batch_id)
  WHERE created_by_import_batch_id IS NOT NULL;

-- Fix 2: provenance tracking on asset_attribute_definitions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'asset_attribute_definitions'
      AND column_name = 'created_by_import_batch_id'
  ) THEN
    ALTER TABLE asset_attribute_definitions
      ADD COLUMN created_by_import_batch_id uuid
      REFERENCES asset_import_batches(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_attr_defs_import_batch
  ON asset_attribute_definitions(created_by_import_batch_id)
  WHERE created_by_import_batch_id IS NOT NULL;
