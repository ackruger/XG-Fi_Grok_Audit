/*
# Create activity_posts table

## Overview
Adds a lightweight activity feed for quick, chat-style status updates
from field workers. Posts are tied to a project and optionally to a
specific asset. These are surfaced to teammates via the AI chat.

## New Tables
- `activity_posts`
  - `id` (uuid, PK)
  - `project_id` (uuid, FK to projects, NOT NULL)
  - `asset_id` (uuid, FK to assets, nullable — null means project-wide)
  - `user_id` (uuid, FK to profiles, NOT NULL, defaults to auth.uid())
  - `message` (text, NOT NULL) — the short activity update
  - `created_at` (timestamptz, default now())

## Security
- RLS enabled.
- SELECT: any project member can read posts in their project.
- INSERT: contributors+ can create posts in their project.
- UPDATE: only the post author can edit.
- DELETE: only the post author or project admins can delete.

## Indexes
- idx_activity_posts_project_created on (project_id, created_at DESC)
- idx_activity_posts_asset_id on (asset_id)
*/

CREATE TABLE IF NOT EXISTS activity_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE activity_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_posts_select" ON activity_posts;
CREATE POLICY "activity_posts_select" ON activity_posts FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = activity_posts.project_id
        AND project_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "activity_posts_insert" ON activity_posts;
CREATE POLICY "activity_posts_insert" ON activity_posts FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = activity_posts.project_id
        AND project_members.user_id = auth.uid()
        AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "activity_posts_update" ON activity_posts;
CREATE POLICY "activity_posts_update" ON activity_posts FOR UPDATE
  TO authenticated USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "activity_posts_delete" ON activity_posts;
CREATE POLICY "activity_posts_delete" ON activity_posts FOR DELETE
  TO authenticated USING (
    user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = activity_posts.project_id
        AND project_members.user_id = auth.uid()
        AND project_members.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_activity_posts_project_created
  ON activity_posts(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_posts_asset_id
  ON activity_posts(asset_id);
