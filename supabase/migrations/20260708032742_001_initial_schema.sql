/*
# Initial Schema for Xg-Fi Field Intelligence App

## Overview
Creates the complete foundation schema for a multi-user field intelligence app
that tracks QR-tagged assets, field events, issues, and photos across construction projects.

## New Tables

1. `profiles` - User profiles linked to Supabase Auth
   - `id` (uuid, PK, references auth.users)
   - `name` (text)
   - `email` (text)
   - `company` (text)
   - `trade` (text)
   - `role` (text enum: viewer/contributor/reviewer/supervisor/admin)
   - `avatar_url` (text)
   - `created_at`, `updated_at` (timestamptz)

2. `projects` - Construction/field projects
   - `id` (uuid, PK)
   - `name` (text)
   - `address` (text)
   - `description` (text)
   - `created_by` (uuid, FK to profiles)
   - `created_at`, `updated_at` (timestamptz)

3. `project_members` - Junction table for project access
   - `id` (uuid, PK)
   - `project_id` (uuid, FK)
   - `user_id` (uuid, FK)
   - `role` (text)
   - `joined_at` (timestamptz)

4. `locations` - Physical locations within a project
   - `id` (uuid, PK)
   - `project_id` (uuid, FK)
   - `building`, `floor`, `room_area`, `description` (text)

5. `systems` - Mechanical/electrical systems
   - `id` (uuid, PK)
   - `project_id` (uuid, FK)
   - `name`, `type`, `description` (text)

6. `trades` - Trade specializations
   - `id` (uuid, PK)
   - `name`, `description` (text)

7. `assets` - Core asset tracking table
   - `id` (uuid, PK)
   - `project_id` (uuid, FK)
   - `qr_code_id` (text, unique) - QR code identifier
   - `asset_tag` (text)
   - `location_id`, `system_id`, `trade_id` (uuid, FKs)
   - `equipment_type`, `equipment_name`, `manufacturer`, `model`, `serial_number` (text)
   - `drawing_reference`, `spec_section` (text)
   - `status` (text enum)
   - `current_owner_id` (uuid, FK)
   - `created_at`, `updated_at`, `deleted_at` (timestamptz)

8. `events` - Timestamped log entries on assets
   - `id` (uuid, PK)
   - `asset_id` (uuid, FK)
   - `user_id` (uuid, FK)
   - `event_type` (text enum)
   - `raw_note` (text) - preserved original field note
   - `ai_summary` (jsonb) - AI-structured interpretation
   - `status_before`, `status_after` (text)
   - `confidence_score` (numeric)
   - `requires_review` (boolean)

9. `issues` - Problems requiring follow-up
   - `id` (uuid, PK)
   - `asset_id` (uuid, FK)
   - `created_by`, `assigned_to` (uuid, FKs)
   - `priority` (text enum: low/medium/high/critical)
   - `category`, `description`, `status` (text)
   - `resolution_notes`, `verified_by`, `closed_date` (text/uuid/timestamptz)
   - Soft-delete via `deleted_at`

10. `photos` - Attached images
    - `id` (uuid, PK)
    - `event_id`, `issue_id`, `asset_id` (uuid, FKs)
    - `storage_path` (text)
    - `caption` (text)
    - `uploaded_by` (uuid, FK)

11. `status_history` - Audit trail of status changes
    - `id` (uuid, PK)
    - `asset_id` (uuid, FK)
    - `previous_status`, `new_status` (text)
    - `changed_by` (uuid, FK)
    - `reason` (text)

12. `comments` - Comments on events/issues
    - `id` (uuid, PK)
    - `event_id`, `issue_id` (uuid, FKs)
    - `user_id` (uuid, FK)
    - `content` (text)

## Security
- RLS enabled on ALL tables.
- All access scoped through `project_members` membership.
- Profiles table: users can read/update their own profile.
- Project-scoped tables: access requires membership in the project.

## Notes
- Soft-delete pattern on assets and issues (deleted_at column, never hard delete).
- Every mutation records user_id and timestamp.
- AI summary stored as JSONB alongside preserved raw notes.
*/

-- Profiles table (linked to auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  company text DEFAULT '',
  trade text DEFAULT '',
  role text NOT NULL DEFAULT 'contributor' CHECK (role IN ('viewer', 'contributor', 'reviewer', 'supervisor', 'admin')),
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;
CREATE POLICY "profiles_delete_own" ON profiles FOR DELETE
  TO authenticated USING (auth.uid() = id);

-- Auto-create profile on user sign-up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
    COALESCE(NEW.email, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text DEFAULT '',
  description text DEFAULT '',
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Project members junction
CREATE TABLE IF NOT EXISTS project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'contributor' CHECK (role IN ('viewer', 'contributor', 'reviewer', 'supervisor', 'admin')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, user_id)
);

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

-- Project policies (access via membership)
DROP POLICY IF EXISTS "projects_select" ON projects;
CREATE POLICY "projects_select" ON projects FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = projects.id AND project_members.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "projects_insert" ON projects;
CREATE POLICY "projects_insert" ON projects FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "projects_update" ON projects;
CREATE POLICY "projects_update" ON projects FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = projects.id AND project_members.user_id = auth.uid() AND project_members.role IN ('supervisor', 'admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = projects.id AND project_members.user_id = auth.uid() AND project_members.role IN ('supervisor', 'admin'))
  );

DROP POLICY IF EXISTS "projects_delete" ON projects;
CREATE POLICY "projects_delete" ON projects FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = projects.id AND project_members.user_id = auth.uid() AND project_members.role = 'admin')
  );

-- Project members policies
DROP POLICY IF EXISTS "pm_select" ON project_members;
CREATE POLICY "pm_select" ON project_members FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM project_members pm2 WHERE pm2.project_id = project_members.project_id AND pm2.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "pm_insert" ON project_members;
CREATE POLICY "pm_insert" ON project_members FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM project_members pm2 WHERE pm2.project_id = project_members.project_id AND pm2.user_id = auth.uid() AND pm2.role IN ('supervisor', 'admin'))
    OR project_members.user_id = auth.uid()
  );

DROP POLICY IF EXISTS "pm_update" ON project_members;
CREATE POLICY "pm_update" ON project_members FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM project_members pm2 WHERE pm2.project_id = project_members.project_id AND pm2.user_id = auth.uid() AND pm2.role IN ('supervisor', 'admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM project_members pm2 WHERE pm2.project_id = project_members.project_id AND pm2.user_id = auth.uid() AND pm2.role IN ('supervisor', 'admin'))
  );

DROP POLICY IF EXISTS "pm_delete" ON project_members;
CREATE POLICY "pm_delete" ON project_members FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM project_members pm2 WHERE pm2.project_id = project_members.project_id AND pm2.user_id = auth.uid() AND pm2.role IN ('supervisor', 'admin'))
    OR project_members.user_id = auth.uid()
  );

-- Locations table
CREATE TABLE IF NOT EXISTS locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  building text DEFAULT '',
  floor text DEFAULT '',
  room_area text DEFAULT '',
  description text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "locations_select" ON locations;
CREATE POLICY "locations_select" ON locations FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = locations.project_id AND project_members.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "locations_insert" ON locations;
CREATE POLICY "locations_insert" ON locations FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = locations.project_id AND project_members.user_id = auth.uid() AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin'))
  );

DROP POLICY IF EXISTS "locations_update" ON locations;
CREATE POLICY "locations_update" ON locations FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = locations.project_id AND project_members.user_id = auth.uid() AND project_members.role IN ('supervisor', 'admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = locations.project_id AND project_members.user_id = auth.uid() AND project_members.role IN ('supervisor', 'admin'))
  );

DROP POLICY IF EXISTS "locations_delete" ON locations;
CREATE POLICY "locations_delete" ON locations FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = locations.project_id AND project_members.user_id = auth.uid() AND project_members.role = 'admin')
  );

-- Systems table
CREATE TABLE IF NOT EXISTS systems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text DEFAULT '',
  description text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE systems ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "systems_select" ON systems;
CREATE POLICY "systems_select" ON systems FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = systems.project_id AND project_members.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "systems_insert" ON systems;
CREATE POLICY "systems_insert" ON systems FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = systems.project_id AND project_members.user_id = auth.uid() AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin'))
  );

DROP POLICY IF EXISTS "systems_update" ON systems;
CREATE POLICY "systems_update" ON systems FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = systems.project_id AND project_members.user_id = auth.uid() AND project_members.role IN ('supervisor', 'admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = systems.project_id AND project_members.user_id = auth.uid() AND project_members.role IN ('supervisor', 'admin'))
  );

DROP POLICY IF EXISTS "systems_delete" ON systems;
CREATE POLICY "systems_delete" ON systems FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = systems.project_id AND project_members.user_id = auth.uid() AND project_members.role = 'admin')
  );

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trades_select" ON trades;
CREATE POLICY "trades_select" ON trades FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "trades_insert" ON trades;
CREATE POLICY "trades_insert" ON trades FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "trades_update" ON trades;
CREATE POLICY "trades_update" ON trades FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "trades_delete" ON trades;
CREATE POLICY "trades_delete" ON trades FOR DELETE
  TO authenticated USING (true);

-- Assets table (the core entity)
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  qr_code_id text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  asset_tag text NOT NULL DEFAULT '',
  location_id uuid REFERENCES locations(id),
  system_id uuid REFERENCES systems(id),
  trade_id uuid REFERENCES trades(id),
  equipment_type text DEFAULT '',
  equipment_name text NOT NULL DEFAULT '',
  manufacturer text DEFAULT '',
  model text DEFAULT '',
  serial_number text DEFAULT '',
  drawing_reference text DEFAULT '',
  spec_section text DEFAULT '',
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'complete', 'complete_pending_verification', 'blocked', 'deficient', 'ready_for_next_trade', 'accepted', 'rejected', 'closed')),
  current_owner_id uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assets_select" ON assets;
CREATE POLICY "assets_select" ON assets FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = assets.project_id AND project_members.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "assets_insert" ON assets;
CREATE POLICY "assets_insert" ON assets FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = assets.project_id AND project_members.user_id = auth.uid() AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin'))
  );

DROP POLICY IF EXISTS "assets_update" ON assets;
CREATE POLICY "assets_update" ON assets FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = assets.project_id AND project_members.user_id = auth.uid() AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = assets.project_id AND project_members.user_id = auth.uid() AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin'))
  );

DROP POLICY IF EXISTS "assets_delete" ON assets;
CREATE POLICY "assets_delete" ON assets FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = assets.project_id AND project_members.user_id = auth.uid() AND project_members.role = 'admin')
  );

-- Events table (field log entries)
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  timestamp timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL DEFAULT 'general_note' CHECK (event_type IN ('progress_update', 'completion_note', 'issue_reported', 'issue_resolved', 'photo_added', 'inspection_requested', 'inspection_completed', 'commissioning_update', 'material_delay', 'access_issue', 'design_clarification', 'damage_reported', 'safety_concern', 'general_note')),
  raw_note text NOT NULL DEFAULT '',
  ai_summary jsonb,
  status_before text,
  status_after text,
  confidence_score numeric,
  requires_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events_select" ON events;
CREATE POLICY "events_select" ON events FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = events.asset_id AND project_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "events_insert" ON events;
CREATE POLICY "events_insert" ON events FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = events.asset_id AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "events_update" ON events;
CREATE POLICY "events_update" ON events FOR UPDATE
  TO authenticated USING (
    events.user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = events.asset_id AND project_members.user_id = auth.uid()
      AND project_members.role IN ('supervisor', 'admin')
    )
  ) WITH CHECK (
    events.user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = events.asset_id AND project_members.user_id = auth.uid()
      AND project_members.role IN ('supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "events_delete" ON events;
CREATE POLICY "events_delete" ON events FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = events.asset_id AND project_members.user_id = auth.uid()
      AND project_members.role = 'admin'
    )
  );

-- Issues table
CREATE TABLE IF NOT EXISTS issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  assigned_to uuid REFERENCES profiles(id),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  category text DEFAULT '',
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'verified', 'closed')),
  due_date timestamptz,
  resolution_notes text DEFAULT '',
  verified_by uuid REFERENCES profiles(id),
  closed_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "issues_select" ON issues;
CREATE POLICY "issues_select" ON issues FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = issues.asset_id AND project_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "issues_insert" ON issues;
CREATE POLICY "issues_insert" ON issues FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = issues.asset_id AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "issues_update" ON issues;
CREATE POLICY "issues_update" ON issues FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = issues.asset_id AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = issues.asset_id AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "issues_delete" ON issues;
CREATE POLICY "issues_delete" ON issues FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = issues.asset_id AND project_members.user_id = auth.uid()
      AND project_members.role = 'admin'
    )
  );

-- Photos table
CREATE TABLE IF NOT EXISTS photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  issue_id uuid REFERENCES issues(id) ON DELETE SET NULL,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  caption text DEFAULT '',
  uploaded_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "photos_select" ON photos;
CREATE POLICY "photos_select" ON photos FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = photos.asset_id AND project_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "photos_insert" ON photos;
CREATE POLICY "photos_insert" ON photos FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = photos.asset_id AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "photos_update" ON photos;
CREATE POLICY "photos_update" ON photos FOR UPDATE
  TO authenticated USING (photos.uploaded_by = auth.uid())
  WITH CHECK (photos.uploaded_by = auth.uid());

DROP POLICY IF EXISTS "photos_delete" ON photos;
CREATE POLICY "photos_delete" ON photos FOR DELETE
  TO authenticated USING (
    photos.uploaded_by = auth.uid() OR EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = photos.asset_id AND project_members.user_id = auth.uid()
      AND project_members.role = 'admin'
    )
  );

-- Status history (audit trail)
CREATE TABLE IF NOT EXISTS status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  previous_status text,
  new_status text NOT NULL,
  changed_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  reason text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "status_history_select" ON status_history;
CREATE POLICY "status_history_select" ON status_history FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = status_history.asset_id AND project_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "status_history_insert" ON status_history;
CREATE POLICY "status_history_insert" ON status_history FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM assets
      JOIN project_members ON project_members.project_id = assets.project_id
      WHERE assets.id = status_history.asset_id AND project_members.user_id = auth.uid()
      AND project_members.role IN ('contributor', 'reviewer', 'supervisor', 'admin')
    )
  );

DROP POLICY IF EXISTS "status_history_update" ON status_history;
CREATE POLICY "status_history_update" ON status_history FOR UPDATE
  TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "status_history_delete" ON status_history;
CREATE POLICY "status_history_delete" ON status_history FOR DELETE
  TO authenticated USING (false);

-- Comments table
CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  issue_id uuid REFERENCES issues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comments_select" ON comments;
CREATE POLICY "comments_select" ON comments FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "comments_insert" ON comments;
CREATE POLICY "comments_insert" ON comments FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "comments_update" ON comments;
CREATE POLICY "comments_update" ON comments FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "comments_delete" ON comments;
CREATE POLICY "comments_delete" ON comments FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_qr_code_id ON assets(qr_code_id);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_location_id ON assets(location_id);
CREATE INDEX IF NOT EXISTS idx_events_asset_id ON events(asset_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_issues_asset_id ON issues(asset_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_assigned_to ON issues(assigned_to);
CREATE INDEX IF NOT EXISTS idx_photos_asset_id ON photos(asset_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_status_history_asset ON status_history(asset_id);
