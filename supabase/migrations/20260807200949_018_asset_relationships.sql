/*
# Create asset_relationships table

## Overview
Supports equipment-to-equipment relationships between assets. Uses a
source/target model (not parent/child hierarchy) with typed relationships.
Both assets must belong to the same project. Self-references are prevented.

## New Tables
1. `asset_relationships`
   - `id` (uuid, PK) — unique identifier
   - `source_asset_id` (uuid, FK to assets, NOT NULL) — the "from" asset
   - `target_asset_id` (uuid, FK to assets, NOT NULL) — the "to" asset
   - `relationship_type` (text, NOT NULL) — one of: contains, component_of, serves, fed_by, related, backup_of
   - `description` (text) — optional context about the relationship
   - `source_field` (text) — original spreadsheet column that suggested this relationship (import traceability)
   - `is_confirmed` (boolean, default true) — false for auto-detected relationships flagged for review
   - `created_at` (timestamptz)

## Constraints
- CHECK: source_asset_id != target_asset_id (no self-references)
- UNIQUE: (source_asset_id, target_asset_id, relationship_type) — no duplicate relationships

## Indexes
- Index on source_asset_id for outgoing relationship lookups
- Index on target_asset_id for incoming relationship lookups

## Security
- RLS enabled.
- Access scoped through asset → project → project_members.
- SELECT: any project member.
- INSERT/UPDATE: contributor, reviewer, supervisor, admin.
- DELETE: supervisor, admin.

## Notes
- Same-project validation is enforced at the application level for now.
  A database trigger could enforce it but would add complexity to the
  migration without clear benefit at this stage.
*/

CREATE TABLE IF NOT EXISTS asset_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  target_asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK (relationship_type IN ('contains', 'component_of', 'serves', 'fed_by', 'related', 'backup_of')),
  description text DEFAULT '',
  source_field text DEFAULT '',
  is_confirmed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_asset_id != target_asset_id),
  UNIQUE(source_asset_id, target_asset_id, relationship_type)
);

ALTER TABLE asset_relationships ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_rel_source ON asset_relationships(source_asset_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON asset_relationships(target_asset_id);

DROP POLICY IF EXISTS "rel_select" ON asset_relationships;
CREATE POLICY "rel_select" ON asset_relationships FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_relationships.source_asset_id
      AND project_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "rel_insert" ON asset_relationships;
CREATE POLICY "rel_insert" ON asset_relationships FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_relationships.source_asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "rel_update" ON asset_relationships;
CREATE POLICY "rel_update" ON asset_relationships FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_relationships.source_asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_relationships.source_asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "rel_delete" ON asset_relationships;
CREATE POLICY "rel_delete" ON asset_relationships FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_relationships.source_asset_id
      AND project_members.user_id = auth.uid()
      AND project_members.role IN ('supervisor', 'admin')
    )
  );
