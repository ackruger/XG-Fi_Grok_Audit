/*
# Create asset_service_parts table

## Overview
Tracks replacement parts, consumables, and serviceable components for assets.
Each part record is linked to a specific asset and can optionally reference
an asset type (for parts common to a type).

## New Tables
1. `asset_service_parts`
   - `id` (uuid, PK) — unique identifier
   - `asset_id` (uuid, FK to assets, NOT NULL) — which asset this part belongs to
   - `name` (text, NOT NULL) — part name/description
   - `part_number` (text) — manufacturer or supplier part number
   - `manufacturer` (text) — part manufacturer
   - `quantity` (integer, default 1) — quantity needed/on-hand
   - `unit_cost` (numeric) — cost per unit if known
   - `lead_time_days` (integer) — procurement lead time
   - `notes` (text) — additional information
   - `last_replaced_at` (timestamptz) — when the part was last changed
   - `next_replacement_at` (timestamptz) — scheduled next replacement
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

## Indexes
- Index on asset_id for asset-scoped lookups

## Security
- RLS enabled.
- Access scoped through asset → project → project_members.
- SELECT: any project member.
- INSERT/UPDATE: contributor, reviewer, supervisor, admin.
- DELETE: supervisor, admin.
*/

CREATE TABLE IF NOT EXISTS asset_service_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  name text NOT NULL,
  part_number text DEFAULT '',
  manufacturer text DEFAULT '',
  quantity integer NOT NULL DEFAULT 1,
  unit_cost numeric,
  lead_time_days integer,
  notes text DEFAULT '',
  last_replaced_at timestamptz,
  next_replacement_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE asset_service_parts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_service_parts_asset_id ON asset_service_parts(asset_id);

DROP POLICY IF EXISTS "service_parts_select" ON asset_service_parts;
CREATE POLICY "service_parts_select" ON asset_service_parts FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_service_parts.asset_id
      AND project_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service_parts_insert" ON asset_service_parts;
CREATE POLICY "service_parts_insert" ON asset_service_parts FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_service_parts.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "service_parts_update" ON asset_service_parts;
CREATE POLICY "service_parts_update" ON asset_service_parts FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_service_parts.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_service_parts.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "service_parts_delete" ON asset_service_parts;
CREATE POLICY "service_parts_delete" ON asset_service_parts FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_service_parts.asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('supervisor', 'admin')
    )
  );
