/*
# Convert Asset Types to Organization Ownership

1. Changes to `asset_types`
   - DROP old project-based RLS policies on asset_types and asset_attribute_definitions
   - ADD `organization_id` (uuid, FK → organizations, NOT NULL)
   - DROP `project_id` column
   - DROP old unique constraint (project_id, name)
   - ADD new unique constraint (organization_id, name)

2. Notes
   - Asset Types are organization-level: reusable across all facilities.
   - Attribute Definitions remain attached to Asset Types (no column change needed).
   - Table is empty (cleared in migration 035), so NOT NULL is safe.
   - New RLS policies for these tables will be added in migration 039.
*/

-- Drop old project-based RLS policies on asset_types
DROP POLICY IF EXISTS "asset_types_select" ON asset_types;
DROP POLICY IF EXISTS "asset_types_insert" ON asset_types;
DROP POLICY IF EXISTS "asset_types_update" ON asset_types;
DROP POLICY IF EXISTS "asset_types_delete" ON asset_types;

-- Drop old project-based RLS policies on asset_attribute_definitions
DROP POLICY IF EXISTS "attr_defs_select" ON asset_attribute_definitions;
DROP POLICY IF EXISTS "attr_defs_insert" ON asset_attribute_definitions;
DROP POLICY IF EXISTS "attr_defs_update" ON asset_attribute_definitions;
DROP POLICY IF EXISTS "attr_defs_delete" ON asset_attribute_definitions;

-- Add organization_id column
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'asset_types' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE asset_types ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Table is empty, safe to set NOT NULL
ALTER TABLE asset_types ALTER COLUMN organization_id SET NOT NULL;

-- Drop old unique constraint on (project_id, name) if it exists
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'asset_types'::regclass AND conname = 'asset_types_project_id_name_key'
  ) THEN
    ALTER TABLE asset_types DROP CONSTRAINT asset_types_project_id_name_key;
  END IF;
END $$;

-- Drop project_id column
ALTER TABLE asset_types DROP COLUMN IF EXISTS project_id;

-- Add new unique constraint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'asset_types'::regclass AND conname = 'asset_types_organization_id_name_key'
  ) THEN
    ALTER TABLE asset_types ADD CONSTRAINT asset_types_organization_id_name_key UNIQUE (organization_id, name);
  END IF;
END $$;
