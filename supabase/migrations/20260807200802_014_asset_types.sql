/*
# Create asset_types table

## Overview
Creates the `asset_types` table to support structured, normalized equipment
classification. Asset types are project-scoped and managed by admin/supervisor
roles. They are NOT seeded from source spreadsheet sections — the normalized
type taxonomy will be built separately during the importer stage.

## New Tables
1. `asset_types`
   - `id` (uuid, PK) — unique identifier
   - `project_id` (uuid, FK to projects) — project scope
   - `name` (text, NOT NULL) — display name (e.g. "Air Handling Unit", "Pump")
   - `description` (text) — optional longer description
   - `icon` (text) — optional icon identifier for UI display
   - `created_at` (timestamptz) — creation timestamp
   - `updated_at` (timestamptz) — last modification timestamp

## Indexes
- Unique constraint on (project_id, name) to prevent duplicate type names per project
- Index on project_id for membership lookups

## Security
- RLS enabled.
- SELECT: any project member can view asset types.
- INSERT/UPDATE: admin and supervisor only.
- DELETE: admin only.
*/

CREATE TABLE IF NOT EXISTS asset_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  icon text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, name)
);

ALTER TABLE asset_types ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_asset_types_project_id ON asset_types(project_id);

DROP POLICY IF EXISTS "asset_types_select" ON asset_types;
CREATE POLICY "asset_types_select" ON asset_types FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = asset_types.project_id
      AND project_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "asset_types_insert" ON asset_types;
CREATE POLICY "asset_types_insert" ON asset_types FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = asset_types.project_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "asset_types_update" ON asset_types;
CREATE POLICY "asset_types_update" ON asset_types FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = asset_types.project_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('supervisor', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = asset_types.project_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "asset_types_delete" ON asset_types;
CREATE POLICY "asset_types_delete" ON asset_types FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = asset_types.project_id
      AND project_members.user_id = auth.uid()
      AND project_members.role = 'admin'
    )
  );
