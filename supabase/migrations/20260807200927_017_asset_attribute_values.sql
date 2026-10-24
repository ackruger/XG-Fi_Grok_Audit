/*
# Create asset_attribute_values table

## Overview
Stores the actual attribute data for assets. Each row is a single attribute
value for a specific asset, linked to an attribute definition. Values can
optionally be scoped to a design profile (e.g. cooling vs heating performance
data for the same physical coil).

## New Tables
1. `asset_attribute_values`
   - `id` (uuid, PK) — unique identifier
   - `asset_id` (uuid, FK to assets, NOT NULL) — which asset
   - `attribute_definition_id` (uuid, FK to asset_attribute_definitions, NOT NULL) — which attribute
   - `design_profile_id` (uuid, FK to asset_design_profiles, nullable) — optional profile scope
   - `value_text` (text) — the stored value as text (all types stored as text, parsed by app)
   - `value_numeric` (numeric) — optional numeric representation for sorting/filtering
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

## Indexes
- Partial unique index for base attributes (no profile): one value per asset per definition
- Partial unique index for profile-scoped attributes: one value per asset per definition per profile
- Index on asset_id for fast lookups
- Index on attribute_definition_id for reverse lookups

## Security
- RLS enabled.
- Permissions follow asset access via project membership.
- SELECT: any project member.
- INSERT/UPDATE: contributor, reviewer, supervisor, admin.
- DELETE: supervisor, admin.
*/

CREATE TABLE IF NOT EXISTS asset_attribute_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  attribute_definition_id uuid NOT NULL REFERENCES asset_attribute_definitions(id) ON DELETE CASCADE,
  design_profile_id uuid REFERENCES asset_design_profiles(id) ON DELETE CASCADE,
  value_text text DEFAULT '',
  value_numeric numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE asset_attribute_values ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_attr_values_asset_id ON asset_attribute_values(asset_id);
CREATE INDEX IF NOT EXISTS idx_attr_values_def_id ON asset_attribute_values(attribute_definition_id);
CREATE INDEX IF NOT EXISTS idx_attr_values_profile_id ON asset_attribute_values(design_profile_id);

-- Partial unique index: one value per attribute per asset when no design profile
CREATE UNIQUE INDEX IF NOT EXISTS idx_attr_values_base_unique
  ON asset_attribute_values(asset_id, attribute_definition_id)
  WHERE design_profile_id IS NULL;

-- Partial unique index: one value per attribute per asset per profile
CREATE UNIQUE INDEX IF NOT EXISTS idx_attr_values_profile_unique
  ON asset_attribute_values(asset_id, attribute_definition_id, design_profile_id)
  WHERE design_profile_id IS NOT NULL;

DROP POLICY IF EXISTS "attr_values_select" ON asset_attribute_values;
CREATE POLICY "attr_values_select" ON asset_attribute_values FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_attribute_values.asset_id
      AND project_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "attr_values_insert" ON asset_attribute_values;
CREATE POLICY "attr_values_insert" ON asset_attribute_values FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_attribute_values.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "attr_values_update" ON asset_attribute_values;
CREATE POLICY "attr_values_update" ON asset_attribute_values FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_attribute_values.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_attribute_values.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "attr_values_delete" ON asset_attribute_values;
CREATE POLICY "attr_values_delete" ON asset_attribute_values FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_attribute_values.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('supervisor', 'admin')
    )
  );
