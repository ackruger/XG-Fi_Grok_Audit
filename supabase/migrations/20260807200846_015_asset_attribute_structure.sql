/*
# Create asset_attribute_definitions and asset_design_profiles

## Overview
Creates the flexible attribute system for asset types. Each asset type can have
any number of attribute definitions that describe its technical, service, and
electrical/controls fields. Design profiles allow a single physical asset to
carry multiple performance datasets (e.g. cooling and heating profiles for
changeover coils).

## New Tables

1. `asset_attribute_definitions`
   - `id` (uuid, PK) — unique identifier
   - `asset_type_id` (uuid, FK to asset_types) — which type this attribute belongs to
   - `name` (text, NOT NULL) — internal/canonical name (e.g. "supply_air_cfm")
   - `display_name` (text, NOT NULL) — user-facing label (e.g. "Supply Air CFM")
   - `app_section` (text, NOT NULL) — which detail tab: technical, service, electrical_controls
   - `data_type` (text, NOT NULL) — text, number, boolean, date, select
   - `unit` (text) — unit of measurement (e.g. "CFM", "GPM", "kW")
   - `options` (jsonb) — for select-type: array of allowed values
   - `sort_order` (integer) — display ordering within the section
   - `is_required` (boolean) — whether the field is required
   - `source_column` (text) — original spreadsheet column letter, for import mapping
   - `source_header` (text) — original spreadsheet header text
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

2. `asset_design_profiles`
   - `id` (uuid, PK) — unique identifier
   - `asset_id` (uuid, FK to assets) — which physical asset
   - `name` (text, NOT NULL) — profile name (e.g. "Cooling Performance", "Heating Performance")
   - `source_section` (text) — original spreadsheet section name for import traceability
   - `sort_order` (integer) — display ordering
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

## Indexes
- Unique on (asset_type_id, name) for attribute_definitions to prevent duplicate attribute names per type
- Index on asset_type_id for definition lookups
- Index on asset_id for profile lookups
- Unique on (asset_id, name) for profiles to prevent duplicate profile names per asset

## Security
- RLS enabled on both tables.
- Attribute definitions: follow asset_types permissions (project membership for read,
  admin/supervisor for write) via join through asset_types → projects → project_members.
- Design profiles: follow assets permissions (project membership for read,
  contributor+ for write) via join through assets → projects → project_members.
*/

-- Attribute definitions (per asset type)
CREATE TABLE IF NOT EXISTS asset_attribute_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type_id uuid NOT NULL REFERENCES asset_types(id) ON DELETE CASCADE,
  name text NOT NULL,
  display_name text NOT NULL,
  app_section text NOT NULL DEFAULT 'technical' CHECK (app_section IN ('technical', 'service', 'electrical_controls')),
  data_type text NOT NULL DEFAULT 'text' CHECK (data_type IN ('text', 'number', 'boolean', 'date', 'select')),
  unit text DEFAULT '',
  options jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT false,
  source_column text DEFAULT '',
  source_header text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(asset_type_id, name)
);

ALTER TABLE asset_attribute_definitions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_attr_defs_type_id ON asset_attribute_definitions(asset_type_id);
CREATE INDEX IF NOT EXISTS idx_attr_defs_section ON asset_attribute_definitions(app_section);

DROP POLICY IF EXISTS "attr_defs_select" ON asset_attribute_definitions;
CREATE POLICY "attr_defs_select" ON asset_attribute_definitions FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM asset_types
      JOIN project_members ON project_members.project_id = asset_types.project_id
      WHERE asset_types.id = asset_attribute_definitions.asset_type_id
      AND project_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "attr_defs_insert" ON asset_attribute_definitions;
CREATE POLICY "attr_defs_insert" ON asset_attribute_definitions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM asset_types
      JOIN project_members ON project_members.project_id = asset_types.project_id
      WHERE asset_types.id = asset_attribute_definitions.asset_type_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "attr_defs_update" ON asset_attribute_definitions;
CREATE POLICY "attr_defs_update" ON asset_attribute_definitions FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM asset_types
      JOIN project_members ON project_members.project_id = asset_types.project_id
      WHERE asset_types.id = asset_attribute_definitions.asset_type_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('supervisor', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM asset_types
      JOIN project_members ON project_members.project_id = asset_types.project_id
      WHERE asset_types.id = asset_attribute_definitions.asset_type_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "attr_defs_delete" ON asset_attribute_definitions;
CREATE POLICY "attr_defs_delete" ON asset_attribute_definitions FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM asset_types
      JOIN project_members ON project_members.project_id = asset_types.project_id
      WHERE asset_types.id = asset_attribute_definitions.asset_type_id
      AND project_members.user_id = auth.uid()
      AND project_members.role = 'admin'
    )
  );

-- Design profiles (per physical asset)
CREATE TABLE IF NOT EXISTS asset_design_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  name text NOT NULL,
  source_section text DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(asset_id, name)
);

ALTER TABLE asset_design_profiles ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_design_profiles_asset_id ON asset_design_profiles(asset_id);

DROP POLICY IF EXISTS "design_profiles_select" ON asset_design_profiles;
CREATE POLICY "design_profiles_select" ON asset_design_profiles FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_design_profiles.asset_id
      AND project_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "design_profiles_insert" ON asset_design_profiles;
CREATE POLICY "design_profiles_insert" ON asset_design_profiles FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_design_profiles.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "design_profiles_update" ON asset_design_profiles;
CREATE POLICY "design_profiles_update" ON asset_design_profiles FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_design_profiles.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_design_profiles.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "design_profiles_delete" ON asset_design_profiles;
CREATE POLICY "design_profiles_delete" ON asset_design_profiles FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_design_profiles.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('supervisor', 'admin')
    )
  );
