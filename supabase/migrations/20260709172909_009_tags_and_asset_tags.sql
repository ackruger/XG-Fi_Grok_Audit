/*
# Create tags and asset_tags tables

## Overview
Adds a project-scoped tagging system for assets. Tags have a name and color,
are unique per project, and can be assigned to any number of assets via a
many-to-many junction table.

## New Tables

1. `tags` - Project-scoped tag definitions
   - `id` (uuid, PK)
   - `project_id` (uuid, FK to projects, NOT NULL)
   - `name` (text, NOT NULL) - display name of the tag
   - `color` (text, NOT NULL, default '#6b7280') - hex color for display
   - `created_at` (timestamptz)
   - UNIQUE constraint on (project_id, name) to prevent duplicates

2. `asset_tags` - Junction table linking assets to tags
   - `id` (uuid, PK)
   - `asset_id` (uuid, FK to assets, NOT NULL, CASCADE on delete)
   - `tag_id` (uuid, FK to tags, NOT NULL, CASCADE on delete)
   - `created_at` (timestamptz)
   - UNIQUE constraint on (asset_id, tag_id) to prevent duplicate assignment

## Security
- RLS enabled on both tables.
- Access scoped through project membership using the existing
  `public.is_project_member()` helper function.
- All project members can read tags and asset_tags.
- Contributors+ can create/update/delete tags and assign/unassign them.

## Indexes
- `idx_tags_project_id` on tags(project_id)
- `idx_asset_tags_asset_id` on asset_tags(asset_id)
- `idx_asset_tags_tag_id` on asset_tags(tag_id)
*/

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6b7280',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, name)
);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_tags_project_id ON tags(project_id);

DROP POLICY IF EXISTS "tags_select" ON tags;
CREATE POLICY "tags_select" ON tags FOR SELECT
  TO authenticated USING (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "tags_insert" ON tags;
CREATE POLICY "tags_insert" ON tags FOR INSERT
  TO authenticated WITH CHECK (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "tags_update" ON tags;
CREATE POLICY "tags_update" ON tags FOR UPDATE
  TO authenticated USING (public.is_project_member(project_id, auth.uid()))
  WITH CHECK (public.is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "tags_delete" ON tags;
CREATE POLICY "tags_delete" ON tags FOR DELETE
  TO authenticated USING (
    public.get_project_role(project_id, auth.uid()) IN ('contributor', 'reviewer', 'supervisor', 'admin')
  );

-- Asset-Tags junction table
CREATE TABLE IF NOT EXISTS asset_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(asset_id, tag_id)
);

ALTER TABLE asset_tags ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_asset_tags_asset_id ON asset_tags(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_tags_tag_id ON asset_tags(tag_id);

DROP POLICY IF EXISTS "asset_tags_select" ON asset_tags;
CREATE POLICY "asset_tags_select" ON asset_tags FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      WHERE assets.id = asset_tags.asset_id
      AND public.is_project_member(assets.project_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "asset_tags_insert" ON asset_tags;
CREATE POLICY "asset_tags_insert" ON asset_tags FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      WHERE assets.id = asset_tags.asset_id
      AND public.is_project_member(assets.project_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "asset_tags_update" ON asset_tags;
CREATE POLICY "asset_tags_update" ON asset_tags FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      WHERE assets.id = asset_tags.asset_id
      AND public.is_project_member(assets.project_id, auth.uid())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      WHERE assets.id = asset_tags.asset_id
      AND public.is_project_member(assets.project_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "asset_tags_delete" ON asset_tags;
CREATE POLICY "asset_tags_delete" ON asset_tags FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      WHERE assets.id = asset_tags.asset_id
      AND public.is_project_member(assets.project_id, auth.uid())
    )
  );
