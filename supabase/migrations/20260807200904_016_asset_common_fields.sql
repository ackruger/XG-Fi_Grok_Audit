/*
# Add common fields to assets table

## Overview
Adds structured common fields to the assets table to support the asset type
system and additional source/design metadata. The existing equipment_type text
field is preserved for backward compatibility and will be kept in sync with
the asset_type relationship.

## Modified Tables
- `assets`
  - `asset_type_id` (uuid, FK to asset_types, nullable) — structured type reference
  - `design_stage` (text, nullable) — current design/construction phase
  - `area_served` (text, default '') — physical area or zone the asset serves
  - `source_section` (text, default '') — original spreadsheet section for import traceability
  - `source_row` (integer, nullable) — original spreadsheet row number for import traceability
  - `notes` column already exists from initial schema

## Indexes
- Index on asset_type_id for type-based queries and joins

## Security
- No RLS changes — assets table already has appropriate policies.

## Notes
- asset_type_id is nullable so existing assets without a type continue to work.
- source_section and source_row are import metadata — they record where data
  came from but do not determine the asset type.
- manufacturer, model, serial_number remain as common asset fields on the
  assets table (not moved to dynamic attributes).
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = 'asset_type_id'
  ) THEN
    ALTER TABLE assets ADD COLUMN asset_type_id uuid REFERENCES asset_types(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = 'design_stage'
  ) THEN
    ALTER TABLE assets ADD COLUMN design_stage text DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = 'area_served'
  ) THEN
    ALTER TABLE assets ADD COLUMN area_served text DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = 'source_section'
  ) THEN
    ALTER TABLE assets ADD COLUMN source_section text DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = 'source_row'
  ) THEN
    ALTER TABLE assets ADD COLUMN source_row integer;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assets_asset_type_id ON assets(asset_type_id);
