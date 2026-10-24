/*
# Create asset_notes table

## Overview
Adds a notes table for assets, allowing project members to attach free-form
text notes to any asset. Each note records who wrote it and when.

## New Tables
- `asset_notes`
  - `id` (uuid, PK)
  - `asset_id` (uuid, FK to assets, NOT NULL)
  - `user_id` (uuid, FK to profiles, NOT NULL, defaults to auth.uid())
  - `content` (text, NOT NULL)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

## Security
- RLS enabled.
- SELECT: project members can read notes on assets within their projects.
- INSERT: contributors+ can add notes.
- UPDATE: only the note author can edit their own notes.
- DELETE: only the note author or project admins can delete.

## Indexes
- `idx_asset_notes_asset_id` on asset_id for fast lookups by asset.
*/

CREATE TABLE IF NOT EXISTS asset_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE asset_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "asset_notes_select" ON asset_notes;
CREATE POLICY "asset_notes_select" ON asset_notes FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_notes.asset_id AND project_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "asset_notes_insert" ON asset_notes;
CREATE POLICY "asset_notes_insert" ON asset_notes FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_notes.asset_id AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "asset_notes_update" ON asset_notes;
CREATE POLICY "asset_notes_update" ON asset_notes FOR UPDATE
  TO authenticated USING (asset_notes.user_id = auth.uid())
  WITH CHECK (asset_notes.user_id = auth.uid());

DROP POLICY IF EXISTS "asset_notes_delete" ON asset_notes;
CREATE POLICY "asset_notes_delete" ON asset_notes FOR DELETE
  TO authenticated USING (
    asset_notes.user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = asset_notes.asset_id AND project_members.user_id = auth.uid()
      AND project_members.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_asset_notes_asset_id ON asset_notes(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_notes_created_at ON asset_notes(created_at DESC);
