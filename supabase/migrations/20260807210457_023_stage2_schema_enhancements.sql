/*
# Stage 2 Schema Enhancements

## Overview
Adds columns to support the Stage 2 UI: asset type management (code, sort
order, active flag), expanded attribute data types (multiline, url), searchable
flag on attribute definitions, and document description/external-link support.

## Modified Tables

### asset_types
- `code` (text, default '') — short type code (e.g. "AHU", "PUMP")
- `sort_order` (integer, default 0) — display ordering
- `is_active` (boolean, default true) — soft-deactivate instead of delete

### asset_attribute_definitions
- `is_searchable` (boolean, default false) — whether this attribute should be included in search results
- Expands data_type CHECK constraint to include 'multiline' and 'url'

### asset_documents
- `description` (text, default '') — optional description or notes about the document
- `external_url` (text) — for external links (documents not uploaded to storage)

## Notes
- CHECK constraint on data_type is dropped and recreated to add new values.
  Existing rows with text/number/boolean/date/select remain valid.
- No RLS changes — existing policies cover the new columns.
*/

-- asset_types enhancements
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'asset_types' AND column_name = 'code'
  ) THEN
    ALTER TABLE asset_types ADD COLUMN code text NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'asset_types' AND column_name = 'sort_order'
  ) THEN
    ALTER TABLE asset_types ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'asset_types' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE asset_types ADD COLUMN is_active boolean NOT NULL DEFAULT true;
  END IF;
END $$;

-- asset_attribute_definitions enhancements
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'asset_attribute_definitions' AND column_name = 'is_searchable'
  ) THEN
    ALTER TABLE asset_attribute_definitions ADD COLUMN is_searchable boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Expand data_type CHECK to include multiline and url
ALTER TABLE asset_attribute_definitions DROP CONSTRAINT IF EXISTS asset_attribute_definitions_data_type_check;
ALTER TABLE asset_attribute_definitions ADD CONSTRAINT asset_attribute_definitions_data_type_check
  CHECK (data_type IN ('text', 'multiline', 'number', 'boolean', 'date', 'select', 'url'));

-- asset_documents enhancements
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'asset_documents' AND column_name = 'description'
  ) THEN
    ALTER TABLE asset_documents ADD COLUMN description text NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'asset_documents' AND column_name = 'external_url'
  ) THEN
    ALTER TABLE asset_documents ADD COLUMN external_url text;
  END IF;
END $$;

-- Make storage_path nullable for external-link documents
ALTER TABLE asset_documents ALTER COLUMN storage_path DROP NOT NULL;
